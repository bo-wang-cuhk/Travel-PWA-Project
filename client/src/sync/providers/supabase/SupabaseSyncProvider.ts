import { getSupabaseClient } from '../../../auth/supabaseClient'
import { prepareLocalWorkspace } from '../../../db/offlineDb'
import type { LocalChange, ProviderStatus, PushResult, RemoteChange, RemoteChanges, SyncEntityType, SyncProvider } from '../../types'

const TABLE_BY_ENTITY: Record<SyncEntityType, string> = {
  trip: 'trips',
  day: 'trip_days',
  dayNote: 'day_notes',
  category: 'category_records',
  collection: 'collection_records',
  collectionPlace: 'collection_place_records',
  place: 'places',
  assignment: 'assignments',
  accommodation: 'accommodations',
  reservation: 'reservations',
  budgetItem: 'budget_items',
  todo: 'todo_items',
  packingBag: 'packing_bags',
  packingItem: 'packing_items',
  packingConfig: 'packing_configs',
  tripFile: 'trip_files',
  vacay: 'vacay_records',
  atlas: 'atlas_records',
}

interface CloudChangeRow {
  cursor: number
  entity_type: SyncEntityType
  entity_id: string
  operation: 'upsert' | 'delete'
  revision: number
  payload: unknown
}

function cursorNumber(cursor?: string | null): number {
  const value = Number(cursor || 0)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function deletedAt(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const value = (payload as { deletedAt?: unknown }).deletedAt
  return typeof value === 'string' && value ? value : null
}

function localUpdatedAt(change: LocalChange): string {
  const payload = change.payload as { updatedAt?: unknown } | null
  const raw = typeof payload?.updatedAt === 'string' ? payload.updatedAt : null
  const stamp = raw && Number.isFinite(Date.parse(raw)) ? Date.parse(raw) : change.changedAt
  if (!stamp || !Number.isFinite(stamp)) throw new Error(`Invalid edit timestamp for ${change.entityType} ${change.entityId}`)
  return new Date(stamp).toISOString()
}

/** Supabase-backed local-first sync for the user's active personal/shared workspace. */
export class SupabaseSyncProvider implements SyncProvider {
  readonly id = 'supabase'
  readonly syncMode = 'last-write-wins' as const
  private workspaceId: string | null = null

  async connect(): Promise<ProviderStatus> {
    const client = getSupabaseClient()
    const { data: sessionData, error: sessionError } = await client.auth.getSession()
    if (sessionError || !sessionData.session) throw new Error('Supabase session is unavailable')
    const { data, error } = await client.rpc('current_sync_workspace')
    if (error) throw new Error(error.message)
    if (typeof data !== 'string' || !data) throw new Error('Sync workspace is unavailable')
    const { data: workspace, error: workspaceError } = await client
      .from('workspaces')
      .select('owner_id')
      .eq('id', data)
      .single<{ owner_id: string }>()
    if (workspaceError || !workspace) throw new Error(workspaceError?.message || 'Sync workspace is unavailable')
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('legacy_user_id')
      .eq('id', sessionData.session.user.id)
      .single<{ legacy_user_id: number }>()
    if (profileError || !profile) throw new Error(profileError?.message || 'Profile is unavailable')
    await prepareLocalWorkspace(data, profile.legacy_user_id, workspace.owner_id === sessionData.session.user.id)
    this.workspaceId = data
    return { connected: true }
  }

  async disconnect(): Promise<void> {
    this.workspaceId = null
  }

  async getStatus(): Promise<ProviderStatus> {
    const { data } = await getSupabaseClient().auth.getSession()
    return { connected: Boolean(data.session) }
  }

  private objectPath(path: string): string {
    if (!this.workspaceId) throw new Error('Supabase provider is not connected')
    return `${this.workspaceId}/${path}`
  }

  async uploadAttachment(path: string, blob: Blob, contentType: string): Promise<void> {
    const { error } = await getSupabaseClient().storage
      .from('trip-attachments')
      .upload(this.objectPath(path), blob, { contentType, upsert: true })
    if (error) throw new Error(error.message)
  }

  async downloadAttachment(path: string): Promise<Blob> {
    const { data, error } = await getSupabaseClient().storage
      .from('trip-attachments')
      .download(this.objectPath(path))
    if (error || !data) throw new Error(error?.message || 'Attachment download failed')
    return data
  }

  async pull(cursor?: string | null): Promise<RemoteChanges> {
    if (!this.workspaceId) throw new Error('Supabase provider is not connected')
    const client = getSupabaseClient()
    const after = cursorNumber(cursor)
    const rows: CloudChangeRow[] = []
    const pageSize = 1000

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from('sync_changes')
        .select('cursor,entity_type,entity_id,operation,revision,payload')
        .eq('workspace_id', this.workspaceId)
        .gt('cursor', after)
        .order('cursor', { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw new Error(error.message)
      const page = (data || []) as CloudChangeRow[]
      rows.push(...page)
      if (page.length < pageSize) break
    }

    // Only the latest cloud version of an entity matters to IndexedDB. This
    // avoids replaying years of edits on a newly installed device.
    const latest = new Map<string, CloudChangeRow>()
    for (const row of rows) latest.set(`${row.entity_type}:${row.entity_id}`, row)
    const changes: RemoteChange[] = [...latest.values()].map(row => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      remoteVersion: String(row.revision),
      payload: row.payload,
    }))
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1].cursor) : String(after)
    return { cursor: nextCursor, changes }
  }

  async push(changes: LocalChange[]): Promise<PushResult> {
    if (!this.workspaceId) throw new Error('Supabase provider is not connected')
    const client = getSupabaseClient()
    const versions: Record<string, string> = {}

    for (const change of changes) {
      if (!change.payload) throw new Error(`Missing local payload for ${change.entityType} ${change.entityId}`)
      if (change.offline) {
        const { data, error } = await client.rpc('push_offline_workspace_change', {
          p_entity_type: change.entityType,
          p_id: change.entityId,
          p_workspace_id: this.workspaceId,
          p_payload: change.payload,
          p_deleted_at: change.operation === 'delete' ? deletedAt(change.payload) || new Date().toISOString() : null,
          p_local_updated_at: localUpdatedAt(change),
        })
        if (error) throw new Error(error.message)
        const result = (data as Array<{ applied: boolean; revision: number }> | null)?.[0]
        if (!result) throw new Error(`Missing cloud version for ${change.entityType} ${change.entityId}`)
        versions[change.entityId] = String(result.revision)
        continue
      }
      const { data, error } = await client
        .from(TABLE_BY_ENTITY[change.entityType])
        .upsert({
          id: change.entityId,
          workspace_id: this.workspaceId,
          payload: change.payload,
          deleted_at: change.operation === 'delete' ? deletedAt(change.payload) || new Date().toISOString() : null,
        }, { onConflict: 'workspace_id,id' })
        .select('revision')
        .single()
      if (error) throw new Error(error.message)
      versions[change.entityId] = String((data as { revision: number }).revision)
    }

    const { data: head, error: headError } = await client
      .from('sync_changes')
      .select('cursor')
      .eq('workspace_id', this.workspaceId)
      .order('cursor', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (headError) throw new Error(headError.message)
    return { cursor: String((head as { cursor?: number } | null)?.cursor || 0), versions }
  }
}

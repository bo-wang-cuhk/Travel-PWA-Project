import type { SyncedDay } from '../../../domain/daySyncModel'
import type { SyncedTrip } from '../../../domain/tripSyncModel'
import type { GitHubSyncPublicConfig, LocalChange, ProviderStatus, PushResult, RemoteChanges, SyncProvider } from '../../types'
import { GitHubApi, GitHubApiError } from './githubApi'
import { EMPTY_MANIFEST, type GitHubDaysFile, type GitHubManifest } from './githubTypes'

export class RemoteAdvancedError extends Error {
  constructor() {
    super('Remote repository changed during sync')
    this.name = 'RemoteAdvancedError'
  }
}

export class GitHubSyncProvider implements SyncProvider {
  readonly id = 'github'
  private readonly api: GitHubApi
  private connected = false

  constructor(private readonly config: GitHubSyncPublicConfig, token: string) {
    if (!token) throw new Error('GitHub token is required')
    this.api = new GitHubApi(config, token)
  }

  async connect(): Promise<ProviderStatus> {
    const repo = await this.api.getRepository()
    if (repo.permissions?.push === false) throw new Error('Token does not have repository write permission')
    try {
      await this.api.getRef()
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      await this.api.initializeManifest(EMPTY_MANIFEST)
      await this.api.getRef()
    }
    this.connected = true
    return { connected: true, message: `${this.config.owner}/${this.config.repository}` }
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  async getStatus(): Promise<ProviderStatus> {
    return { connected: this.connected }
  }

  async pull(cursor?: string | null): Promise<RemoteChanges> {
    const ref = await this.api.getRef()
    const head = ref.object.sha
    if (cursor && cursor === head) return { cursor: head, changes: [] }

    let manifest: GitHubManifest
    try {
      manifest = (await this.api.getFile<GitHubManifest>('manifest.json')).value
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      manifest = EMPTY_MANIFEST
    }
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported sync schema: ${manifest.schemaVersion}`)

    const tripChanges = await Promise.all(Object.entries(manifest.trips).map(async ([entityId, entry]) => {
      if (entry.deletedAt) {
        return { entityType: 'trip' as const, entityId, operation: 'delete' as const, remoteVersion: entry.contentHash }
      }
      const trip = await this.api.getFile<SyncedTrip>(entry.path)
      return {
        entityType: 'trip' as const,
        entityId,
        operation: 'upsert' as const,
        remoteVersion: entry.contentHash || trip.sha,
        payload: trip.value,
      }
    }))

    const dayFiles = new Map<string, Promise<GitHubDaysFile>>()
    const visibleDayEntries = Object.entries(manifest.days ?? {}).filter(([, entry]) => !manifest.trips[entry.tripId]?.deletedAt)
    const dayChanges = await Promise.all(visibleDayEntries.map(async ([entityId, entry]) => {
      let filePromise = dayFiles.get(entry.path)
      if (!filePromise) {
        filePromise = this.api.getFile<GitHubDaysFile>(entry.path).then(result => result.value)
        dayFiles.set(entry.path, filePromise)
      }
      const file = await filePromise
      if (file.schemaVersion !== 1 || file.tripId !== entry.tripId) throw new Error(`Invalid remote days file ${entry.path}`)
      const payload = file.days.find(day => day.id === entityId)
      if (!payload) throw new Error(`Remote day ${entityId} is missing from ${entry.path}`)
      return {
        entityType: 'day' as const,
        entityId,
        operation: entry.deletedAt ? 'delete' as const : 'upsert' as const,
        remoteVersion: entry.contentHash,
        payload,
      }
    }))
    // Parent Trips must be applied before their Days on an empty device.
    return { cursor: head, changes: [...tripChanges, ...dayChanges] }
  }

  async push(changes: LocalChange[], cursor?: string | null): Promise<PushResult> {
    if (changes.length === 0) {
      const head = (await this.api.getRef()).object.sha
      return { cursor: head, versions: {} }
    }
    const ref = await this.api.getRef()
    const head = ref.object.sha
    if (cursor && cursor !== head) throw new RemoteAdvancedError()

    const commit = await this.api.getCommit(head)
    let manifest: GitHubManifest
    try { manifest = (await this.api.getFile<GitHubManifest>('manifest.json')).value }
    catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
      manifest = { ...EMPTY_MANIFEST, trips: {}, days: {} }
    }

    const next: GitHubManifest = {
      ...manifest,
      trips: { ...manifest.trips },
      days: { ...(manifest.days ?? {}) },
      updatedAt: new Date().toISOString(),
    }
    const treeEntries: Array<{ path: string; sha: string | null }> = []
    const versions: Record<string, string> = {}

    for (const change of changes.filter(item => item.entityType === 'trip')) {
      const path = `trips/${change.entityId}/trip.json`
      if (change.operation === 'delete') {
        const version = `deleted:${Date.now()}:${change.entityId}`
        const previous = next.trips[change.entityId]
        next.trips[change.entityId] = { path, updatedAt: next.updatedAt, deletedAt: next.updatedAt, contentHash: version }
        if (previous && !previous.deletedAt) treeEntries.push({ path, sha: null })
        versions[change.entityId] = version
      } else {
        const blob = await this.api.createBlob(change.payload)
        const updatedAt = (change.payload as SyncedTrip | undefined)?.updatedAt || next.updatedAt
        next.trips[change.entityId] = { path, updatedAt, deletedAt: null, contentHash: blob.sha }
        treeEntries.push({ path, sha: blob.sha })
        versions[change.entityId] = blob.sha
      }
    }

    const dayGroups = new Map<string, LocalChange[]>()
    for (const change of changes.filter(item => item.entityType === 'day')) {
      const day = change.payload as SyncedDay | undefined
      if (!day || day.schemaVersion !== 1 || day.id !== change.entityId || !day.tripId) {
        throw new Error(`Invalid local day ${change.entityId}`)
      }
      const group = dayGroups.get(day.tripId) ?? []
      group.push(change)
      dayGroups.set(day.tripId, group)
    }

    for (const [tripId, group] of dayGroups) {
      const path = `trips/${tripId}/days.json`
      let file: GitHubDaysFile
      try {
        file = (await this.api.getFile<GitHubDaysFile>(path)).value
      } catch (error) {
        if (!(error instanceof GitHubApiError) || error.status !== 404) throw error
        file = { schemaVersion: 1, tripId, updatedAt: next.updatedAt, days: [] }
      }
      if (file.schemaVersion !== 1 || file.tripId !== tripId) throw new Error(`Invalid remote days file ${path}`)
      const byId = new Map(file.days.map(day => [day.id, day]))
      for (const change of group) {
        const day = change.payload as SyncedDay
        byId.set(day.id, day)
        const version = `${day.updatedAt}:${day.deletedAt ?? 'active'}`
        next.days![day.id] = {
          path,
          tripId,
          updatedAt: day.updatedAt,
          deletedAt: day.deletedAt,
          contentHash: version,
        }
        versions[day.id] = version
      }
      const daysFile: GitHubDaysFile = {
        schemaVersion: 1,
        tripId,
        updatedAt: next.updatedAt,
        days: [...byId.values()].sort((a, b) => a.dayNumber - b.dayNumber || a.id.localeCompare(b.id)),
      }
      const blob = await this.api.createBlob(daysFile)
      treeEntries.push({ path, sha: blob.sha })
    }

    const manifestBlob = await this.api.createBlob(next)
    treeEntries.push({ path: 'manifest.json', sha: manifestBlob.sha })
    const tree = await this.api.createTree(commit.tree.sha, treeEntries)
    const created = await this.api.createCommit('Sync Travel PWA data', tree.sha, head)
    try {
      await this.api.updateRef(created.sha)
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 422) throw new RemoteAdvancedError()
      throw error
    }
    return { cursor: created.sha, versions }
  }
}

import { getSupabaseClient, SUPABASE_AUTH_ENABLED } from '../auth/supabaseClient'
import { SupabaseSyncProvider } from './providers/supabase/SupabaseSyncProvider'
import { SyncManager, type SyncRunResult } from './SyncManager'
import { useTripStore } from '../store/tripStore'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type ConfiguredSyncResult =
  | { status: 'done'; result: SyncRunResult }
  | { status: 'skipped'; reason: 'disabled' | 'offline' | 'busy' | 'unconfigured' }

let running: Promise<ConfiguredSyncResult> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let registered = false
let rerunRequested = false
let realtimeChannel: RealtimeChannel | null = null
let realtimeWorkspaceId: string | null = null
let authSubscription: { unsubscribe(): void } | null = null

function stopRealtime(): void {
  if (realtimeChannel) void getSupabaseClient().removeChannel(realtimeChannel)
  realtimeChannel = null
  realtimeWorkspaceId = null
}

async function ensureRealtime(): Promise<void> {
  if (!registered || !SUPABASE_AUTH_ENABLED) return
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('current_sync_workspace')
  if (error || typeof data !== 'string' || !data) return
  if (realtimeWorkspaceId === data && realtimeChannel) return
  stopRealtime()
  realtimeWorkspaceId = data
  realtimeChannel = client
    .channel(`workspace-sync-${data}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'sync_changes', filter: `workspace_id=eq.${data}`,
    }, () => scheduleSync(100))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') scheduleSync(1_000)
    })
}

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('travel-sync-status'))
}

async function runConfiguredSync(): Promise<ConfiguredSyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'skipped', reason: 'offline' }
  if (!SUPABASE_AUTH_ENABLED) return { status: 'skipped', reason: 'unconfigured' }
  const { data } = await getSupabaseClient().auth.getSession()
  if (!data.session) return { status: 'skipped', reason: 'unconfigured' }
  try {
    const result = await new SyncManager(new SupabaseSyncProvider()).sync()
    await ensureRealtime()
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('travel-sync-complete'))
    const activeTripId = useTripStore.getState().trip?.id
    if (activeTripId != null) void useTripStore.getState().loadTrip(activeTripId).catch(console.error)
    return { status: 'done', result }
  } finally {
    announce()
  }
}

export function syncNow(): Promise<ConfiguredSyncResult> {
  if (running) {
    rerunRequested = true
    return Promise.resolve({ status: 'skipped', reason: 'busy' })
  }
  running = runConfiguredSync().finally(() => {
    running = null
    if (rerunRequested) {
      rerunRequested = false
      scheduleSync(100)
    }
  })
  announce()
  return running
}

export function scheduleSync(delayMs = 5_000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void syncNow().catch(console.error)
  }, delayMs)
}

function onOnline(): void { scheduleSync(250) }
function onVisible(): void { if (!document.hidden) scheduleSync(250) }
function onLocalChange(): void { if (navigator.onLine) scheduleSync(150) }

export function registerLocalFirstSyncTriggers(): void {
  if (registered) return
  registered = true
  window.addEventListener('online', onOnline)
  window.addEventListener('travel:local-change', onLocalChange)
  document.addEventListener('visibilitychange', onVisible)
  if (SUPABASE_AUTH_ENABLED) {
    authSubscription = getSupabaseClient().auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') stopRealtime()
      if (event === 'SIGNED_IN') scheduleSync(0)
    }).data.subscription
  }
  scheduleSync(1_000)
}

export function unregisterLocalFirstSyncTriggers(): void {
  if (!registered) return
  registered = false
  window.removeEventListener('online', onOnline)
  window.removeEventListener('travel:local-change', onLocalChange)
  document.removeEventListener('visibilitychange', onVisible)
  authSubscription?.unsubscribe()
  authSubscription = null
  if (SUPABASE_AUTH_ENABLED) stopRealtime()
  if (timer) clearTimeout(timer)
  timer = null
}

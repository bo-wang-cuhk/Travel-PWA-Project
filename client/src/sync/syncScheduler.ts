import { getSupabaseClient, SUPABASE_AUTH_ENABLED } from '../auth/supabaseClient'
import { SupabaseSyncProvider } from './providers/supabase/SupabaseSyncProvider'
import { SyncManager, type SyncRunResult } from './SyncManager'
import { useTripStore } from '../store/tripStore'

export type ConfiguredSyncResult =
  | { status: 'done'; result: SyncRunResult }
  | { status: 'skipped'; reason: 'disabled' | 'offline' | 'busy' | 'unconfigured' }

let running: Promise<ConfiguredSyncResult> | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let registered = false

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
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('travel-sync-complete'))
    const activeTripId = useTripStore.getState().trip?.id
    if (activeTripId != null) void useTripStore.getState().loadTrip(activeTripId).catch(console.error)
    return { status: 'done', result }
  } finally {
    announce()
  }
}

export function syncNow(): Promise<ConfiguredSyncResult> {
  if (running) return Promise.resolve({ status: 'skipped', reason: 'busy' })
  running = runConfiguredSync().finally(() => { running = null })
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
function onLocalChange(): void { scheduleSync() }

export function registerLocalFirstSyncTriggers(): void {
  if (registered) return
  registered = true
  window.addEventListener('online', onOnline)
  window.addEventListener('travel:local-change', onLocalChange)
  document.addEventListener('visibilitychange', onVisible)
  scheduleSync(1_000)
}

export function unregisterLocalFirstSyncTriggers(): void {
  if (!registered) return
  registered = false
  window.removeEventListener('online', onOnline)
  window.removeEventListener('travel:local-change', onLocalChange)
  document.removeEventListener('visibilitychange', onVisible)
  if (timer) clearTimeout(timer)
  timer = null
}

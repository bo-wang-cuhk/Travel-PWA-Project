import { GitHubSyncProvider, RemoteAdvancedError } from './providers/github/GitHubSyncProvider'
import { SyncManager, type SyncRunResult } from './SyncManager'
import { syncSettingsRepository } from './syncSettingsRepository'

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
  const { config, token } = await syncSettingsRepository.getGitHub()
  if (!config.enabled) return { status: 'skipped', reason: 'disabled' }
  if (!config.owner || !config.repository || !config.branch || !token) return { status: 'skipped', reason: 'unconfigured' }

  const run = () => new SyncManager(new GitHubSyncProvider(config, token)).sync()
  try {
    return { status: 'done', result: await run() }
  } catch (error) {
    // The branch advanced between pull and ref update. Pull and merge once more;
    // a true same-entity collision will now be persisted as a conflict.
    if (error instanceof RemoteAdvancedError) return { status: 'done', result: await run() }
    throw error
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

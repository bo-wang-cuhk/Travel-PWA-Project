import { useCallback, useEffect, useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'
import { offlineDb } from '../../db/offlineDb'
import { useTranslation } from '../../i18n'
import { syncNow } from '../../sync/syncScheduler'
import Section from './Section'

const SUPABASE_PROVIDER_ID = 'supabase'

interface Snapshot {
  status: string
  lastSyncAt: number | null
  lastError: string | null
  pending: number
}

const EMPTY: Snapshot = { status: 'idle', lastSyncAt: null, lastError: null, pending: 0 }

export default function SyncSettingsTab(): React.ReactElement {
  const { locale } = useTranslation()
  const zh = locale.startsWith('zh')
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [state, pending] = await Promise.all([
      offlineDb.syncState.get(SUPABASE_PROVIDER_ID),
      offlineDb.syncOutbox.count(),
    ])
    setSnapshot({
      status: state?.status ?? 'idle',
      lastSyncAt: state?.lastSyncAt ?? null,
      lastError: state?.lastError ?? null,
      pending,
    })
  }, [])

  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener('travel-sync-status', refresh)
    return () => window.removeEventListener('travel-sync-status', refresh)
  }, [load])

  const synchronize = async () => {
    setBusy(true)
    setNotice('')
    try {
      const result = await syncNow()
      setNotice(result.status === 'done'
        ? (zh ? `同步完成：上传 ${result.result.pushed}，下载 ${result.result.pulled}` : `Synced: ${result.result.pushed} uploaded, ${result.result.pulled} downloaded`)
        : `${zh ? '未执行同步' : 'Sync skipped'}: ${result.reason}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      await load()
    }
  }

  return (
    <Section title={zh ? '个人云同步' : 'Personal cloud sync'} icon={Cloud}>
      <p className="text-sm text-content-muted">
        {zh
          ? 'Supabase 是云端权威数据源；IndexedDB 保存当前账号的完整本地副本。编辑会立即保存在本机，并在后台同步。'
          : 'Supabase is authoritative in the cloud; IndexedDB keeps a complete local copy for this account. Edits save locally first and sync in the background.'}
      </p>
      <button
        disabled={busy}
        onClick={() => void synchronize()}
        className="inline-flex items-center gap-2 rounded-lg bg-content px-4 py-2 text-sm font-semibold text-surface disabled:opacity-50"
      >
        <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
        {zh ? '立即同步' : 'Sync now'}
      </button>
      <div className="rounded-lg bg-surface-secondary p-3 text-sm text-content-muted">
        <div>{zh ? '状态' : 'Status'}: {snapshot.status}</div>
        <div>{zh ? '待上传' : 'Pending upload'}: {snapshot.pending}</div>
        <div>{zh ? '上次同步' : 'Last sync'}: {snapshot.lastSyncAt ? new Date(snapshot.lastSyncAt).toLocaleString() : '—'}</div>
        {snapshot.lastError && <div className="mt-1 text-danger">{snapshot.lastError}</div>}
      </div>
      {notice && <p role="status" className="text-sm text-content">{notice}</p>}
    </Section>
  )
}

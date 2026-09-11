import { useCallback, useEffect, useState } from 'react'
import { Cloud, RefreshCw, Save, Unplug } from 'lucide-react'
import { offlineDb } from '../../db/offlineDb'
import { useTranslation } from '../../i18n'
import { syncNow } from '../../sync/syncScheduler'
import { DEFAULT_GITHUB_CONFIG, GITHUB_PROVIDER_ID, syncSettingsRepository } from '../../sync/syncSettingsRepository'
import type { GitHubSyncPublicConfig } from '../../sync/types'
import Section from './Section'

interface Snapshot {
  hasToken: boolean
  status: string
  lastSyncAt: number | null
  lastError: string | null
  pending: number
  conflicts: number
}

const EMPTY_SNAPSHOT: Snapshot = { hasToken: false, status: 'idle', lastSyncAt: null, lastError: null, pending: 0, conflicts: 0 }

export default function SyncSettingsTab(): React.ReactElement {
  const { locale } = useTranslation()
  const zh = locale.startsWith('zh')
  const [config, setConfig] = useState<GitHubSyncPublicConfig>(DEFAULT_GITHUB_CONFIG)
  const [token, setToken] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const [{ config: saved, token: savedToken }, state, pending, conflicts] = await Promise.all([
      syncSettingsRepository.getGitHub(),
      offlineDb.syncState.get(GITHUB_PROVIDER_ID),
      offlineDb.syncOutbox.count(),
      offlineDb.syncConflicts.count(),
    ])
    setConfig(saved)
    setSnapshot({
      hasToken: Boolean(savedToken),
      status: state?.status ?? 'idle',
      lastSyncAt: state?.lastSyncAt ?? null,
      lastError: state?.lastError ?? null,
      pending,
      conflicts,
    })
  }, [])

  useEffect(() => {
    void load()
    const refresh = () => { void load() }
    window.addEventListener('travel-sync-status', refresh)
    return () => window.removeEventListener('travel-sync-status', refresh)
  }, [load])

  const save = async (enable = config.enabled) => {
    setBusy(true)
    setNotice('')
    try {
      const next = { ...config, enabled: enable }
      await syncSettingsRepository.saveGitHub(next, token || undefined)
      setConfig(next)
      setToken('')
      setNotice(zh ? '配置已保存在当前设备。' : 'Configuration saved on this device.')
      await load()
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const connectAndSync = async () => {
    if (!config.owner.trim() || !config.repository.trim() || !config.branch.trim() || (!token.trim() && !snapshot.hasToken)) {
      setNotice(zh ? '请填写仓库信息和 Token。' : 'Repository details and token are required.')
      return
    }
    if (!await save(true)) return
    setBusy(true)
    try {
      const result = await syncNow()
      setNotice(result.status === 'done'
        ? (zh ? `同步完成：拉取 ${result.result.pulled}，推送 ${result.result.pushed}，冲突 ${result.result.conflicts}` : `Synced: ${result.result.pulled} pulled, ${result.result.pushed} pushed, ${result.result.conflicts} conflicts`)
        : `${zh ? '未执行同步' : 'Sync skipped'}: ${result.reason}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      await load()
    }
  }

  const disconnect = async () => {
    setBusy(true)
    await syncSettingsRepository.disconnectGitHub()
    setConfig(current => ({ ...current, enabled: false }))
    setToken('')
    setNotice(zh ? '已断开；本地旅行数据不会被删除。' : 'Disconnected; local trip data was kept.')
    setBusy(false)
    await load()
  }

  const inputClass = 'mt-1 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-content outline-none focus:border-content-muted'
  return (
    <Section title={zh ? '个人云同步' : 'Personal cloud sync'} icon={Cloud}>
      <p className="text-sm text-content-muted">
        {zh ? 'IndexedDB 始终是工作数据库。GitHub 失败不会阻止本地保存。' : 'IndexedDB remains the working database. GitHub failures never block local saves.'}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium text-content">Owner<input className={inputClass} value={config.owner} onChange={e => setConfig({ ...config, owner: e.target.value.trim() })} /></label>
        <label className="text-sm font-medium text-content">Repository<input className={inputClass} value={config.repository} onChange={e => setConfig({ ...config, repository: e.target.value.trim() })} /></label>
        <label className="text-sm font-medium text-content">Branch<input className={inputClass} value={config.branch} onChange={e => setConfig({ ...config, branch: e.target.value.trim() || 'main' })} /></label>
      </div>
      <label className="block text-sm font-medium text-content">
        Fine-grained PAT
        <input
          className={inputClass}
          type="password"
          autoComplete="off"
          value={token}
          placeholder={snapshot.hasToken ? (zh ? '已保存在本机；留空则保持不变' : 'Saved locally; leave blank to keep it') : 'github_pat_…'}
          onChange={e => setToken(e.target.value)}
        />
      </label>
      <p className="text-xs text-content-faint">
        {zh ? 'Token 仅保存在此设备，不会写入源码、构建产物或数据仓库。请只授予该私有仓库 Contents 读写权限。' : 'The token stays on this device. Grant Contents read/write only for this private repository.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-content disabled:opacity-50"><Save size={16} />{zh ? '保存' : 'Save'}</button>
        <button disabled={busy} onClick={() => void connectAndSync()} className="inline-flex items-center gap-2 rounded-lg bg-content px-4 py-2 text-sm font-semibold text-surface disabled:opacity-50"><RefreshCw size={16} className={busy ? 'animate-spin' : ''} />{zh ? '连接并同步' : 'Connect & sync'}</button>
        <button disabled={busy || (!config.enabled && !snapshot.hasToken)} onClick={() => void disconnect()} className="inline-flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-content-muted disabled:opacity-50"><Unplug size={16} />{zh ? '断开' : 'Disconnect'}</button>
      </div>
      <div className="rounded-lg bg-surface-secondary p-3 text-sm text-content-muted">
        <div>{zh ? '状态' : 'Status'}: {snapshot.status}</div>
        <div>{zh ? '待同步' : 'Pending'}: {snapshot.pending} · {zh ? '冲突' : 'Conflicts'}: {snapshot.conflicts}</div>
        <div>{zh ? '上次同步' : 'Last sync'}: {snapshot.lastSyncAt ? new Date(snapshot.lastSyncAt).toLocaleString() : '—'}</div>
        {snapshot.lastError && <div className="mt-1 text-danger">{snapshot.lastError}</div>}
      </div>
      {notice && <p role="status" className="text-sm text-content">{notice}</p>}
    </Section>
  )
}

import { Link } from 'react-router'
import { CalendarDays, Compass, Plus, Users } from 'lucide-react'
import type { Journey } from '../store/journeyStore'
import { useLocalJourney } from './localJourney/useLocalJourney'

export default function LocalJourneyPage() {
  const { journeys, trips, selectedTrips, setSelectedTrips, title, setTitle, subtitle, setSubtitle, creating, setCreating, saving, error, loading, openCreate, create, zh } = useLocalJourney()

  return <main className="mx-auto w-full max-w-5xl px-4 py-8 text-content-primary sm:px-8">
    <header className="mb-7 flex items-center justify-between gap-3">
      <div>
        <div className="mb-1 flex items-center gap-2 text-content-muted"><Compass size={18} /><span className="text-xs font-semibold uppercase tracking-widest">Journey</span></div>
        <h1 className="text-3xl font-bold">{zh ? '我的旅程' : 'My journeys'}</h1>
        <p className="mt-2 text-sm text-content-muted">{zh ? '把旅行写成按日期排列的记录，与旅程成员一起编辑。' : 'Write dated travel notes together with your journey members.'}</p>
      </div>
      <button type="button" onClick={() => void openCreate()} className="flex shrink-0 items-center gap-2 rounded-xl bg-inverse px-4 py-2.5 text-sm font-semibold text-inverse-text"><Plus size={16} />{zh ? '新建旅程' : 'New journey'}</button>
    </header>
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-100 px-4 py-3 text-sm text-red-800">{error}</p>}
    {loading ? <p className="text-sm text-content-muted">{zh ? '正在读取旅程…' : 'Loading journeys…'}</p> : journeys.length === 0 ?
      <div className="rounded-2xl border border-edge bg-surface-elevated px-6 py-14 text-center text-content-muted">
        <Compass className="mx-auto mb-3" size={30} />
        <p>{zh ? '还没有旅程。选择一段旅行，开始记录。' : 'No journeys yet. Pick a trip and start writing.'}</p>
      </div> :
      <div className="grid gap-4 sm:grid-cols-2">
        {journeys.map(row => <Link key={row.id} to={`/journey/${row.id}`} className="rounded-2xl border border-edge bg-surface-elevated p-5 transition-shadow hover:shadow-lg">
          <div className="mb-3 flex items-center justify-between gap-2"><span className="rounded-full bg-surface-selected px-2.5 py-1 text-xs">{zh ? ({ draft: '草稿', active: '进行中', completed: '已完成', archived: '已归档' } as const)[row.status] : row.status}</span><span className="text-xs text-content-muted">{new Date(row.updated_at).toLocaleDateString()}</span></div>
          <h2 className="text-xl font-semibold">{row.title}</h2>
          {row.subtitle && <p className="mt-1 text-sm text-content-muted">{row.subtitle}</p>}
          <div className="mt-5 flex gap-4 text-xs text-content-muted"><span className="flex items-center gap-1"><CalendarDays size={13} />{(row as Journey & { entry_count?: number }).entry_count ?? 0} {zh ? '条记录' : 'entries'}</span><span className="flex items-center gap-1"><Users size={13} />{zh ? '成员协作' : 'Members'}</span></div>
        </Link>)}
      </div>}
    {creating && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" role="presentation" onClick={() => setCreating(false)}>
      <section role="dialog" aria-modal="true" aria-label={zh ? '新建旅程' : 'New journey'} className="w-full max-w-lg rounded-2xl bg-surface-elevated p-6 text-content-primary" onClick={event => event.stopPropagation()}>
        <h2 className="mb-5 text-xl font-semibold">{zh ? '新建旅程' : 'New journey'}</h2>
        <label className="mb-3 block text-sm">{zh ? '名称' : 'Name'}<input autoFocus value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-surface px-3 py-2" /></label>
        <label className="mb-3 block text-sm">{zh ? '副标题（选填）' : 'Subtitle (optional)'}<input value={subtitle} onChange={event => setSubtitle(event.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-surface px-3 py-2" /></label>
        <fieldset className="max-h-48 overflow-y-auto rounded-lg border border-edge p-3"><legend className="px-1 text-sm">{zh ? '关联旅行（选填）' : 'Linked trips (optional)'}</legend>
          {trips.map(trip => <label key={trip.id} className="flex items-center gap-2 py-1.5 text-sm"><input type="checkbox" checked={selectedTrips.includes(trip.id)} onChange={event => setSelectedTrips(prev => event.target.checked ? [...prev, trip.id] : prev.filter(id => id !== trip.id))} />{trip.title}</label>)}
        </fieldset>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="rounded-lg border border-edge px-4 py-2">{zh ? '取消' : 'Cancel'}</button><button type="button" onClick={() => void create()} disabled={!title.trim() || saving} className="rounded-lg bg-inverse px-4 py-2 text-inverse-text disabled:opacity-50">{saving ? '…' : zh ? '创建' : 'Create'}</button></div>
      </section>
    </div>}
  </main>
}

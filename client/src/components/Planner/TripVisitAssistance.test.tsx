import { fireEvent, render, screen, waitFor } from '../../../tests/helpers/render'
import { buildPlace, buildTrip } from '../../../tests/helpers/factories'
import TripVisitAssistance from './TripVisitAssistance'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-24T12:00:00'))
  sessionStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('TripVisitAssistance', () => {
  it('prompts once for a nearby planned place and only changes it after confirmation', async () => {
    const trip = buildTrip({ id: 11, start_date: '2026-09-23', end_date: '2026-09-25' })
    const place = buildPlace({ id: 7, name: '陈落山', lat: 30, lng: 120 })
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const position = { lat: 30, lng: 120, accuracy: 10, heading: null, speed: null, timestamp: Date.now() }
    const { rerender } = render(<TripVisitAssistance trip={trip} places={[place]} position={position} canEdit onUpdate={onUpdate} />)
    expect(await screen.findByText('你似乎到达了「陈落山」')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
    rerender(<TripVisitAssistance trip={trip} places={[place]} position={{ ...position, timestamp: Date.now() + 1 }} canEdit onUpdate={onUpdate} />)
    expect(screen.queryByText('你似乎到达了「陈落山」')).not.toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('marks a nearby place visited only after the user accepts the prompt', async () => {
    const trip = buildTrip({ id: 13, start_date: '2026-09-23', end_date: '2026-09-25' })
    const place = buildPlace({ id: 8, name: '山边边咖啡', lat: 30, lng: 120 })
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    render(<TripVisitAssistance trip={trip} places={[place]} position={{ lat: 30, lng: 120, accuracy: 10, heading: null, speed: null, timestamp: Date.now() }} canEdit onUpdate={onUpdate} />)
    expect(onUpdate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '标记已访问' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(8, 'visited'))
  })

  it('saves the post-trip review choices and hides the reminder once no places are planned', async () => {
    const trip = buildTrip({ id: 12, start_date: '2026-09-20', end_date: '2026-09-23' })
    const a = buildPlace({ id: 1, name: '小杭坑', visit_status: 'planned' })
    const b = buildPlace({ id: 2, name: '陈落山', visit_status: 'visited' })
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<TripVisitAssistance trip={trip} places={[a, b]} position={null} canEdit onUpdate={onUpdate} />)
    expect(screen.getByText('本次旅行还有 1 个地点未确认')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认访问情况' }))
    const row = screen.getByText('小杭坑').closest('div')!
    fireEvent.click(row.querySelector<HTMLButtonElement>('button[aria-pressed="false"]:last-child')!)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(1, 'skipped'))
    rerender(<TripVisitAssistance trip={trip} places={[{ ...a, visit_status: 'skipped' }, b]} position={null} canEdit onUpdate={onUpdate} />)
    expect(screen.queryByText('本次旅行还有 1 个地点未确认')).not.toBeInTheDocument()
  })
})

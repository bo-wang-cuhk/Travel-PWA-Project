import { buildPlace } from '../../../tests/helpers/factories'
import { nearestUnpromptedPlace, visitAssistancePhase } from './tripVisitAssistanceModel'

describe('trip visit assistance rules', () => {
  it('uses local dates and leaves the trip status independent', () => {
    const trip = { start_date: '2026-09-24', end_date: '2026-09-26' }
    expect(visitAssistancePhase(trip, '2026-09-23')).toBe('other')
    expect(visitAssistancePhase(trip, '2026-09-24')).toBe('active')
    expect(visitAssistancePhase(trip, '2026-09-26')).toBe('active')
    expect(visitAssistancePhase(trip, '2026-09-27')).toBe('ended')
  })

  it('finds only unprompted planned places within 100 metres with usable GPS accuracy', () => {
    const near = buildPlace({ id: 1, lat: 30, lng: 120 })
    const far = buildPlace({ id: 2, lat: 30.002, lng: 120 })
    const visited = buildPlace({ id: 3, lat: 30, lng: 120, visit_status: 'visited' })
    const position = { lat: 30, lng: 120, accuracy: 15, heading: null, speed: null, timestamp: Date.now() }
    expect(nearestUnpromptedPlace([far, visited, near], position, new Set())).toBe(near)
    expect(nearestUnpromptedPlace([near], position, new Set([1]))).toBeNull()
    expect(nearestUnpromptedPlace([near], { ...position, accuracy: 150 }, new Set())).toBeNull()
    expect(nearestUnpromptedPlace([near], { ...position, timestamp: Date.now() - 120_000 }, new Set())).toBeNull()
  })
})

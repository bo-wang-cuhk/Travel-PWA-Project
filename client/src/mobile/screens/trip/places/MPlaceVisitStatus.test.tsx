import { act, fireEvent, render, screen, within } from '../../../../../tests/helpers/render'
import MPlaceVisitStatus from './MPlaceVisitStatus'

describe('mobile place visit status', () => {
  it('quick taps only the icon and changes planned to visited', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onRowClick = vi.fn()
    render(<div onClick={onRowClick}><MPlaceVisitStatus name="陈落山" status="planned" canEdit onUpdate={onUpdate} /></div>)
    fireEvent.click(screen.getByRole('button', { name: /计划中|Planned/ }))
    expect(onUpdate).toHaveBeenCalledWith('visited')
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('long pressing the icon offers all three statuses without quick toggling', () => {
    vi.useFakeTimers()
    try {
      const onUpdate = vi.fn().mockResolvedValue(undefined)
      render(<MPlaceVisitStatus name="陈落山" status="planned" canEdit onUpdate={onUpdate} />)
      const icon = screen.getByRole('button', { name: /计划中|Planned/ })
      fireEvent.touchStart(icon, { touches: [{ clientX: 20, clientY: 30 }] })
      act(() => { vi.advanceTimersByTime(450) })
      fireEvent.touchEnd(icon)
      fireEvent.click(icon)
      const dialog = screen.getByRole('dialog', { name: '陈落山' })
      expect(within(dialog).getAllByRole('button')).toHaveLength(3)
      expect(onUpdate).not.toHaveBeenCalled()
      fireEvent.click(within(dialog).getByRole('button', { name: /未去|Skipped/ }))
      expect(onUpdate).toHaveBeenCalledWith('skipped')
    } finally { vi.useRealTimers() }
  })
})

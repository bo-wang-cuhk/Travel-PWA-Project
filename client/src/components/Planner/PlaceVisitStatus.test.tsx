import { act, fireEvent, render, screen } from '../../../tests/helpers/render'
import { PlaceVisitStatus } from './PlaceVisitStatus'

describe('PlaceVisitStatus', () => {
  const t = (key: string) => key

  it('toggles on click without opening the menu or the row', () => {
    const onToggle = vi.fn()
    const onMenu = vi.fn()
    const onRowClick = vi.fn()
    render(<div onClick={onRowClick}><PlaceVisitStatus status="planned" canEdit t={t} onToggle={onToggle} onMenu={onMenu} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'places.visitPlanned' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onMenu).not.toHaveBeenCalled()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('opens the menu on a long press and suppresses the following click', () => {
    vi.useFakeTimers()
    try {
      const onToggle = vi.fn()
      const onMenu = vi.fn()
      render(<PlaceVisitStatus status="skipped" canEdit t={t} onToggle={onToggle} onMenu={onMenu} />)
      const button = screen.getByRole('button', { name: 'places.visitSkipped' })
      fireEvent.touchStart(button, { touches: [{ clientX: 32, clientY: 48 }] })
      act(() => { vi.advanceTimersByTime(450) })
      fireEvent.touchEnd(button)
      fireEvent.click(button)
      expect(onMenu).toHaveBeenCalledWith(32, 48)
      expect(onToggle).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('does not open a menu after a scrolling gesture', () => {
    vi.useFakeTimers()
    try {
      const onMenu = vi.fn()
      render(<PlaceVisitStatus canEdit t={t} onToggle={vi.fn()} onMenu={onMenu} />)
      const button = screen.getByRole('button', { name: 'places.visitPlanned' })
      fireEvent.touchStart(button, { touches: [{ clientX: 32, clientY: 48 }] })
      fireEvent.touchMove(button, { touches: [{ clientX: 32, clientY: 80 }] })
      act(() => { vi.advanceTimersByTime(500) })
      expect(onMenu).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

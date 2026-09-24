import { useEffect, useRef } from 'react'
import { Check, Circle, Minus } from 'lucide-react'
import type { VisitStatus } from './placeVisitStatusModel'

export function PlaceVisitStatus({ status = 'planned', canEdit, t, onToggle, onMenu, mobile = false }: {
  status?: VisitStatus
  canEdit: boolean
  t: (key: string) => string
  onToggle: () => void
  onMenu: (x: number, y: number) => void
  mobile?: boolean
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const longPressed = useRef(false)
  const Icon = status === 'visited' ? Check : status === 'skipped' ? Minus : Circle
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; origin.current = null }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return <button
    type="button"
    data-no-touch-drag
    draggable={false}
    disabled={!canEdit}
    aria-label={t(status === 'visited' ? 'places.visitVisited' : status === 'skipped' ? 'places.visitSkipped' : 'places.visitPlanned')}
    title={t(status === 'visited' ? 'places.visitVisited' : status === 'skipped' ? 'places.visitSkipped' : 'places.visitPlanned')}
    onClick={e => {
      e.stopPropagation()
      if (longPressed.current) { longPressed.current = false; return }
      if (canEdit) onToggle()
    }}
    onContextMenu={e => {
      e.preventDefault(); e.stopPropagation()
      if (canEdit) onMenu(e.clientX, e.clientY)
    }}
    onTouchStart={e => {
      if (!canEdit || e.touches.length !== 1) return
      const { clientX: x, clientY: y } = e.touches[0]
      origin.current = { x, y }
      longPressed.current = false
      timer.current = setTimeout(() => { longPressed.current = true; onMenu(x, y); clear() }, 450)
    }}
    onTouchMove={e => {
      const start = origin.current
      const touch = e.touches[0]
      if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
        longPressed.current = true
        clear()
      }
    }}
    onTouchEnd={clear}
    onTouchCancel={clear}
    style={{
      width: mobile ? 40 : 28, height: mobile ? 40 : 28, flexShrink: 0, display: 'grid', placeItems: 'center',
      border: 0, borderRadius: 7, padding: 0, background: 'transparent',
      color: status === 'visited' ? '#16a34a' : status === 'skipped'
        ? mobile ? 'var(--m-faint)' : 'var(--text-faint)'
        : mobile ? 'var(--m-muted)' : 'var(--text-muted)',
      cursor: canEdit ? 'pointer' : 'default', touchAction: 'manipulation',
    }}
  ><Icon size={17} strokeWidth={status === 'visited' ? 2.8 : 2} /></button>
}

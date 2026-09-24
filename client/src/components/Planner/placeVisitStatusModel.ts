import { Check, Circle, Minus } from 'lucide-react'
import type { Place } from '../../types'

export type VisitStatus = NonNullable<Place['visit_status']>

export const statusOptions: Array<{ value: VisitStatus; icon: typeof Circle; key: string }> = [
  { value: 'planned', icon: Circle, key: 'places.visitPlanned' },
  { value: 'visited', icon: Check, key: 'places.visitVisited' },
  { value: 'skipped', icon: Minus, key: 'places.visitSkipped' },
]

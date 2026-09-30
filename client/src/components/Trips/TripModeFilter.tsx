import type { TripType } from '@trek/shared'
import { useTranslation } from '../../i18n'

export type TripModeFilterValue = 'all' | TripType
export default function TripModeFilter({ value, onChange }: {
  value: TripModeFilterValue
  onChange: (value: TripModeFilterValue) => void
}) {
  const { t } = useTranslation()
  return <div className="flex flex-wrap gap-2" role="group" aria-label={t('trip.mode.label')}>
    {(['all', 'trip', 'outing'] as const).map(type => <button type="button" key={type}
      aria-pressed={value === type} onClick={() => onChange(type)}
      className={`rounded-full border px-3 py-1 text-caption ${value === type ? 'border-accent bg-accent text-accent-text' : 'border-edge bg-surface text-content'}`}>
      {t(type === 'all' ? 'common.all' : `trip.mode.${type}`)}
    </button>)}
  </div>
}

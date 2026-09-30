import type { TripType } from '@trek/shared'
import { useTranslation } from '../../i18n'

export default function TripTypePicker({ value, onChange, disabled = false, canChooseOuting = true }: {
  value: TripType
  onChange: (value: TripType) => void
  disabled?: boolean
  canChooseOuting?: boolean
}) {
  const { t } = useTranslation()
  return <fieldset disabled={disabled} className="flex flex-wrap gap-2">
    <legend className="mb-2 text-caption text-content-muted">{t('trip.mode.label')}</legend>
    {(['trip', 'outing'] as const).map(type => <button key={type} type="button"
      disabled={type === 'outing' && !canChooseOuting}
      aria-pressed={value === type}
      onClick={() => onChange(type)}
      className={`rounded-lg border px-3 py-2 text-body disabled:opacity-50 ${value === type ? 'border-accent bg-accent text-accent-text' : 'border-edge bg-surface text-content'}`}>
      {t(`trip.mode.${type}`)}
    </button>)}
  </fieldset>
}

import type { TripType } from '@trek/shared'
import { useTranslation } from '../../i18n'

export default function TripTypePicker({ value, onChange, disabled = false, canChooseOuting = true, mobile = false }: {
  value: TripType
  onChange: (value: TripType) => void
  disabled?: boolean
  canChooseOuting?: boolean
  mobile?: boolean
}) {
  const { t } = useTranslation()
  return <fieldset disabled={disabled} className={`flex flex-wrap gap-2 ${mobile ? 'mb-3' : ''}`}>
    <legend className={`mb-2 text-caption ${mobile ? 'text-m-muted' : 'text-content-muted'}`}>{t('trip.mode.label')}</legend>
    {(['trip', 'outing'] as const).map(type => <button key={type} type="button"
      disabled={type === 'outing' && !canChooseOuting}
      aria-pressed={value === type}
      onClick={() => onChange(type)}
      className={mobile
        ? `rounded-full border px-3 py-2 text-body disabled:opacity-50 ${value === type ? 'border-transparent bg-m-act text-m-actfg' : 'border-[color:var(--m-gbr)] bg-[color:var(--m-ic)] text-m-ink'}`
        : `rounded-lg border px-3 py-2 text-body disabled:opacity-50 ${value === type ? 'border-accent bg-accent text-accent-text' : 'border-edge bg-surface text-content'}`}>
      {t(`trip.mode.${type}`)}
    </button>)}
  </fieldset>
}

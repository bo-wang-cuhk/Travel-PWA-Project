import type { TranslationFn } from '../../types'
import type { FootprintViewMode } from './footprintViewModel'
export default function FootprintViewToggle({ mode, onChange, t, mobile = false }: {
  mode: FootprintViewMode; onChange: (mode: FootprintViewMode) => void; t: TranslationFn; mobile?: boolean
}) {
  return <div role="group" aria-label={t('atlas.viewMode')} className={`flex shrink-0 gap-1 rounded-full border p-1 ${mobile ? 'border-[color:var(--m-gbr)] bg-[color:var(--m-sheet)]' : 'border-edge bg-surface-card'}`}>
    {(['china', 'global'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onChange(value)} className={`rounded-full px-3 py-2 text-xs font-semibold ${mode === value ? (mobile ? 'bg-m-ink text-m-bg' : 'bg-inverse text-inverse-text') : (mobile ? 'text-m-ink' : 'text-content')}`}>
      {t(`atlas.viewMode.${value}`)}
    </button>)}
  </div>
}

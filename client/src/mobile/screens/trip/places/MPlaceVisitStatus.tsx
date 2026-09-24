import { useState } from 'react'
import { PlaceVisitStatus } from '../../../../components/Planner/PlaceVisitStatus'
import { statusOptions, type VisitStatus } from '../../../../components/Planner/placeVisitStatusModel'
import { useTranslation } from '../../../../i18n'
import MSheet from '../../../components/MSheet'
import { useToast } from '../../../../components/shared/Toast'

export default function MPlaceVisitStatus({ name, status = 'planned', canEdit, onUpdate }: {
  name: string
  status?: VisitStatus
  canEdit: boolean
  onUpdate: (status: VisitStatus) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)

  const update = async (next: VisitStatus) => {
    setMenuOpen(false)
    if (next !== status) {
      try { await onUpdate(next) }
      catch { toast.error(t('common.error')) }
    }
  }

  return <>
    <PlaceVisitStatus
      mobile
      status={status}
      canEdit={canEdit}
      t={t}
      onToggle={() => { if (status !== 'skipped') void update(status === 'visited' ? 'planned' : 'visited') }}
      onMenu={() => setMenuOpen(true)}
    />
    <MSheet open={menuOpen} onClose={() => setMenuOpen(false)} variant="bottom" material="opaque" ariaLabel={name}>
      <div className="px-4 pb-4 pt-3">
        <div className="mb-2 truncate text-[0.8125rem] font-semibold text-m-muted">{name}</div>
        {statusOptions.map(option => <button
          key={option.value}
          type="button"
          onClick={() => void update(option.value)}
          aria-pressed={status === option.value}
          className="flex w-full items-center gap-3 border-t border-[color:var(--m-rowbr)] py-3 text-left text-[0.875rem] font-semibold text-m-ink"
        >
          <option.icon size={17} color={option.value === 'visited' ? '#16a34a' : 'var(--m-muted)'} />
          <span className="flex-1">{t(option.key)}</span>
          {status === option.value && <span className="text-m-muted">✓</span>}
        </button>)}
      </div>
    </MSheet>
  </>
}

import React from 'react'
import { Clock, ExternalLink, Phone, Star } from 'lucide-react'
import { useCachedPlaceDetails, type PlaceDetailsIdentity } from '../../services/placeDetails'
import { safeHttpUrl } from '../../utils/safeUrl'
import type { TranslationFn } from '../../types'
import type { PlaceDetailsSelection } from './PlaceDetailsColumn'

interface Props {
  selection: PlaceDetailsSelection | null
  language: string
  locale: string
  t: TranslationFn
}

export default function ProviderPlaceDetailsColumn({ selection, language, locale, t }: Props): React.ReactElement {
  const identity: PlaceDetailsIdentity | null = (selection?.source === 'baidu' || selection?.source === 'osm') && selection.providerPlaceId
    ? {
      placeId: `search:${selection.source}:${selection.providerPlaceId}`,
      provider: selection.source,
      providerPlaceId: selection.providerPlaceId,
    } : null
  const details = useCachedPlaceDetails(identity, language)
  const website = safeHttpUrl(details?.website)

  return (
    <aside className="w-full sm:w-80 shrink-0 rounded-xl border border-edge bg-surface-secondary p-3 space-y-3">
      <p className="text-caption font-semibold uppercase tracking-[0.14em] text-content-faint">
        {t('places.details.title')}{details && ` · ${details.provider === 'osm' ? 'OpenStreetMap' : 'Baidu'}`}
      </p>
      {!identity && <p className="text-sm text-content-muted">{selection ? t('places.details.error') : t('places.details.empty')}</p>}
      {identity && details && <>
        {details.photoUrl && <img src={details.photoUrl} alt="" className="w-full h-32 rounded-lg object-cover" />}
        {details.rating != null && <div className="flex items-center gap-2 text-sm text-content">
          <Star size={15} fill="#facc15" color="#facc15" />
          {details.rating.toFixed(1)}{details.ratingCount != null && ` (${details.ratingCount.toLocaleString(locale)})`}
        </div>}
        {details.openingHours && <div className="flex gap-2 text-sm text-content-muted"><Clock size={15} className="shrink-0" /><span className="whitespace-pre-line">{details.openingHours}</span></div>}
        {details.phone && <a href={`tel:${details.phone}`} className="flex gap-2 text-sm text-content-muted"><Phone size={15} />{details.phone}</a>}
        {website && <a href={website} target="_blank" rel="noopener noreferrer" className="flex gap-2 text-sm text-accent"><ExternalLink size={15} />{website}</a>}
        {details.description && <p className="text-sm text-content-muted">{details.description}</p>}
      </>}
    </aside>
  )
}

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProviderPlaceDetailsColumn from './ProviderPlaceDetailsColumn'
import type { TranslationFn } from '../../types'

const useCachedPlaceDetails = vi.fn()
vi.mock('../../services/placeDetails', () => ({ useCachedPlaceDetails: (identity: unknown) => useCachedPlaceDetails(identity) }))
const t = ((key: string) => key) as TranslationFn

describe('provider place details column', () => {
  it('shows Baidu facts for the selected UID', () => {
    useCachedPlaceDetails.mockReturnValue({ provider: 'baidu', rating: 4.6, ratingCount: 29, openingHours: '09:00-18:00' })
    render(<ProviderPlaceDetailsColumn selection={{ source: 'baidu', providerPlaceId: 'uid-1', lat: 1, lng: 2, name: 'Cafe' }} language="zh" locale="zh-CN" t={t} />)
    expect(useCachedPlaceDetails).toHaveBeenCalledWith({ placeId: 'search:baidu:uid-1', provider: 'baidu', providerPlaceId: 'uid-1' })
    expect(screen.getByText(/4\.6/)).toBeTruthy()
    expect(screen.getByText('09:00-18:00')).toBeTruthy()
  })

  it('does not request Google details', () => {
    useCachedPlaceDetails.mockReturnValue(null)
    render(<ProviderPlaceDetailsColumn selection={{ source: 'google', providerPlaceId: 'google-id', lat: 1, lng: 2, name: 'Cafe' }} language="zh" locale="zh-CN" t={t} />)
    expect(useCachedPlaceDetails).toHaveBeenCalledWith(null)
    expect(screen.getByText('places.details.error')).toBeTruthy()
  })
})

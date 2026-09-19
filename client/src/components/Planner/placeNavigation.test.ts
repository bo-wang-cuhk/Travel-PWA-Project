import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNavigationTargets, openNavigationTarget, showsAppleMaps } from './placeNavigation'
import { useSettingsStore } from '../../store/settingsStore'
import type { Place } from '../../types'

function place(overrides: Partial<Place> = {}): Place {
  return { name: 'Stephansdom', lat: 48.2038, lng: 16.3616, ...overrides } as Place
}

beforeEach(() => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, default_map_app: 'ask', language: 'en' } }))
})

afterEach(() => { vi.restoreAllMocks() })

describe('getNavigationTargets', () => {
  it('offers the four provider adapters when the preference is ask', () => {
    expect(getNavigationTargets(place()).map(target => target.id)).toEqual(['google', 'amap', 'baidu', 'apple'])
  })

  it('returns only the configured default app', () => {
    useSettingsStore.setState(state => ({ settings: { ...state.settings, default_map_app: 'amap' } }))
    expect(getNavigationTargets(place()).map(target => target.id)).toEqual(['amap'])
  })

  it('keeps coordinate-less name search on providers that support it', () => {
    expect(getNavigationTargets(place({ lat: null, lng: null })).map(target => target.id)).toEqual(['google', 'apple'])
  })

  it('returns nothing when neither a label nor coordinates are available', () => {
    expect(getNavigationTargets(null)).toEqual([])
    expect(getNavigationTargets(place({ lat: null, lng: null, name: '', address: '' }))).toEqual([])
  })

  it('offers Apple Maps through its app or web fallback', () => {
    expect(showsAppleMaps()).toBe(true)
  })
})

describe('openNavigationTarget', () => {
  const target = { id: 'google', label: 'Google Maps', url: 'https://maps.google.com/?q=1,2' } as const

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  function stubDisplayMode(installed: boolean, iosStandalone = false) {
    const open = vi.fn()
    const assigned: string[] = []
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: installed && q.includes('display-mode') }),
      navigator: { standalone: iosStandalone },
      open,
      get location() { return { get href() { return '' }, set href(v: string) { assigned.push(v) } } },
    })
    return { open, assigned }
  }

  it('opens a new tab from a browser tab', () => {
    const { open, assigned } = stubDisplayMode(false)
    openNavigationTarget(target)
    expect(open).toHaveBeenCalledWith(target.url, '_blank', 'noopener,noreferrer')
    expect(assigned).toEqual([])
  })

  it('hands off from the current context in an installed PWA', () => {
    const { open, assigned } = stubDisplayMode(true)
    openNavigationTarget(target)
    expect(open).not.toHaveBeenCalled()
    expect(assigned).toEqual([target.url])
  })

  it('recognises an iOS home-screen app', () => {
    const { open, assigned } = stubDisplayMode(false, true)
    openNavigationTarget(target)
    expect(open).not.toHaveBeenCalled()
    expect(assigned).toEqual([target.url])
  })
})

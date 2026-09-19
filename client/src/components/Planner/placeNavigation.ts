import type { AssignmentPlace, Place } from '../../types'
import { getMapTargets, type MapLaunchTarget, type MapProvider } from '../../mapLauncher'
import { useSettingsStore } from '../../store/settingsStore'

type PlaceLike = Pick<Place | AssignmentPlace, 'name' | 'address' | 'lat' | 'lng'> & {
  google_place_id?: string | null
  google_ftid?: string | null
}

export type NavigationAppId = MapProvider
export type NavigationTarget = MapLaunchTarget

/** Retained for compatibility; Apple Maps now has a web fallback on every platform. */
export function showsAppleMaps(): boolean {
  return true
}

/**
 * Provider-neutral external-map handoff. The preference is read at the adapter
 * boundary; business models and page components only pass a WGS84 place.
 */
export function getNavigationTargets(
  place: PlaceLike | null | undefined,
  _detailsUrl?: string | null,
): NavigationTarget[] {
  if (!place) return []
  const settings = useSettingsStore.getState().settings
  return getMapTargets(place, settings.default_map_app || 'ask', settings.language)
}

export function openNavigationTarget(target: NavigationTarget): void {
  if (isInstalledApp()) window.location.href = target.url
  else window.open(target.url, '_blank', 'noopener,noreferrer')
}

function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false
  const standalone = ['standalone', 'fullscreen', 'minimal-ui'].some(
    mode => window.matchMedia?.(`(display-mode: ${mode})`).matches,
  )
  return standalone || (window.navigator as { standalone?: boolean }).standalone === true
}

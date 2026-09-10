import type { User } from '../types'

/**
 * Temporary local-first runtime used by the personal PWA build. Tests keep the
 * original server-backed behaviour so the upstream TREK contracts remain covered.
 * Set VITE_STANDALONE_MODE=false to run the original TREK client against a server.
 */
export const STANDALONE_MODE =
  import.meta.env.MODE !== 'test' && import.meta.env.VITE_STANDALONE_MODE !== 'false'

export const LOCAL_USER: User = {
  id: 0,
  username: '旅行者',
  email: 'local@trek.invalid',
  role: 'user',
  avatar_url: null,
  maps_api_key: null,
  created_at: '2026-01-01T00:00:00.000Z',
  mfa_enabled: false,
  must_change_password: false,
}

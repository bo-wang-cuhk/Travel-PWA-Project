import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearAll, offlineDb } from '../db/offlineDb'
import { DEFAULT_GITHUB_CONFIG, GITHUB_PROVIDER_ID, syncSettingsRepository } from './syncSettingsRepository'

beforeEach(async () => { await clearAll() })

describe('syncSettingsRepository', () => {
  it('keeps public repository configuration separate from the device credential', async () => {
    const config = { ...DEFAULT_GITHUB_CONFIG, enabled: true }
    await syncSettingsRepository.saveGitHub(config, '  github_pat_secret  ')

    expect(await offlineDb.syncProviderConfig.get(GITHUB_PROVIDER_ID)).toEqual({
      providerId: GITHUB_PROVIDER_ID,
      config,
    })
    expect(await offlineDb.syncCredentials.get(GITHUB_PROVIDER_ID)).toEqual({
      providerId: GITHUB_PROVIDER_ID,
      secret: 'github_pat_secret',
    })
  })

  it('disconnects without deleting local business data', async () => {
    await offlineDb.trips.put({
      id: -1,
      sync_id: 'e11a8617-d81f-4db4-9506-5685ceaa5137',
      user_id: 0,
      title: 'Kept locally',
      description: null,
      start_date: null,
      end_date: null,
      currency: 'EUR',
      cover_image: null,
      is_archived: 0,
      reminder_days: 3,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    })
    await syncSettingsRepository.saveGitHub({ ...DEFAULT_GITHUB_CONFIG, enabled: true }, 'token')

    await syncSettingsRepository.disconnectGitHub()

    expect((await syncSettingsRepository.getGitHub()).config.enabled).toBe(false)
    expect((await syncSettingsRepository.getGitHub()).token).toBe('')
    expect((await offlineDb.trips.get(-1))?.title).toBe('Kept locally')
  })
})

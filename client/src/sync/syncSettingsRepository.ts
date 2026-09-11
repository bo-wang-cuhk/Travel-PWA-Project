import { offlineDb } from '../db/offlineDb'
import type { GitHubSyncPublicConfig } from './types'

export const GITHUB_PROVIDER_ID = 'github'

export const DEFAULT_GITHUB_CONFIG: GitHubSyncPublicConfig = {
  owner: 'bo-wang-cuhk',
  repository: 'travel-data-private',
  branch: 'main',
  enabled: false,
}

export const syncSettingsRepository = {
  async getGitHub(): Promise<{ config: GitHubSyncPublicConfig; token: string }> {
    const [row, credential] = await Promise.all([
      offlineDb.syncProviderConfig.get(GITHUB_PROVIDER_ID),
      offlineDb.syncCredentials.get(GITHUB_PROVIDER_ID),
    ])
    return {
      config: { ...DEFAULT_GITHUB_CONFIG, ...(row?.config ?? {}) },
      token: credential?.secret ?? '',
    }
  },

  async saveGitHub(config: GitHubSyncPublicConfig, token?: string): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.syncProviderConfig, offlineDb.syncCredentials], async () => {
      await offlineDb.syncProviderConfig.put({ providerId: GITHUB_PROVIDER_ID, config })
      if (token !== undefined) {
        if (token.trim()) await offlineDb.syncCredentials.put({ providerId: GITHUB_PROVIDER_ID, secret: token.trim() })
        else await offlineDb.syncCredentials.delete(GITHUB_PROVIDER_ID)
      }
    })
  },

  async disconnectGitHub(): Promise<void> {
    await offlineDb.transaction('rw', [offlineDb.syncProviderConfig, offlineDb.syncCredentials], async () => {
      const current = await offlineDb.syncProviderConfig.get(GITHUB_PROVIDER_ID)
      await offlineDb.syncProviderConfig.put({
        providerId: GITHUB_PROVIDER_ID,
        config: { ...DEFAULT_GITHUB_CONFIG, ...(current?.config ?? {}), enabled: false },
      })
      await offlineDb.syncCredentials.delete(GITHUB_PROVIDER_ID)
    })
  },
}

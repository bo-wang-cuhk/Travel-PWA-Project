import { describe, expect, it, vi } from 'vitest'

vi.mock('../config/runtimeMode', () => ({ STANDALONE_MODE: true }))

import { apiClient, pluginsApi, weatherApi } from './client'

describe('static PWA server-only APIs', () => {
  it('does not request the missing plugin contribution or weather routes', async () => {
    const get = vi.spyOn(apiClient, 'get')
    try {
      await expect(pluginsApi.viewContributions('places', -1)).resolves.toEqual({ contributions: [] })
      await expect(weatherApi.get(30.6, 119.6, '2026-09-25', 'zh')).resolves.toMatchObject({ error: 'no_forecast' })
      await expect(weatherApi.getCurrent(30.6, 119.6, 'zh')).resolves.toMatchObject({ error: 'no_forecast' })
      await expect(weatherApi.getDetailed(30.6, 119.6, '2026-09-25', 'zh')).resolves.toMatchObject({ error: 'no_forecast' })
      expect(get).not.toHaveBeenCalled()
    } finally {
      get.mockRestore()
    }
  })
})

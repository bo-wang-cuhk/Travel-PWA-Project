import { describe, expect, it, vi } from 'vitest'

vi.mock('../config/runtimeMode', () => ({ STANDALONE_MODE: true }))

import { apiClient, journeyApi, pluginsApi, weatherApi } from './client'
import { journeyRepo } from '../repo/journeyRepo'

describe('static PWA server-only APIs', () => {
  it('creates journeys and lists available trips through IndexedDB without server requests', async () => {
    const post = vi.spyOn(apiClient, 'post')
    const get = vi.spyOn(apiClient, 'get')
    const create = vi.spyOn(journeyRepo, 'create').mockResolvedValue({ id: -1, title: '安吉' } as never)
    const availableTrips = vi.spyOn(journeyRepo, 'availableTrips').mockResolvedValue({ trips: [] })
    try {
      await expect(journeyApi.availableTrips()).resolves.toEqual({ trips: [] })
      await expect(journeyApi.create({ title: '安吉' })).resolves.toMatchObject({ id: -1, title: '安吉' })
      expect(availableTrips).toHaveBeenCalledOnce()
      expect(create).toHaveBeenCalledWith({ title: '安吉' })
      expect(get).not.toHaveBeenCalled()
      expect(post).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from '../../../tests/helpers/render'
import OfflineBanner from './OfflineBanner'

vi.mock('../../config/runtimeMode', () => ({ STANDALONE_MODE: true }))

vi.mock('../../sync/mutationQueue', () => ({
  mutationQueue: {
    pendingCount: vi.fn(),
    failedCount: vi.fn(),
    conflictCount: vi.fn(),
  },
}))

import { mutationQueue } from '../../sync/mutationQueue'
import { _resetNetworkMode } from '../../sync/networkMode'

const pendingCount = mutationQueue.pendingCount as ReturnType<typeof vi.fn>
const failedCount = mutationQueue.failedCount as ReturnType<typeof vi.fn>
const conflictCount = mutationQueue.conflictCount as ReturnType<typeof vi.fn>

afterEach(() => {
  vi.clearAllMocks()
  _resetNetworkMode()
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true })
})

describe('OfflineBanner (B3 surface)', () => {
  it('shows the failed pill when failedCount > 0 while online', async () => {
    pendingCount.mockResolvedValue(0)
    failedCount.mockResolvedValue(2)
    conflictCount.mockResolvedValue(0)

    render(<OfflineBanner />)

    expect(await screen.findByText(/(?:failed to sync|同步失败).*2/i)).toBeInTheDocument()
  })

  it('shows the conflict pill when conflicts exist while online', async () => {
    pendingCount.mockResolvedValue(0)
    failedCount.mockResolvedValue(0)
    conflictCount.mockResolvedValue(3)

    render(<OfflineBanner />)

    expect(await screen.findByText(/(?:conflicts|冲突).*3/i)).toBeInTheDocument()
  })

  it('hides the plain offline pill in standalone mode when there is nothing actionable', async () => {
    pendingCount.mockResolvedValue(0)
    failedCount.mockResolvedValue(0)
    conflictCount.mockResolvedValue(0)

    const { container } = render(<OfflineBanner />)
    // Give the async poll a tick to resolve.
    await waitFor(() => expect(failedCount).toHaveBeenCalled())
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})

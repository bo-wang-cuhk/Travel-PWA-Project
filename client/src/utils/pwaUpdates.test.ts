import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPwaUpdates } from './pwaUpdates'

afterEach(() => vi.restoreAllMocks())

describe('installed PWA updates', () => {
  it('checks on launch and resume, then reloads when a new worker takes control', async () => {
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const update = vi.fn().mockResolvedValue(undefined)
    const worker = Object.assign(new EventTarget(), {
      controller: {},
      ready: Promise.resolve({ update }),
    }) as unknown as ServiceWorkerContainer
    const reload = vi.fn()
    const dispose = installPwaUpdates(worker, reload)

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    now += 61_000
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    worker.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledOnce()
    dispose()
  })

  it('does not reload when the first worker claims a fresh installation', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000)
    const worker = Object.assign(new EventTarget(), {
      controller: null,
      ready: Promise.resolve({ update: vi.fn().mockResolvedValue(undefined) }),
    }) as unknown as ServiceWorkerContainer
    const reload = vi.fn()
    const dispose = installPwaUpdates(worker, reload)
    worker.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    dispose()
  })
})

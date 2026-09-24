import { afterEach, describe, expect, it, vi } from 'vitest'
import { installPwaUpdates } from './pwaUpdates'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('installed PWA updates', () => {
  it('checks after a resumed page settles, then reloads when a new worker takes control', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'))
    const update = vi.fn().mockResolvedValue(undefined)
    const worker = Object.assign(new EventTarget(), {
      controller: {},
      ready: Promise.resolve({ update }),
    }) as unknown as ServiceWorkerContainer
    const reload = vi.fn()
    const dispose = installPwaUpdates(worker, reload)

    expect(update).not.toHaveBeenCalled()
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(4_999)
    expect(update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await Promise.resolve()
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(5_000)
    expect(update).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50 * 60_000)
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(5_000)
    await Promise.resolve()
    expect(update).toHaveBeenCalledTimes(2)
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

/** One request lane shared by search, reverse geocoding and URL resolution in a warm Edge isolate. */
let nextRequestAt = 0
let lane: Promise<void> = Promise.resolve()

export function osmRequest(url: string, lang: string | undefined, userAgent: string): Promise<unknown> {
  const request = lane.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now())
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs))
    nextRequestAt = Date.now() + 1_100

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': lang || 'zh-CN,zh;q=0.9,en;q=0.7',
        'User-Agent': userAgent,
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      // A local cooldown prevents a warm isolate from immediately repeating a
      // rejected request. The public limit is app-wide, so this is not a global quota.
      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers.get('Retry-After'))
        const cooldownMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1_000, 60_000) : 30_000
        nextRequestAt = Math.max(nextRequestAt, Date.now() + cooldownMs)
      }
      throw new Error(`OSM HTTP ${response.status}`)
    }
    return response.json()
  })
  lane = request.then(() => {}, () => {})
  return request
}

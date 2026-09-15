import { describe, expect, it } from 'vitest'
import { formatTimeZoneName, shortTimeZoneName } from './timeZoneDisplay'

describe('timeZoneDisplay', () => {
  it('shows common zones as Chinese city names', () => {
    expect(formatTimeZoneName('Asia/Shanghai', 'zh-CN')).toBe('上海')
    expect(formatTimeZoneName('Europe/London', 'zh-CN')).toBe('伦敦')
    expect(formatTimeZoneName('Asia/Tokyo', 'zh-CN')).toBe('东京')
  })

  it('keeps the existing city-style label in non-Chinese locales', () => {
    expect(formatTimeZoneName('America/New_York', 'en')).toBe('New York')
    expect(shortTimeZoneName('America/Los_Angeles')).toBe('Los Angeles')
  })
})

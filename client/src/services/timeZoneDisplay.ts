const COMMON_ZH_NAMES: Record<string, string> = {
  UTC: '协调世界时',
  'Europe/London': '伦敦',
  'Europe/Paris': '巴黎',
  'Europe/Berlin': '柏林',
  'Europe/Madrid': '马德里',
  'Europe/Moscow': '莫斯科',
  'America/New_York': '纽约',
  'America/Chicago': '芝加哥',
  'America/Denver': '丹佛',
  'America/Los_Angeles': '洛杉矶',
  'America/Sao_Paulo': '圣保罗',
  'Asia/Dubai': '迪拜',
  'Asia/Kolkata': '加尔各答',
  'Asia/Bangkok': '曼谷',
  'Asia/Shanghai': '上海',
  'Asia/Tokyo': '东京',
  'Asia/Singapore': '新加坡',
  'Australia/Sydney': '悉尼',
  'Pacific/Auckland': '奥克兰',
}

const COMMON_ZH_TW_NAMES: Record<string, string> = {
  ...COMMON_ZH_NAMES,
  UTC: '世界協調時間',
  'Europe/London': '倫敦',
  'Europe/Paris': '巴黎',
  'Europe/Madrid': '馬德里',
  'Europe/Moscow': '莫斯科',
  'America/New_York': '紐約',
  'America/Chicago': '芝加哥',
  'America/Denver': '丹佛',
  'America/Los_Angeles': '洛杉磯',
  'America/Sao_Paulo': '聖保羅',
  'Asia/Dubai': '杜拜',
  'Asia/Kolkata': '加爾各答',
  'Asia/Bangkok': '曼谷',
  'Asia/Tokyo': '東京',
  'Asia/Singapore': '新加坡',
  'Australia/Sydney': '雪梨',
  'Pacific/Auckland': '奧克蘭',
}

export function shortTimeZoneName(timeZone: string): string {
  return (timeZone.split('/').pop() || timeZone).replace(/_/g, ' ')
}

/** Localize dashboard zone labels without changing their stored IANA identifiers. */
export function formatTimeZoneName(timeZone: string, locale: string): string {
  const normalizedLocale = locale.toLowerCase()
  if (!normalizedLocale.startsWith('zh')) return shortTimeZoneName(timeZone)

  const commonNames = normalizedLocale.includes('tw') || normalizedLocale.includes('hant')
    ? COMMON_ZH_TW_NAMES
    : COMMON_ZH_NAMES
  if (commonNames[timeZone]) return commonNames[timeZone]

  try {
    const part = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: timeZone === 'UTC' ? 'long' : 'longGeneric',
    }).formatToParts(new Date()).find(item => item.type === 'timeZoneName')
    return part?.value || shortTimeZoneName(timeZone)
  } catch {
    return shortTimeZoneName(timeZone)
  }
}

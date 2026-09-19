export interface Coordinate {
  lat: number
  lng: number
}

const PI = Math.PI
const AXIS = 6378245.0
const ECCENTRICITY = 0.006693421622965943

function outsideMainlandChina({ lat, lng }: Coordinate): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3
  value += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3
  value += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3
  return value
}

function transformLng(x: number, y: number): number {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  value += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3
  value += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3
  value += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3
  return value
}

/** WGS84 -> GCJ-02. Coordinates outside mainland China remain unchanged. */
export function wgs84ToGcj02(point: Coordinate): Coordinate {
  if (outsideMainlandChina(point)) return { ...point }
  let dLat = transformLat(point.lng - 105, point.lat - 35)
  let dLng = transformLng(point.lng - 105, point.lat - 35)
  const radLat = point.lat / 180 * PI
  let magic = Math.sin(radLat)
  magic = 1 - ECCENTRICITY * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / ((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic) * PI)
  dLng = (dLng * 180) / (AXIS / sqrtMagic * Math.cos(radLat) * PI)
  return { lat: point.lat + dLat, lng: point.lng + dLng }
}

/** GCJ-02 -> BD-09, used only at the Baidu adapter boundary. */
export function gcj02ToBd09(point: Coordinate): Coordinate {
  const x = point.lng
  const y = point.lat
  const z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * PI * 3000 / 180)
  const theta = Math.atan2(y, x) + 0.000003 * Math.cos(x * PI * 3000 / 180)
  return { lat: z * Math.sin(theta) + 0.006, lng: z * Math.cos(theta) + 0.0065 }
}

export function wgs84ToBd09(point: Coordinate): Coordinate {
  return gcj02ToBd09(wgs84ToGcj02(point))
}

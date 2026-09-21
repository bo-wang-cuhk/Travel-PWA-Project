// Build the static, browser-sized Atlas boundaries from TREK's bundled data.
// Run with: node --max-old-space-size=2048 scripts/build-atlas-geo.mjs
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'

const output = new URL('../client/public/atlas/', import.meta.url)
mkdirSync(output, { recursive: true })

function distanceSquared(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const scale = dx * dx + dy * dy
  const t = scale ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / scale)) : 0
  const x = start[0] + t * dx, y = start[1] + t * dy
  return (point[0] - x) ** 2 + (point[1] - y) ** 2
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 5) return ring
  const points = ring.slice(0, -1)
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let distance = 0, index = -1
    for (let i = a + 1; i < b; i++) {
      const next = distanceSquared(points[i], points[a], points[b])
      if (next > distance) { distance = next; index = i }
    }
    if (index !== -1 && distance > tolerance * tolerance) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  const result = points.filter((_, i) => keep[i])
  if (result.length < 3) return ring
  return [...result, result[0]]
}

function simplifyGeometry(geometry, tolerance) {
  const polygon = rings => rings.map(ring => simplifyRing(ring, tolerance))
  return { ...geometry, coordinates: geometry.type === 'Polygon'
    ? polygon(geometry.coordinates)
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates.map(polygon)
      : geometry.coordinates }
}

for (const [name, tolerance] of [['admin0', 0.025], ['admin1', 0.035]]) {
  const source = new URL(`../server/assets/atlas/${name}.geojson.gz`, import.meta.url)
  const geo = JSON.parse(gunzipSync(readFileSync(source)).toString('utf8'))
  geo.features = geo.features.map(feature => ({ ...feature, geometry: simplifyGeometry(feature.geometry, tolerance) }))
  const target = new URL(`${name}.geojson.gz`, output)
  writeFileSync(target, gzipSync(JSON.stringify(geo), { level: 9 }))
  console.log(`${name}: ${geo.features.length} features, ${readFileSync(target).length} bytes`)
}

export type LngLat = [number, number] // [lon, lat]

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Great-circle distance in meters. */
export function distance(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1])
  const dLon = rad(b[0] - a[0])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Initial bearing from a to b, degrees clockwise from north (0..360). */
export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]))
  const x =
    Math.cos(rad(a[1])) * Math.sin(rad(b[1])) -
    Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number) {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return (a + d * t + 360) % 360
}

/**
 * Project point p onto segment ab using a local equirectangular approximation
 * (accurate enough at street scale). Returns the clamped fraction and distance.
 */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat) {
  const k = Math.cos(rad(p[1]))
  const ax = a[0] * k, ay = a[1]
  const bx = b[0] * k, by = b[1]
  const px = p[0] * k, py = p[1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const point = lerpLngLat(a, b, t)
  return { t, point, dist: distance(p, point) }
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export function cardinal(heading: number) {
  return CARDINALS[Math.round((((heading % 360) + 360) % 360) / 45) % 8]
}

export function formatDistance(m: number): string {
  if (!isFinite(m)) return ''
  if (m < 1000) {
    const step = m < 100 ? 10 : 50
    return `${Math.max(step, Math.round(m / step) * step)} m`
  }
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} hr ${rest} min` : `${h} hr`
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Decode a Valhalla polyline6 string into [lon, lat] pairs. */
export function decodePolyline6(str: string): LngLat[] {
  const coords: LngLat[] = []
  let index = 0, lat = 0, lon = 0
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte: number
      do {
        byte = str.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    coords.push([lon / 1e6, lat / 1e6])
  }
  return coords
}

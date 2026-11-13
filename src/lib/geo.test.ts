import { describe, expect, it } from 'vitest'
import { bearing, cardinal, decodePolyline6, distance, formatDistance, formatDuration, lerpAngle, projectOnSegment } from './geo'

/** Encoder for the tests (the app only decodes Valhalla's polyline6). */
function encode6(points: [number, number][]) {
  let out = ''
  let prevLat = 0
  let prevLon = 0
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    out += String.fromCharCode(v + 63)
  }
  for (const [lon, lat] of points) {
    const la = Math.round(lat * 1e6)
    const lo = Math.round(lon * 1e6)
    enc(la - prevLat)
    enc(lo - prevLon)
    prevLat = la
    prevLon = lo
  }
  return out
}

describe('geo', () => {
  it('measures Yerevan → Tbilisi as ~173 km (straight line)', () => {
    expect(distance([44.5126, 40.1777], [44.8271, 41.7151]) / 1000).toBeCloseTo(173, 0)
  })

  it('computes compass bearings', () => {
    expect(bearing([44.5, 40.18], [44.5, 40.19])).toBeCloseTo(0, 0)
    expect(bearing([44.5, 40.18], [44.51, 40.18])).toBeCloseTo(90, 0)
    expect(cardinal(44)).toBe('NE')
    expect(cardinal(359)).toBe('N')
  })

  it('interpolates angles across north', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 5)
  })

  it('projects a point onto a road segment', () => {
    const r = projectOnSegment([44.505, 40.181], [44.5, 40.18], [44.51, 40.18])
    expect(r.t).toBeCloseTo(0.5, 2)
    expect(r.dist).toBeCloseTo(111, -1) // 0.001° of latitude
  })

  it('decodes Valhalla polyline6', () => {
    const pts: [number, number][] = [[44.512645, 40.177681], [44.513001, 40.178002], [44.4999, 40.19]]
    const decoded = decodePolyline6(encode6(pts))
    decoded.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(pts[i][0], 6)
      expect(p[1]).toBeCloseTo(pts[i][1], 6)
    })
  })

  it('formats distances and durations for the driver', () => {
    expect(formatDistance(43)).toBe('40 m')
    expect(formatDistance(260)).toBe('250 m')
    expect(formatDistance(1520)).toBe('1.5 km')
    expect(formatDistance(23400)).toBe('23 km')
    expect(formatDuration(20)).toBe('1 min')
    expect(formatDuration(3720)).toBe('1 hr 2 min')
  })
})

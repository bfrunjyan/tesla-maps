import { describe, expect, it } from 'vitest'
import { distance, type LngLat } from '../lib/geo'
import { isCongestion, routeTrafficSpans, sliceRoute, tileAt, tilesAlong, tilesForRoute, type TrafficLine } from './routeTraffic'

const LAT0 = 40.18
const LON0 = 44.5
/** A point `north` and `east` metres from the origin. */
const at = (north: number, east = 0): LngLat => [LON0 + east / 85_050, LAT0 + north / 111_320]
const routeOf = (coords: LngLat[]) => {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]))
  return { coords, cum }
}
/** 1 km straight north. */
const north = routeOf([at(0), at(1000)])
const line = (level: TrafficLine['level'], ...coords: LngLat[]): TrafficLine => ({ coords, level })

describe('traffic along the route', () => {
  it('takes the level of the traffic line the route runs along', () => {
    const spans = routeTrafficSpans(north, [line('heavy', at(200), at(600))])
    expect(spans).toHaveLength(1)
    expect(spans[0].level).toBe('heavy')
    expect(spans[0].fromM).toBeCloseTo(200, -1.5)
    expect(spans[0].toM).toBeCloseTo(600, -1.5)
  })

  it('leaves stretches without traffic data unknown', () => {
    expect(routeTrafficSpans(north, [])).toEqual([])
    const spans = routeTrafficSpans(north, [line('low', at(0), at(300)), line('severe', at(700), at(1000))])
    expect(spans.map((s) => s.level)).toEqual(['low', 'severe'])
    expect(spans[0].toM).toBeLessThan(330)
    expect(spans[1].fromM).toBeGreaterThan(670)
  })

  it('ignores the jam on the opposite side of the road', () => {
    // Same road, drawn the other way: traffic heading south.
    const spans = routeTrafficSpans(north, [line('severe', at(1000), at(0))])
    expect(spans).toEqual([])
  })

  it('uses our direction when both directions have data', () => {
    const spans = routeTrafficSpans(north, [line('severe', at(1000), at(0)), line('low', at(0), at(1000))])
    expect(spans.map((s) => s.level)).toEqual(['low'])
  })

  it('ignores a parallel street and a crossing street', () => {
    const parallel = line('heavy', at(0, 40), at(1000, 40))
    const crossing = line('heavy', at(500, -200), at(500, 200))
    expect(routeTrafficSpans(north, [parallel, crossing])).toEqual([])
  })

  it('accepts a line a few metres to the side (map data never lines up exactly)', () => {
    const spans = routeTrafficSpans(north, [line('moderate', at(0, 8), at(1000, 8))])
    expect(spans).toHaveLength(1)
    expect(spans[0].toM - spans[0].fromM).toBeGreaterThan(950)
  })

  it('takes the nearest line when two run close together', () => {
    const spans = routeTrafficSpans(north, [line('heavy', at(0, 11), at(1000, 11)), line('low', at(0, 3), at(1000, 3))])
    expect(spans.map((s) => s.level)).toEqual(['low'])
  })

  it('bridges a short gap at a junction, but not a long one', () => {
    const short = routeTrafficSpans(north, [line('heavy', at(0), at(400)), line('heavy', at(440), at(1000))])
    expect(short).toHaveLength(1)
    const long = routeTrafficSpans(north, [line('heavy', at(0), at(300)), line('heavy', at(500), at(1000))])
    expect(long).toHaveLength(2)
  })

  it('splits where the level changes', () => {
    const spans = routeTrafficSpans(north, [line('low', at(0), at(500)), line('heavy', at(500), at(1000))])
    expect(spans.map((s) => s.level)).toEqual(['low', 'heavy'])
    expect(spans[0].toM).toBeCloseTo(500, -1.5)
    expect(spans[1].fromM).toBeCloseTo(spans[0].toM)
  })

  it('follows the route round a corner', () => {
    const corner = routeOf([at(0), at(500), at(500, 500)])
    // Jam only on the eastbound street after the turn.
    const spans = routeTrafficSpans(corner, [line('severe', at(500, 0), at(500, 500))])
    expect(spans).toHaveLength(1)
    expect(spans[0].fromM).toBeCloseTo(500, -1.5)
    expect(spans[0].toM).toBeCloseTo(1000, -1.5)
  })

  it('recognises the four levels and nothing else', () => {
    expect(['low', 'moderate', 'heavy', 'severe'].every(isCongestion)).toBe(true)
    expect([undefined, 'unknown', 3, ''].some(isCongestion)).toBe(false)
  })
})

describe('cutting a stretch out of the route', () => {
  const corner = routeOf([at(0), at(500), at(500, 500)])
  const length = (c: LngLat[]) => c.slice(1).reduce((sum, p, i) => sum + distance(c[i], p), 0)

  it('returns the line between two distances, corners included', () => {
    const part = sliceRoute(corner, 400, 700)
    expect(part).toHaveLength(3)
    expect(length(part)).toBeCloseTo(300, 0)
    expect(distance(part[1], at(500))).toBeLessThan(1)
  })

  it('handles a stretch inside one straight, the whole route, and nonsense', () => {
    const total = corner.cum[corner.cum.length - 1]
    expect(length(sliceRoute(corner, 100, 250))).toBeCloseTo(150, 0)
    expect(length(sliceRoute(corner, 0, total))).toBeCloseTo(total, 0)
    expect(length(sliceRoute(corner, -50, 5000))).toBeCloseTo(total, 0)
    expect(sliceRoute(corner, 600, 600)).toEqual([])
    expect(sliceRoute(corner, 700, 400)).toEqual([])
  })
})

describe('which map tiles a route needs', () => {
  it('finds the tile of a point', () => {
    // The worked example from the OpenStreetMap wiki: Berlin at zoom 10 is tile 550/335.
    expect(tileAt([13.4, 52.52], 10)).toEqual({ x: 550, y: 335 })
    expect(tileAt([0, 0], 1)).toEqual({ x: 1, y: 1 })
    expect(tileAt([44.5126, 40.1777], 14).x).toBe(10217)
  })

  it('lists each tile once, including ones a long straight only passes through', () => {
    const tiles = tilesAlong([at(0), at(6000)], 15)
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length)
    // 6 km north at zoom 15 (tiles about 0.9 km tall here) crosses 6 to 8 of them.
    expect(tiles.length).toBeGreaterThanOrEqual(6)
    expect(tiles.length).toBeLessThanOrEqual(8)
  })

  it('uses detailed tiles in town and coarser ones for a long drive', () => {
    expect(tilesForRoute([at(0), at(5000)])[0].z).toBe(15)
    const long = tilesForRoute([at(0), at(150_000)])
    expect(long[0].z).toBeLessThan(15)
    expect(long.length).toBeLessThanOrEqual(80)
  })
})

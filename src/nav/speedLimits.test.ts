import { describe, expect, it } from 'vitest'
import type { LngLat } from '../lib/geo'
import { isOver, limitAt, spansFromTrace } from './speedLimits'

// A straight matched line east, a point every ~100 m (1 km).
const line: LngLat[] = Array.from({ length: 11 }, (_, i) => [44.5 + i * 0.001177, 40.18])

describe('speed limits along the route', () => {
  it('places each road’s limit by where it lies, joining equal neighbours', () => {
    const spans = spansFromTrace(
      [
        { speed_limit: 60, begin_shape_index: 0, end_shape_index: 3 },
        { speed_limit: 60, begin_shape_index: 3, end_shape_index: 5 },
        { begin_shape_index: 5, end_shape_index: 7 }, // no limit in the map data
        { speed_limit: 80, begin_shape_index: 7, end_shape_index: 10 },
      ],
      line,
      1000,
    )
    expect(spans.map((s) => s.kmh)).toEqual([60, 80])
    expect(spans[0].fromM).toBe(0)
    expect(spans[0].toM).toBeCloseTo(500, -1)
    expect(spans[1].fromM).toBeCloseTo(700, -1)
    expect(spans[1].toM).toBeCloseTo(1000, 0)
  })

  it('bridges a short gap at a junction between two stretches with the same limit', () => {
    const spans = spansFromTrace(
      [
        { speed_limit: 60, begin_shape_index: 0, end_shape_index: 4 },
        { speed_limit: 60, begin_shape_index: 4, end_shape_index: 9 },
      ],
      // A tiny step between point 4 and 5's start would leave a few metres uncovered.
      line,
      1000,
    )
    expect(spans).toHaveLength(1)
  })

  it('scales to the route’s own length (the matched line can differ a little)', () => {
    const spans = spansFromTrace([{ speed_limit: 40, begin_shape_index: 0, end_shape_index: 10 }], line, 1100)
    expect(spans[0].toM).toBeCloseTo(1100, 0)
  })

  it('skips values that aren’t limits', () => {
    expect(spansFromTrace([{ speed_limit: 'unlimited', begin_shape_index: 0, end_shape_index: 10 }, { speed_limit: 0, begin_shape_index: 0, end_shape_index: 10 }], line, 1000)).toEqual([])
    expect(spansFromTrace([{ speed_limit: 60 }], [line[0]], 1000)).toEqual([])
  })

  it('gives the limit where the car is, none off the route or where unknown', () => {
    const spans = [{ fromM: 0, toM: 500, kmh: 60 }, { fromM: 700, toM: 1000, kmh: 80 }]
    expect(limitAt(spans, { alongM: 120, offRouteM: 3 })).toBe(60)
    expect(limitAt(spans, { alongM: 600, offRouteM: 3 })).toBeNull()
    expect(limitAt(spans, { alongM: 800, offRouteM: 3 })).toBe(80)
    expect(limitAt(spans, { alongM: 800, offRouteM: 60 })).toBeNull()
    expect(limitAt(null, { alongM: 800, offRouteM: 0 })).toBeNull()
  })

  it('counts as over only a few km/h past the limit', () => {
    expect(isOver(62, 60)).toBe(false)
    expect(isOver(64, 60)).toBe(true)
    expect(isOver(120, null)).toBe(false)
  })
})

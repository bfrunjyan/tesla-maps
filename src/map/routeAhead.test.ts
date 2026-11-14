import { describe, expect, it } from 'vitest'
import type { LngLat } from '../lib/geo'
import { needsRedraw, syncPool, trafficAhead, TRIM_STEP_M, type AheadState } from './routeAhead'

// A straight 1 km route east from Republic Square, a point every 100 m.
const coords: LngLat[] = Array.from({ length: 11 }, (_, i) => [44.5126 + i * 0.001177, 40.1777])
const cum = coords.map((_, i) => i * 100)
const route = { coords, cum }

describe('needsRedraw', () => {
  const traffic = {}
  const at = (fromM: number): AheadState => ({ route, traffic, fromM })

  it('draws the first time', () => {
    expect(needsRedraw(null, at(0))).toBe(true)
  })

  it('waits until the car has moved far enough', () => {
    expect(needsRedraw(at(100), at(100 + TRIM_STEP_M - 1))).toBe(false)
    expect(needsRedraw(at(100), at(100 + TRIM_STEP_M))).toBe(true)
  })

  it('redraws at once for another route or new traffic, however little the car moved', () => {
    expect(needsRedraw(at(100), { route: { ...route }, traffic, fromM: 100 })).toBe(true)
    expect(needsRedraw(at(100), { route, traffic: {}, fromM: 100 })).toBe(true)
    expect(needsRedraw(at(100), { route: null, traffic: null, fromM: 0 })).toBe(true)
  })

  it('also redraws when a fix lands well behind the last one', () => {
    expect(needsRedraw(at(300), at(300 - TRIM_STEP_M))).toBe(true)
  })

  it('redraws about once every step on a long drive, not on every fix', () => {
    // 30 minutes at 45 km/h, one fix a second.
    let last: AheadState | null = null
    let redraws = 0
    for (let s = 0; s < 1800; s++) {
      const next = at(s * 12.5)
      if (needsRedraw(last, next)) {
        redraws++
        last = next
      }
    }
    expect(redraws).toBeLessThanOrEqual(Math.ceil((1800 * 12.5) / TRIM_STEP_M) + 1)
    expect(redraws).toBeLessThan(1800)
  })
})

describe('trafficAhead', () => {
  const spans = [
    { fromM: 0, toM: 300, level: 'low' as const },
    { fromM: 300, toM: 600, level: 'heavy' as const },
    { fromM: 600, toM: 1000, level: 'moderate' as const },
  ]

  it('drops what is behind the car and cuts the piece the car is on', () => {
    const pieces = trafficAhead(route, spans, 450)
    expect(pieces.map((p) => p.level)).toEqual(['heavy', 'moderate'])
    expect(pieces[0].coords[0][0]).toBeCloseTo(44.5126 + 4.5 * 0.001177, 6)
  })

  it('gives every piece before the drive starts', () => {
    expect(trafficAhead(route, spans, 0)).toHaveLength(3)
  })

  it('gives nothing past the end', () => {
    expect(trafficAhead(route, spans, 1000)).toEqual([])
  })
})

describe('syncPool', () => {
  type Line = { id: number; value: string; removed?: boolean }
  let made = 0
  const make = (value: string): Line => ({ id: made++, value })
  const update = (l: Line, value: string) => (l.value = value)
  const remove = (l: Line) => (l.removed = true)

  it('reuses the lines it has and makes only the missing ones', () => {
    made = 0
    let pool: Line[] = []
    pool = syncPool(pool, ['a', 'b'], make, update, remove)
    expect(made).toBe(2)
    const [first, second] = pool
    pool = syncPool(pool, ['c', 'd', 'e'], make, update, remove)
    expect(made).toBe(3)
    expect(pool[0]).toBe(first)
    expect(pool[1]).toBe(second)
    expect(pool.map((l) => l.value)).toEqual(['c', 'd', 'e'])
  })

  it('removes the spare lines when there are fewer pieces', () => {
    made = 0
    let pool = syncPool<Line, string>([], ['a', 'b', 'c'], make, update, remove)
    const spare = pool[2]
    pool = syncPool(pool, ['x'], make, update, remove)
    expect(pool.map((l) => l.value)).toEqual(['x'])
    expect(spare.removed).toBe(true)
    expect(syncPool(pool, [], make, update, remove)).toEqual([])
  })

  it('makes no new lines over a long drive with the same number of pieces', () => {
    made = 0
    let pool: Line[] = []
    for (let s = 0; s < 1800; s++) pool = syncPool(pool, ['low', 'heavy', 'low'], make, update, remove)
    expect(made).toBe(3)
  })
})

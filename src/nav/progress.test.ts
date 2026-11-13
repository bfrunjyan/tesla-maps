import { describe, expect, it } from 'vitest'
import { distance, type LngLat } from '../lib/geo'
import type { Maneuver, Route } from '../types'
import { computeProgress } from './progress'

/** A straight 1 km road east along latitude 40.18 (Yerevan), with a turn halfway. */
function straightRoute(): Route {
  const coords: LngLat[] = Array.from({ length: 11 }, (_, i) => [44.5 + i * 0.001174, 40.18])
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]))
  const m = (type: number, shapeIndex: number, timeS: number): Maneuver => ({
    type,
    instruction: `m${shapeIndex}`,
    street: '',
    shapeIndex,
    atM: cum[shapeIndex],
    lengthM: 0,
    timeS,
  })
  const maneuvers = [m(1, 0, 30), m(10, 5, 30), m(4, 10, 0)]
  maneuvers[0].lengthM = cum[5]
  maneuvers[1].lengthM = cum[10] - cum[5]
  return { coords, cum, maneuvers, totalM: cum[10], totalS: 60, lang: 'en-US' }
}

describe('computeProgress', () => {
  const route = straightRoute()
  const at = (frac: number, northOffsetDeg = 0): LngLat => [44.5 + frac * 0.01174, 40.18 + northOffsetDeg]

  it('snaps the car to the road and finds the next turn', () => {
    const p = computeProgress(route, at(0.25))
    expect(p.alongM).toBeCloseTo(route.totalM * 0.25, -1)
    expect(p.nextIndex).toBe(1)
    expect(p.toNextM).toBeCloseTo(route.totalM * 0.25, -1)
    expect(p.remainingM).toBeCloseTo(route.totalM * 0.75, -1)
    expect(p.offRouteM).toBeLessThan(1)
  })

  it('moves on to the destination after passing the turn', () => {
    const p = computeProgress(route, at(0.75), 5)
    expect(p.nextIndex).toBe(2)
    expect(p.remainingS).toBeGreaterThan(0)
    expect(p.remainingS).toBeLessThan(30)
  })

  it('measures distance from the road when the car leaves it', () => {
    const p = computeProgress(route, at(0.5, 0.0006)) // ~67 m north
    expect(p.offRouteM).toBeGreaterThan(55)
    expect(p.offRouteM).toBeLessThan(80)
  })

  it('never jumps backwards to an earlier part of the route', () => {
    const p = computeProgress(route, at(0.1), 8)
    expect(p.segIndex).toBeGreaterThanOrEqual(5)
  })
})

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

/** North 600 m, a U-shaped detour, then back south on a street 60 m to the east. */
function loopRoute(): Route {
  const lat = (m: number) => 40.18 + m / 111_320
  const lon = (m: number) => 44.5 + m / 85_050
  const coords: LngLat[] = [[lon(0), lat(0)], [lon(0), lat(300)], [lon(0), lat(600)], [lon(60), lat(600)], [lon(60), lat(300)], [lon(60), lat(0)]]
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]))
  const maneuvers: Maneuver[] = [
    { type: 1, instruction: 'start', street: '', shapeIndex: 0, atM: 0, lengthM: cum[5], timeS: 120 },
    { type: 4, instruction: 'arrive', street: '', shapeIndex: 5, atM: cum[5], lengthM: 0, timeS: 0 },
  ]
  return { coords, cum, maneuvers, totalM: cum[5], totalS: 120, lang: 'en-US' }
}

describe('a later part of the route passing close by', () => {
  const route = loopRoute()
  // The car was 100 m up the first street, then turned right: now 45 m east, nearer the return leg.
  const turnedOff: LngLat = [44.5 + 45 / 85_050, 40.18 + 110 / 111_320]

  it('captures the car when nothing limits how far ahead it may be matched', () => {
    const p = computeProgress(route, turnedOff, 0)
    expect(p.segIndex).toBe(4)
    expect(p.offRouteM).toBeLessThan(20)
  })

  it('does not capture it when the car could not have driven that far', () => {
    const p = computeProgress(route, turnedOff, 0, 100, 150)
    expect(p.segIndex).toBe(0)
    expect(p.offRouteM).toBeGreaterThan(40)
    expect(p.alongM).toBeCloseTo(110, -1)
  })

  it('still follows the car forward across segments within reach', () => {
    const ahead: LngLat = [44.5, 40.18 + 380 / 111_320]
    const p = computeProgress(route, ahead, 0, 290, 150)
    expect(p.segIndex).toBe(1)
    expect(p.offRouteM).toBeLessThan(2)
  })
})


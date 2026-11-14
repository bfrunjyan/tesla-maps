import { describe, expect, it } from 'vitest'
import type { LngLat } from '../lib/geo'
import type { Maneuver, NavProgress, Route } from '../types'
import { lanesFromValhalla, SHOW_LANES_FROM_M, transferLanes, upcomingLanes } from './lanes'

describe('lanes from the routing server', () => {
  it('reads a real Yerevan junction: left lane for a left turn', () => {
    // Turning left onto Vahram Papazyan street (server answer, Nov 2026).
    const lanes = lanesFromValhalla([{ directions: 8, active: 8 }, { directions: 2 }, { directions: 2 }, { directions: 66 }])
    expect(lanes).toEqual([
      { dirs: ['left'], use: 'left', fit: 'best' },
      { dirs: ['through'], use: null, fit: 'no' },
      { dirs: ['through'], use: null, fit: 'no' },
      { dirs: ['through', 'right'], use: null, fit: 'no' },
    ])
  })

  it('tells best lanes from lanes that also work', () => {
    const lanes = lanesFromValhalla([{ directions: 64, active: 64 }, { directions: 64, valid: 64 }, { directions: 2 }])!
    expect(lanes.map((l) => l.fit)).toEqual(['best', 'ok', 'no'])
  })

  it('picks the right direction in a shared lane', () => {
    const [shared] = lanesFromValhalla([{ directions: 10, active: 8 }, { directions: 64 }])!
    expect(shared).toEqual({ dirs: ['left', 'through'], use: 'left', fit: 'best' })
  })

  it('keeps no guidance that says nothing', () => {
    expect(lanesFromValhalla(undefined)).toBeUndefined()
    expect(lanesFromValhalla([{ directions: 2, active: 2 }])).toBeUndefined() // a single lane
    expect(lanesFromValhalla([{ directions: 2 }, { directions: 64 }])).toBeUndefined() // none to take
  })
})

// A straight road east, a point every 100 m, with turns at 300 m (right) and 700 m (left).
const line: LngLat[] = Array.from({ length: 11 }, (_, i) => [44.5 + i * 0.001177, 40.18])
const turn = (type: number, shapeIndex: number, extra: Partial<Maneuver> = {}): Maneuver => ({
  type,
  instruction: '',
  street: '',
  shapeIndex,
  atM: shapeIndex * 100,
  lengthM: 0,
  timeS: 0,
  ...extra,
})
const route = (maneuvers: Maneuver[], coords = line): Route => ({
  coords,
  cum: coords.map((_, i) => i * 100),
  maneuvers,
  totalM: 1000,
  totalS: 120,
  lang: 'en-US',
  preference: 'fastest',
})
const rightLanes = lanesFromValhalla([{ directions: 2 }, { directions: 64, active: 64 }])!
const leftLanes = lanesFromValhalla([{ directions: 8, active: 8 }, { directions: 2 }])!

describe('copying lanes onto Google’s turns', () => {
  it('copies lanes to the turn at the same junction going the same way', () => {
    const source = route([turn(1, 0), turn(10, 3, { lanes: rightLanes }), turn(15, 7, { lanes: leftLanes }), turn(4, 10)])
    // Google's polyline is a few metres off, and calls the left turn a slight left.
    const nudged: LngLat[] = line.map(([lon, lat]) => [lon + 0.00012, lat])
    const google = route([turn(1, 0), turn(10, 3), turn(16, 7), turn(4, 10)], nudged)
    expect(transferLanes(google, source)).toBe(2)
    expect(google.maneuvers[1].lanes).toBe(rightLanes)
    expect(google.maneuvers[2].lanes).toBe(leftLanes)
  })

  it('does not copy lanes onto a turn the other way, or one at another junction', () => {
    const source = route([turn(10, 3, { lanes: rightLanes })])
    const google = route([turn(15, 3), turn(10, 6)])
    expect(transferLanes(google, source)).toBe(0)
    expect(google.maneuvers.every((m) => !m.lanes)).toBe(true)
  })
})

describe('when the lanes show', () => {
  const r = route([turn(1, 0), turn(10, 3, { lanes: rightLanes }), turn(4, 10)])
  const at = (toNextM: number, offRouteM = 2): NavProgress => ({ nextIndex: 1, toNextM, offRouteM }) as NavProgress

  it('shows them as the car nears the junction', () => {
    expect(upcomingLanes(r, at(SHOW_LANES_FROM_M + 50))).toBeNull()
    expect(upcomingLanes(r, at(250))).toEqual({ lanes: rightLanes, at: line[3], index: 1 })
  })

  it('hides them off the route, and for turns without lanes', () => {
    expect(upcomingLanes(r, at(250, 80))).toBeNull()
    expect(upcomingLanes(r, { nextIndex: 2, toNextM: 100, offRouteM: 0 } as NavProgress)).toBeNull()
    expect(upcomingLanes(null, at(250))).toBeNull()
  })
})

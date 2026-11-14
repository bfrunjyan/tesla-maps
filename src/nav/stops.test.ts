import { describe, expect, it } from 'vitest'
import type { Maneuver, NavProgress, Place, Route } from '../types'
import { moveItem, reachedVia, splitStops, stopLetter, stopsOf, stopsRemaining } from './stops'

const place = (id: string, lon: number): Place => ({ id, name: id.toUpperCase(), address: '', lon, lat: 40.18 })
const a = place('a', 44.5)
const b = place('b', 44.51)
const c = place('c', 44.52)

describe('the stops of a trip', () => {
  it('is just the destination for an ordinary trip', () => {
    expect(stopsOf({ destination: a })).toEqual([a])
    expect(stopsOf(null)).toEqual([])
  })

  it('lists the stops on the way first and the destination last', () => {
    expect(stopsOf({ destination: c, via: [a, b] })).toEqual([a, b, c])
  })

  it('makes the last stop the destination', () => {
    expect(splitStops([a, b, c])).toEqual({ via: [a, b], destination: c })
    expect(splitStops([a])).toEqual({ via: [], destination: a })
  })

  it('letters them A, B, C', () => {
    expect([0, 1, 2].map(stopLetter)).toEqual(['A', 'B', 'C'])
  })
})

describe('reordering', () => {
  it('moves a stop later', () => {
    expect(moveItem([a, b, c], 0, 2)).toEqual([b, c, a])
  })

  it('moves a stop earlier', () => {
    expect(moveItem([a, b, c], 2, 0)).toEqual([c, a, b])
  })

  it('stops at the ends of the list', () => {
    expect(moveItem([a, b, c], 1, 9)).toEqual([a, c, b])
    expect(moveItem([a, b, c], 1, -4)).toEqual([b, a, c])
  })

  it('gives back the same list when nothing moves', () => {
    const list = [a, b, c]
    expect(moveItem(list, 1, 1)).toBe(list)
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 7, 0)).toBe(list)
  })
})

/** 3 km: stop A at 1 km, stop B at 2 km, the destination C at 3 km. 100 s per km. */
const maneuvers: Maneuver[] = [
  { type: 1, instruction: 'Drive', street: '', shapeIndex: 0, atM: 0, lengthM: 1000, timeS: 100 },
  { type: 4, instruction: 'Arrive at A', street: '', shapeIndex: 1, atM: 1000, lengthM: 0, timeS: 0 },
  { type: 1, instruction: 'Drive', street: '', shapeIndex: 1, atM: 1000, lengthM: 1000, timeS: 100 },
  { type: 4, instruction: 'Arrive at B', street: '', shapeIndex: 2, atM: 2000, lengthM: 0, timeS: 0 },
  { type: 1, instruction: 'Drive', street: '', shapeIndex: 2, atM: 2000, lengthM: 1000, timeS: 100 },
  { type: 4, instruction: 'Arrive', street: '', shapeIndex: 3, atM: 3000, lengthM: 0, timeS: 0 },
]
const route: Route = {
  coords: [[44.49, 40.18], [44.5, 40.18], [44.51, 40.18], [44.52, 40.18]],
  cum: [0, 1000, 2000, 3000],
  maneuvers,
  totalM: 3000,
  totalS: 300,
  lang: 'en-US',
  stops: [
    { lon: a.lon, lat: a.lat, atM: 1000, maneuverIndex: 1 },
    { lon: b.lon, lat: b.lat, atM: 2000, maneuverIndex: 3 },
    { lon: c.lon, lat: c.lat, atM: 3000, maneuverIndex: 5 },
  ],
}

describe('reaching a stop on the way', () => {
  it('is not reached while it is still ahead', () => {
    expect(reachedVia(route, a, 900)).toBe(false)
  })

  it('is reached within 30 m of it, and stays reached once passed', () => {
    expect(reachedVia(route, a, 975)).toBe(true)
    expect(reachedVia(route, a, 1400)).toBe(true)
    expect(reachedVia(route, b, 1400)).toBe(false)
  })

  it('never counts the end of the route: arriving there is its own thing', () => {
    expect(reachedVia(route, c, 3000)).toBe(false)
  })

  it('says no for a place the route was not planned through', () => {
    expect(reachedVia(route, place('d', 44.6), 3000)).toBe(false)
    expect(reachedVia({ ...route, stops: undefined }, a, 3000)).toBe(false)
  })
})

describe('distance and time left to each stop', () => {
  it('counts from the start before the drive', () => {
    expect(stopsRemaining(route, null, [a, b, c])).toEqual([{ m: 1000, s: 100 }, { m: 2000, s: 200 }, { m: 3000, s: 300 }])
  })

  it('counts down as the car drives', () => {
    const progress = { alongM: 500, remainingM: 2500, remainingS: 250 } as NavProgress
    expect(stopsRemaining(route, progress, [a, b, c])).toEqual([{ m: 500, s: 50 }, { m: 1500, s: 150 }, { m: 2500, s: 250 }])
  })

  it('leaves out a stop the route on screen does not go through yet', () => {
    const d = place('d', 44.6)
    expect(stopsRemaining(route, null, [a, d])).toEqual([{ m: 1000, s: 100 }, null])
    expect(stopsRemaining(null, null, [a])).toEqual([null])
  })
})

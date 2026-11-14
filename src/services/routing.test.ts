import { describe, expect, it } from 'vitest'
import type { LngLat } from '../lib/geo'
import { tripToRoute, type ValhallaTrip } from './routing'

/** Encodes a line the way the routing server does (polyline, 6 decimals). */
function encode(points: LngLat[]) {
  let out = ''
  let lastLat = 0
  let lastLon = 0
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
      n >>= 5
    }
    out += String.fromCharCode(n + 63)
  }
  for (const [lon, lat] of points) {
    const la = Math.round(lat * 1e6)
    const lo = Math.round(lon * 1e6)
    put(la - lastLat)
    put(lo - lastLon)
    lastLat = la
    lastLon = lo
  }
  return out
}

const p = (east: number): LngLat => [44.5 + east / 1000, 40.18]
const maneuver = (type: number, begin_shape_index: number, instruction: string, time = 0, length = 0) => ({
  type,
  instruction,
  verbal_pre_transition_instruction: `${instruction}.`,
  verbal_transition_alert_instruction: `Soon: ${instruction}.`,
  begin_shape_index,
  length,
  time,
})

const oneLeg: ValhallaTrip = {
  legs: [{ shape: encode([p(0), p(1), p(2)]), maneuvers: [maneuver(1, 0, 'Drive east', 60, 0.17), maneuver(4, 2, 'You have arrived at your destination')] }],
  summary: { time: 60, length: 0.17 },
}

/** To a café (two points away), then on to the office (three more). */
const twoLegs: ValhallaTrip = {
  legs: [
    { shape: encode([p(0), p(1), p(2)]), maneuvers: [maneuver(1, 0, 'Drive east', 60, 0.17), maneuver(4, 2, 'You have arrived at your destination')] },
    {
      shape: encode([p(2), p(3), p(4), p(5)]),
      maneuvers: [maneuver(1, 0, 'Drive east', 30, 0.085), maneuver(10, 1, 'Turn right', 60, 0.17), maneuver(4, 3, 'You have arrived at your destination')],
    },
  ],
  summary: { time: 150, length: 0.425 },
}
const cafe = { lon: 44.5021, lat: 40.1801, name: 'Café' }
const office = { lon: 44.5051, lat: 40.1801, name: 'Office' }

describe('a route to one place', () => {
  const route = tripToRoute(oneLeg, 'en-US', 'fastest', [office])

  it('keeps the line and the maneuvers as the server gave them', () => {
    expect(route.coords).toHaveLength(3)
    expect(route.maneuvers.map((m) => m.instruction)).toEqual(['Drive east', 'You have arrived at your destination'])
    expect(route.maneuvers[1].atM).toBeCloseTo(route.totalM)
  })

  it('notes the destination at the end of it', () => {
    expect(route.stops).toEqual([{ lon: office.lon, lat: office.lat, atM: route.totalM, maneuverIndex: 1 }])
  })
})

describe('a route through a stop', () => {
  const route = tripToRoute(twoLegs, 'en-US', 'fastest', [cafe, office])

  it('joins the legs into one line, without repeating the point they share', () => {
    expect(route.coords).toHaveLength(6)
    expect(route.cum).toHaveLength(6)
    expect(route.cum.every((c, i) => i === 0 || c > route.cum[i - 1])).toBe(true)
    expect(route.totalS).toBe(150)
  })

  it('places the second leg’s maneuvers after the first leg', () => {
    expect(route.maneuvers.map((m) => m.shapeIndex)).toEqual([0, 2, 2, 3, 5])
    const turn = route.maneuvers[3]
    expect(turn.instruction).toBe('Turn right')
    expect(turn.atM).toBeCloseTo(route.cum[3])
    expect(route.maneuvers[4].atM).toBeCloseTo(route.totalM)
  })

  it('names the stop where the server only says "your destination"', () => {
    const atCafe = route.maneuvers[1]
    expect(atCafe.instruction).toBe('Arrive at Café')
    expect(atCafe.verbalPre).toBe('You have arrived at Café.')
    expect(atCafe.verbalAlert).toBe('Your stop, Café, is ahead.')
    // The end of the trip keeps the server's own words.
    expect(route.maneuvers[4].instruction).toBe('You have arrived at your destination')
  })

  it('says it in Russian when the voice is Russian', () => {
    const ru = tripToRoute(twoLegs, 'ru-RU', 'fastest', [cafe, office])
    expect(ru.maneuvers[1].instruction).toBe('Остановка: Café')
  })

  it('notes where each stop is along the route', () => {
    expect(route.stops).toEqual([
      { lon: cafe.lon, lat: cafe.lat, atM: route.cum[2], maneuverIndex: 1 },
      { lon: office.lon, lat: office.lat, atM: route.totalM, maneuverIndex: 4 },
    ])
  })
})

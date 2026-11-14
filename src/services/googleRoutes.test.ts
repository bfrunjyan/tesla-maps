import { describe, expect, it } from 'vitest'
import type { LngLat } from '../lib/geo'
import { googleRouteToRoute, maneuverType, trafficSpans, type GoogleRoute } from './googleRoutes'

/** Encodes a line the way Google does (polyline, 5 decimals). */
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
    const la = Math.round(lat * 1e5)
    const lo = Math.round(lon * 1e5)
    put(la - lastLat)
    put(lo - lastLon)
    lastLat = la
    lastLon = lo
  }
  return out
}

/** A point `east` km from the start, on one street. */
const p = (east: number): LngLat => [44.5 + east / 85.05, 40.18]
const step = (from: number, to: number, maneuver: string, instructions: string, staticS: number) => ({
  distanceMeters: Math.round((to - from) * 1000),
  staticDuration: `${staticS}s`,
  polyline: { encodedPolyline: encode([p(from), p((from + to) / 2), p(to)]) },
  navigationInstruction: { maneuver, instructions },
})

/** 1 km east, a right turn, 1 km on; 240 s with traffic (180 s without). */
const oneLeg: GoogleRoute = {
  duration: '240s',
  distanceMeters: 2000,
  polyline: { encodedPolyline: encode([p(0), p(0.5), p(1), p(1.5), p(2)]) },
  travelAdvisory: {
    speedReadingIntervals: [
      { endPolylinePointIndex: 2, speed: 'NORMAL' },
      { startPolylinePointIndex: 2, endPolylinePointIndex: 3, speed: 'TRAFFIC_JAM' },
      { startPolylinePointIndex: 3, endPolylinePointIndex: 4, speed: 'SLOW' },
    ],
  },
  legs: [{ steps: [step(0, 1, 'DEPART', 'Head east on Abovyan St', 90), step(1, 2, 'TURN_RIGHT', 'Turn right onto Tumanyan St\nDestination will be on the left', 90)] }],
}
const office = { lon: p(2)[0], lat: p(2)[1], name: 'Office' }

describe('a Google route as a Mapic route', () => {
  const route = googleRouteToRoute(oneLeg, 'en-US', [office])

  it('builds the line from the steps, without repeating the point they share', () => {
    expect(route.coords).toHaveLength(5)
    expect(route.totalM).toBeCloseTo(2000, -1)
    expect(route.source).toBe('google')
  })

  it('puts each turn where its step starts, and ends with the arrival', () => {
    expect(route.maneuvers.map((m) => [m.type, m.shapeIndex])).toEqual([[1, 0], [10, 2], [4, 4]])
    expect(route.maneuvers[1].atM).toBeCloseTo(1000, -1)
    expect(route.maneuvers[2].atM).toBeCloseTo(route.totalM)
  })

  it('speaks Google’s instruction, as one sentence', () => {
    expect(route.maneuvers[1].instruction).toBe('Turn right onto Tumanyan St. Destination will be on the left')
    expect(route.maneuvers[1].verbalPre).toBe(route.maneuvers[1].instruction)
    expect(route.maneuvers[2].verbalPre).toBe('You have arrived at your destination.')
  })

  it('uses the time with traffic, spread over the steps', () => {
    expect(route.totalS).toBe(240)
    expect(route.maneuvers.reduce((s, m) => s + m.timeS, 0)).toBeCloseTo(240)
    expect(route.maneuvers[0].timeS).toBeCloseTo(120)
  })

  it('carries the traffic along the route', () => {
    expect(route.traffic!.map((t) => t.level)).toEqual(['low', 'heavy', 'moderate'])
    expect(route.traffic![1].fromM).toBeCloseTo(1000, -1)
    expect(route.traffic![1].toM).toBeCloseTo(1500, -1)
    expect(route.traffic![2].toM).toBeCloseTo(route.totalM)
  })

  it('notes the destination for the trip', () => {
    expect(route.stops).toEqual([{ lon: office.lon, lat: office.lat, atM: route.totalM, maneuverIndex: 2 }])
  })
})

describe('a Google route through a stop', () => {
  const twoLegs: GoogleRoute = {
    duration: '200s',
    polyline: { encodedPolyline: encode([p(0), p(1), p(2)]) },
    legs: [{ steps: [step(0, 1, 'DEPART', 'Head east', 100)] }, { steps: [step(1, 2, 'DEPART', 'Continue east', 100)] }],
  }
  const cafe = { lon: p(1)[0], lat: p(1)[1], name: 'Café' }
  const route = googleRouteToRoute(twoLegs, 'en-US', [cafe, office])

  it('arrives at the stop, named, then carries on', () => {
    expect(route.maneuvers.map((m) => m.instruction)).toEqual(['Head east', 'Arrive at Café', 'Continue east', 'You have arrived'])
    expect(route.maneuvers[1].verbalPre).toBe('You have arrived at Café.')
  })

  it('notes where each stop is', () => {
    expect(route.stops!.map((s) => [Math.round(s.atM / 10) * 10, s.maneuverIndex])).toEqual([[1000, 1], [2000, 3]])
  })

  it('has no traffic levels when Google sent none', () => {
    expect(route.traffic).toEqual([])
  })

  it('speaks Russian when the voice is Russian', () => {
    expect(googleRouteToRoute(twoLegs, 'ru-RU', [cafe, office]).maneuvers[1].instruction).toBe('Остановка: Café')
  })
})

describe('traffic levels', () => {
  it('joins neighbouring stretches of one level', () => {
    const g: GoogleRoute = {
      polyline: { encodedPolyline: encode([p(0), p(1), p(2)]) },
      travelAdvisory: { speedReadingIntervals: [{ endPolylinePointIndex: 1, speed: 'NORMAL' }, { startPolylinePointIndex: 1, endPolylinePointIndex: 2, speed: 'NORMAL' }] },
    }
    expect(trafficSpans(g, 2000)).toHaveLength(1)
  })

  it('leaves out stretches with no level', () => {
    const g: GoogleRoute = { polyline: { encodedPolyline: encode([p(0), p(1)]) }, travelAdvisory: { speedReadingIntervals: [{ endPolylinePointIndex: 1, speed: 'SPEED_UNSPECIFIED' }] } }
    expect(trafficSpans(g, 1000)).toEqual([])
  })
})

describe('maneuvers', () => {
  it('maps Google’s turns to the icons Mapic already has', () => {
    expect(['TURN_LEFT', 'TURN_SLIGHT_RIGHT', 'UTURN_LEFT', 'ROUNDABOUT_RIGHT', 'FORK_LEFT', 'STRAIGHT', undefined].map(maneuverType)).toEqual([15, 9, 13, 26, 24, 8, 8])
  })
})

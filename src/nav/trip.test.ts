import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { distance, type LngLat } from '../lib/geo'
import type { Maneuver, Place, Route } from '../types'
import type { RouteOption } from './routeOptions'

// A trip with several stops, end to end: real controller, real route matching. Only
// the routing server, the place lookup and the voice are stand-ins.
vi.mock('../services/routing', () => ({ fetchRoute: vi.fn(), fetchRouteOptions: vi.fn() }))
vi.mock('../services/search', () => ({ reverseGeocode: vi.fn(async () => null) }))
vi.mock('../lib/voice', () => ({ speak: vi.fn(), cancelSpeech: vi.fn(), setVoiceEnabled: vi.fn() }))

vi.stubGlobal('window', globalThis)

const { fetchRoute, fetchRouteOptions } = await import('../services/routing')
const { useStore } = await import('../state/store')
const { addStop, endNavigation, goWithRoute, moveStop, onPosition, removeStop, retryRoute, startNavigation } = await import('./controller')
const { MAX_STOPS, stopsOf } = await import('./stops')
const routeMock = vi.mocked(fetchRoute)
const optionsMock = vi.mocked(fetchRouteOptions)

const LAT0 = 40.18
const LON0 = 44.5
/** A point `north` and `east` metres from the start. */
const at = (north: number, east = 0): LngLat => [LON0 + east / 85_050, LAT0 + north / 111_320]
const place = (name: string, north: number, east = 0): Place => ({ id: name.toLowerCase(), name, address: '', lon: at(north, east)[0], lat: at(north, east)[1] })

/** A route along `points`, planned through the places given (each must be one of the points). */
function routeThrough(points: LngLat[], places: Place[]): Route {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + distance(points[i - 1], points[i]))
  const total = cum[cum.length - 1]
  const maneuvers: Maneuver[] = [{ type: 1, instruction: 'Drive', verbalPre: 'Drive', street: '', shapeIndex: 0, atM: 0, lengthM: total, timeS: total / 11 }]
  const stops = places.map((p) => {
    const shapeIndex = points.findIndex((c) => c[0] === p.lon && c[1] === p.lat)
    maneuvers.push({ type: 4, instruction: `Arrive at ${p.name}`, street: '', shapeIndex, atM: cum[shapeIndex], lengthM: 0, timeS: 0 })
    return { lon: p.lon, lat: p.lat, atM: cum[shapeIndex], maneuverIndex: maneuvers.length - 1 }
  })
  return { coords: points, cum, maneuvers, totalM: total, totalS: total / 11, lang: 'en-US', preference: 'fastest', stops }
}

const cafe = place('Café', 1000)
const office = place('Office', 2000)
const gym = place('Gym', 2000, 600)
/** North to the café, on north to the office. */
const cafeThenOffice = routeThrough([at(0), at(1000), at(2000)], [cafe, office])

/** Whatever is asked for, the server answers with a straight line through the stops. */
const straight = (from: { lon: number; lat: number }, to: { lon: number; lat: number }[]) =>
  routeThrough([[from.lon, from.lat], ...to.map((t): LngLat => [t.lon, t.lat])], to as Place[])

const SPEED = 11 // m/s, 40 km/h
let north = 0

async function driveNorth(seconds: number) {
  for (let i = 0; i < seconds; i++) {
    await vi.advanceTimersByTimeAsync(1000)
    north += SPEED
    const [lon, lat] = at(north)
    onPosition({ lon, lat, heading: 0, speed: SPEED, accuracy: 8, ts: Date.now() }, 'gps')
  }
}
const nav = () => useStore.getState().nav!
const names = () => stopsOf(nav()).map((p) => p.name)
const toast = () => useStore.getState().toast?.text

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-14T10:00:00Z') })
  routeMock.mockReset()
  optionsMock.mockReset()
  optionsMock.mockImplementation(async (from, to): Promise<RouteOption[]> => [{ route: straight(from, to), tags: ['Fastest'] }])
  north = 0
  const [lon, lat] = at(0)
  useStore.setState({ position: { lon, lat, heading: 0, speed: 0, accuracy: 8, ts: Date.now() }, nav: null, toast: null, recents: [], panelOpen: false, searchMode: 'navigate' })
})
afterEach(() => {
  endNavigation()
  vi.useRealTimers()
})

describe('planning a trip with several stops', () => {
  it('adds a place after the ones already in the trip, and routes through them in order', async () => {
    await startNavigation(cafe)
    expect(names()).toEqual(['Café'])
    addStop(office)
    await vi.advanceTimersByTimeAsync(0)
    expect(names()).toEqual(['Café', 'Office'])
    expect(nav().destination).toBe(office)
    expect(optionsMock.mock.calls.at(-1)![1]).toEqual([cafe, office])
    expect(nav().status).toBe('choosing')
    expect(nav().options![0].route.stops).toHaveLength(2)
  })

  it('stops starting by itself once the driver has changed the trip', async () => {
    await startNavigation(cafe)
    expect(nav().edited).toBeFalsy()
    addStop(office)
    await vi.advanceTimersByTimeAsync(0)
    expect(nav().edited).toBe(true)
  })

  it('closes the search it was picked from and remembers the place', async () => {
    await startNavigation(cafe)
    useStore.getState().openPanel('add-stop')
    addStop(office)
    expect(useStore.getState().panelOpen).toBe(false)
    expect(useStore.getState().searchMode).toBe('navigate')
    expect(useStore.getState().recents[0]).toBe(office)
  })

  it('reorders, and plans the route again in the new order', async () => {
    await startNavigation(cafe)
    addStop(office)
    addStop(gym)
    await vi.advanceTimersByTimeAsync(0)
    moveStop(2, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(names()).toEqual(['Gym', 'Café', 'Office'])
    expect(optionsMock.mock.calls.at(-1)![1]).toEqual([gym, cafe, office])
    expect(nav().status).toBe('choosing')
  })

  it('removes a stop; removing the only one ends the trip', async () => {
    await startNavigation(cafe)
    addStop(office)
    await vi.advanceTimersByTimeAsync(0)
    removeStop(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(names()).toEqual(['Office'])
    expect(optionsMock.mock.calls.at(-1)![1]).toEqual([office])
    removeStop(0)
    expect(useStore.getState().nav).toBeNull()
  })

  it('does not add the same place twice', async () => {
    await startNavigation(cafe)
    const calls = optionsMock.mock.calls.length
    addStop({ ...cafe, id: 'other-id' })
    expect(names()).toEqual(['Café'])
    expect(toast()).toBe('That place is already in the trip')
    expect(optionsMock).toHaveBeenCalledTimes(calls)
  })

  it(`holds up to ${MAX_STOPS} stops`, async () => {
    await startNavigation(place('Stop 1', 100))
    for (let i = 2; i <= MAX_STOPS + 1; i++) addStop(place(`Stop ${i}`, i * 100))
    await vi.advanceTimersByTimeAsync(0)
    expect(names()).toHaveLength(MAX_STOPS)
    expect(toast()).toBe(`A trip can have up to ${MAX_STOPS} stops`)
  })

  it('keeps the stops when no route is found, so one can be taken out or it can be tried again', async () => {
    await startNavigation(cafe)
    optionsMock.mockRejectedValueOnce(new Error('No route: no path could be found'))
    addStop(gym)
    await vi.advanceTimersByTimeAsync(0)
    expect(nav().status).toBe('error')
    expect(names()).toEqual(['Café', 'Gym'])
    retryRoute()
    await vi.advanceTimersByTimeAsync(0)
    expect(nav().status).toBe('choosing')
    expect(optionsMock.mock.calls.at(-1)![1]).toEqual([cafe, gym])
  })

  it('shows only the newest plan when the trip is changed quickly', async () => {
    await startNavigation(cafe)
    let finishFirst!: (o: RouteOption[]) => void
    optionsMock.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
    addStop(office) // slow
    addStop(gym) // answers at once
    await vi.advanceTimersByTimeAsync(0)
    finishFirst([{ route: cafeThenOffice, tags: ['Fastest'] }])
    await vi.advanceTimersByTimeAsync(0)
    expect(names()).toEqual(['Café', 'Office', 'Gym'])
    expect(nav().options![0].route.stops).toHaveLength(3)
  })
})

describe('driving a trip with a stop on the way', () => {
  beforeEach(() => {
    useStore.setState({ nav: { destination: office, via: [cafe], route: null, progress: null, status: 'choosing', options: [{ route: cafeThenOffice, tags: ['Fastest'] }], selected: 0 } })
    goWithRoute()
  })

  it('keeps the stops when guidance starts', () => {
    expect(nav().status).toBe('active')
    expect(names()).toEqual(['Café', 'Office'])
  })

  it('ticks the stop off when the car gets there, and carries on to the destination', async () => {
    await driveNorth(80) // 880 m: the café is still ahead
    expect(names()).toEqual(['Café', 'Office'])
    await driveNorth(12) // just past it
    expect(names()).toEqual(['Office'])
    expect(nav().status).toBe('active')
    expect(nav().route).toBe(cafeThenOffice)
    expect(routeMock).not.toHaveBeenCalled()
  })

  it('arrives only at the last stop', async () => {
    await driveNorth(100)
    expect(nav().status).toBe('active')
    await driveNorth(80)
    expect(nav().status).toBe('arrived')
  })

  it('adds a stop during the drive: a new route from the car through what is left', async () => {
    routeMock.mockImplementation(async (from, to) => straight(from, to))
    await driveNorth(30)
    addStop(gym)
    expect(nav().status).toBe('rerouting')
    expect(nav().route).toBe(cafeThenOffice) // guidance carries on meanwhile
    await vi.advanceTimersByTimeAsync(0)
    const [from, to, , , preference] = routeMock.mock.calls[0]
    expect(distance([from.lon, from.lat], at(north))).toBeLessThan(1)
    expect(to).toEqual([cafe, office, gym])
    expect(preference).toBe('fastest')
    expect(nav().status).toBe('active')
    expect(nav().route!.stops).toHaveLength(3)
    expect(names()).toEqual(['Café', 'Office', 'Gym'])
  })

  it('leaves out a stop already made when it plans again', async () => {
    routeMock.mockImplementation(async (from, to) => straight(from, to))
    await driveNorth(95) // past the café
    addStop(gym)
    await vi.advanceTimersByTimeAsync(0)
    expect(routeMock.mock.calls[0][1]).toEqual([office, gym])
  })

  it('skips a stop the driver takes out', async () => {
    routeMock.mockImplementation(async (from, to) => straight(from, to))
    await driveNorth(30)
    removeStop(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(routeMock.mock.calls[0][1]).toEqual([office])
    expect(names()).toEqual(['Office'])
    await driveNorth(70) // past where the café was: nothing happens there now
    expect(nav().status).toBe('active')
  })

  it('goes back to the trip as it was when a change cannot be planned', async () => {
    routeMock.mockRejectedValue(new Error('Routing failed (503)'))
    await driveNorth(30)
    addStop(gym)
    await vi.advanceTimersByTimeAsync(0)
    expect(names()).toEqual(['Café', 'Office'])
    expect(nav().status).toBe('active')
    expect(nav().route).toBe(cafeThenOffice)
    expect(toast()).toBe('Couldn’t change the trip. Check the connection.')
  })

  it('does not call the old route’s end the destination while a longer trip is being planned', async () => {
    await driveNorth(170) // 1870 m: the café is done, the office is close
    routeMock.mockImplementation(() => new Promise(() => {})) // never answers in time
    addStop(gym)
    await driveNorth(11) // at the office, which is now a stop on the way
    expect(nav().status).toBe('rerouting')
    expect(names()).toEqual(['Office', 'Gym'])
  })
})

describe('a stop the route goes out to and back from along the same street', () => {
  const home = place('Home', 0)
  /** North to the café, then back south the same way to where the trip began. */
  const outAndBack = routeThrough([at(0), at(500), at(1000), at(500), at(0)], [cafe, home])
  // routeThrough finds the first point at a place: home is the last point here, not the first.
  outAndBack.stops![1] = { lon: home.lon, lat: home.lat, atM: outAndBack.totalM, maneuverIndex: 2 }
  outAndBack.maneuvers[2] = { ...outAndBack.maneuvers[2], shapeIndex: 4, atM: outAndBack.totalM }

  it('follows the car back without asking for a new route', async () => {
    useStore.setState({ nav: { destination: home, via: [cafe], route: null, progress: null, status: 'choosing', options: [{ route: outAndBack, tags: ['Fastest'] }], selected: 0 } })
    goWithRoute()
    await driveNorth(90) // to the café
    expect(names()).toEqual(['Home'])
    // Turn round and drive back south.
    for (let i = 0; i < 60; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      north -= SPEED
      const [lon, lat] = at(north)
      onPosition({ lon, lat, heading: 180, speed: SPEED, accuracy: 8, ts: Date.now() }, 'gps')
    }
    expect(routeMock).not.toHaveBeenCalled()
    expect(nav().status).toBe('active')
    expect(nav().progress!.alongM).toBeGreaterThan(outAndBack.totalM / 2 + 600)
    expect(nav().progress!.remainingM).toBeCloseTo(north, -1)
  })
})

describe('leaving the route on a trip with stops', () => {
  it('plans the new route through every stop still to make', async () => {
    useStore.setState({ nav: { destination: office, via: [cafe], route: null, progress: null, status: 'choosing', options: [{ route: cafeThenOffice, tags: ['Fastest'] }], selected: 0 } })
    goWithRoute()
    routeMock.mockImplementation(async (from, to) => straight(from, to))
    await driveNorth(27)
    // Turn west off the route.
    for (let i = 1; i <= 5; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      const [lon, lat] = at(north, -SPEED * i)
      onPosition({ lon, lat, heading: 270, speed: SPEED, accuracy: 8, ts: Date.now() }, 'gps')
    }
    expect(routeMock).toHaveBeenCalledTimes(1)
    expect(routeMock.mock.calls[0][1]).toEqual([cafe, office])
    expect(names()).toEqual(['Café', 'Office'])
  })
})

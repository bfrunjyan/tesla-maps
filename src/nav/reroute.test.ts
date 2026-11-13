import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { distance, type LngLat } from '../lib/geo'
import type { Maneuver, Position, Route } from '../types'

// The whole drive runs here: real controller, real route matching, real off-route
// detection. Only the routing server, the place lookup and the voice are stand-ins.
vi.mock('../services/routing', () => ({ fetchRoute: vi.fn(), fetchRouteOptions: vi.fn() }))
vi.mock('../services/search', () => ({ reverseGeocode: vi.fn(async () => null) }))
vi.mock('../lib/voice', () => ({ speak: vi.fn(), cancelSpeech: vi.fn(), setVoiceEnabled: vi.fn() }))

vi.stubGlobal('window', globalThis)

const { fetchRoute } = await import('../services/routing')
const { useStore } = await import('../state/store')
const { goWithRoute, onPosition, endNavigation } = await import('./controller')
const fetchRouteMock = vi.mocked(fetchRoute)

const LAT0 = 40.18
const LON0 = 44.5
/** A point `north` and `east` metres from the start. */
const at = (north: number, east = 0): LngLat => [LON0 + east / 85_050, LAT0 + north / 111_320]

function routeThrough(points: LngLat[]): Route {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + distance(points[i - 1], points[i]))
  const total = cum[cum.length - 1]
  const maneuvers: Maneuver[] = [
    { type: 1, instruction: 'Drive', verbalPre: 'Drive', street: '', shapeIndex: 0, atM: 0, lengthM: total, timeS: total / 11 },
    { type: 4, instruction: 'Arrive', street: '', shapeIndex: points.length - 1, atM: total, lengthM: 0, timeS: 0 },
  ]
  return { coords: points, cum, maneuvers, totalM: total, totalS: total / 11, lang: 'en-US', preference: 'fastest' }
}

/** 2 km straight north. */
const original = routeThrough([at(0), at(1000), at(2000)])
const destination = { id: 'dest', name: 'Destination', address: '', lon: at(2000)[0], lat: at(2000)[1] }
/** What the routing server answers after the driver turns west at 300 m: carry on west, then north. */
const replacement = routeThrough([at(300, 0), at(300, -400), at(2000, -400), at(2000)])

const SPEED = 11 // m/s, 40 km/h
let north = 0
let east = 0

/** One GPS fix a second later, after moving `dn` metres north and `de` east. */
async function drive(dn: number, de: number, heading: number, extra: Partial<Position> = {}) {
  await vi.advanceTimersByTimeAsync(1000)
  north += dn
  east += de
  const [lon, lat] = at(north, east)
  onPosition({ lon, lat, heading, speed: SPEED, accuracy: 8, ts: Date.now(), ...extra }, 'gps')
}
const driveNorth = (n = 1) => repeat(n, () => drive(SPEED, 0, 0))
const driveWest = (n = 1) => repeat(n, () => drive(0, -SPEED, 270))
async function repeat(n: number, step: () => Promise<void>) {
  for (let i = 0; i < n; i++) await step()
}
const nav = () => useStore.getState().nav!

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-11-14T10:00:00Z') })
  fetchRouteMock.mockReset()
  north = 0
  east = 0
  const [lon, lat] = at(0)
  useStore.setState({
    position: { lon, lat, heading: 0, speed: 0, accuracy: 8, ts: Date.now() },
    nav: { destination, route: null, progress: null, status: 'choosing', options: [{ route: original, tags: ['Fastest'] }], selected: 0 },
    toast: null,
  })
  goWithRoute()
  await driveNorth(27) // 300 m up the road
})
afterEach(() => {
  endNavigation()
  vi.useRealTimers()
})

describe('staying on the route', () => {
  it('never asks for a new route', async () => {
    await driveNorth(40)
    // GPS wandering 12 m to the side.
    await repeat(10, () => drive(SPEED, 0, 3, { lon: at(north + SPEED, 12)[0] }))
    expect(fetchRouteMock).not.toHaveBeenCalled()
    expect(nav().route).toBe(original)
    expect(nav().status).toBe('active')
  })
})

describe('turning onto another street', () => {
  it('plans a new route to the same destination within a few seconds', async () => {
    fetchRouteMock.mockResolvedValue(replacement)
    await driveWest(4)
    expect(fetchRouteMock).toHaveBeenCalledTimes(1)
    const [from, to, , , preference] = fetchRouteMock.mock.calls[0]
    expect(to).toBe(destination)
    expect(preference).toBe('fastest')
    // From where the car is, in the direction it is really driving (west), not the old route's.
    expect(from.heading).toBeCloseTo(270, 0)
    expect(distance([from.lon, from.lat], at(north, east))).toBeLessThan(SPEED * 2)
    expect(nav().route).toBe(replacement)
    expect(nav().status).toBe('active')
  })

  it('shows that it is working, and keeps guiding on the old route meanwhile', async () => {
    let finish!: (r: Route) => void
    fetchRouteMock.mockReturnValue(new Promise<Route>((resolve) => (finish = resolve)))
    await driveWest(4)
    expect(nav().status).toBe('rerouting')
    expect(nav().route).toBe(original)
    await driveWest(2)
    expect(fetchRouteMock).toHaveBeenCalledTimes(1)
    finish(replacement)
    await vi.advanceTimersByTimeAsync(0)
    expect(nav().route).toBe(replacement)
  })

  it('does not ask again and again once the new route fits', async () => {
    fetchRouteMock.mockResolvedValue(replacement)
    await driveWest(30) // on along the new route's first street
    expect(fetchRouteMock).toHaveBeenCalledTimes(1)
    expect(nav().progress!.offRouteM).toBeLessThan(5)
  })
})

describe('a slow or failing connection', () => {
  /** A request that never answers until it is cancelled. */
  const hang = (_f: unknown, _t: unknown, _l: unknown, signal?: AbortSignal) =>
    new Promise<Route>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))))

  it('gives up on a request that hangs, says so, and tries again', async () => {
    fetchRouteMock.mockImplementationOnce(hang).mockResolvedValue(replacement)
    await driveWest(4)
    expect(nav().status).toBe('rerouting')
    await driveWest(13) // more than 12 s later
    expect(useStore.getState().toast?.text).toBe('Couldn’t update the route. Trying again.')
    await driveWest(4)
    expect(fetchRouteMock).toHaveBeenCalledTimes(2)
    expect(nav().route).toBe(replacement)
    expect(nav().status).toBe('active')
  })

  it('tries again after an error', async () => {
    fetchRouteMock.mockRejectedValueOnce(new Error('Routing failed (503)')).mockResolvedValue(replacement)
    await driveWest(4)
    expect(nav().status).toBe('active')
    expect(nav().route).toBe(original)
    await driveWest(10)
    expect(fetchRouteMock).toHaveBeenCalledTimes(2)
    expect(nav().route).toBe(replacement)
  })
})

describe('driving the route backwards', () => {
  it('plans a new route in the direction the car is going', async () => {
    fetchRouteMock.mockResolvedValue(replacement)
    await repeat(6, () => drive(-SPEED, 0, 180))
    expect(fetchRouteMock).toHaveBeenCalledTimes(1)
    expect(fetchRouteMock.mock.calls[0][0].heading).toBeCloseTo(180, 0)
  })
})

describe('ending the trip while a new route is being planned', () => {
  it('does not bring the trip back', async () => {
    let finish!: (r: Route) => void
    fetchRouteMock.mockReturnValue(new Promise<Route>((resolve) => (finish = resolve)))
    await driveWest(4)
    endNavigation()
    finish(replacement)
    await vi.advanceTimersByTimeAsync(0)
    expect(useStore.getState().nav).toBeNull()
  })
})

/**
 * Turn-by-turn routing. Prototype provider: the public Valhalla server
 * (FOSSGIS). Returns maneuvers with spoken instructions. No live traffic.
 */
import { decodePolyline6, distance, type LngLat } from '../lib/geo'
import { climbStats, estimateKWh } from '../nav/energy'
import { lanesFromValhalla, transferLanes, type ValhallaLane } from '../nav/lanes'
import { buildOptions, type RouteOption } from '../nav/routeOptions'
import type { Maneuver, Route, RouteStop } from '../types'
import { usingGoogle } from './googleMaps'
import { googleRoutes } from './googleRoutes'

const VALHALLA = 'https://valhalla1.openstreetmap.de/route'

interface ValhallaManeuver {
  type: number
  instruction: string
  verbal_transition_alert_instruction?: string
  verbal_pre_transition_instruction?: string
  verbal_post_transition_instruction?: string
  street_names?: string[]
  begin_street_names?: string[]
  begin_shape_index: number
  length: number
  time: number
  lanes?: ValhallaLane[]
}

export type RoutePreference = 'fastest' | 'shortest'

export interface ValhallaTrip {
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[]
  summary: { time: number; length: number }
}

/** A place to route to. The name is used to say which stop is coming up. */
export type RouteTarget = { lon: number; lat: number; name?: string }

/** What the card and the voice say at a stop on the way (the server only knows "your destination"). */
function stopWording(name: string, lang: string) {
  return lang.startsWith('ru')
    ? { instruction: `Остановка: ${name}`, alert: `Впереди остановка: ${name}.`, pre: `Вы прибыли: ${name}.` }
    : { instruction: `Arrive at ${name}`, alert: `Your stop, ${name}, is ahead.`, pre: `You have arrived at ${name}.` }
}

/**
 * One route out of the server's answer. A trip through several stops comes back as
 * one leg per stop; they are joined into a single line and a single list of maneuvers,
 * with each stop's place on it noted in `stops`.
 */
export function tripToRoute(trip: ValhallaTrip, lang: string, preference: RoutePreference, targets: RouteTarget[] = []): Route {
  const coords: LngLat[] = []
  const cum: number[] = []
  const maneuvers: Maneuver[] = []
  const stops: RouteStop[] = []
  trip.legs.forEach((leg, legIndex) => {
    const shape = decodePolyline6(leg.shape)
    // A leg starts on the point the one before it ended on: keep that point once.
    const offset = coords.length ? coords.length - 1 : 0
    for (const c of coords.length ? shape.slice(1) : shape) {
      cum.push(coords.length ? cum[cum.length - 1] + distance(coords[coords.length - 1], c) : 0)
      coords.push(c)
    }
    const lastLeg = legIndex === trip.legs.length - 1
    const target = targets[legIndex]
    leg.maneuvers.forEach((m, i) => {
      const shapeIndex = Math.min(offset + m.begin_shape_index, coords.length - 1)
      const arrival = i === leg.maneuvers.length - 1
      const wording = arrival && !lastLeg && target?.name ? stopWording(target.name, lang) : null
      const lanes = lanesFromValhalla(m.lanes)
      maneuvers.push({
        ...(lanes ? { lanes } : {}),
        type: m.type,
        instruction: wording?.instruction ?? m.instruction,
        verbalAlert: wording?.alert ?? m.verbal_transition_alert_instruction,
        verbalPre: wording?.pre ?? m.verbal_pre_transition_instruction,
        verbalPost: m.verbal_post_transition_instruction,
        street: (m.street_names ?? m.begin_street_names ?? [])[0] ?? '',
        shapeIndex,
        atM: cum[shapeIndex],
        lengthM: m.length * 1000,
        timeS: m.time,
      })
    })
    if (target) stops.push({ lon: target.lon, lat: target.lat, atM: cum[cum.length - 1], maneuverIndex: maneuvers.length - 1 })
  })
  return { coords, cum, maneuvers, totalM: cum[cum.length - 1] ?? 0, totalS: trip.summary.time, lang, preference, ...(stops.length ? { stops } : {}) }
}

type From = { lon: number; lat: number; heading?: number | null }

async function valhalla(from: From, to: RouteTarget[], lang: string, extra: Record<string, unknown>, signal?: AbortSignal) {
  const start: Record<string, number> = { lat: from.lat, lon: from.lon }
  if (from.heading != null) {
    start.heading = Math.round(from.heading)
    start.heading_tolerance = 60
  }
  const res = await fetch(VALHALLA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Each place after the start is a stop: the route arrives there before going on.
      locations: [start, ...to.map((t) => ({ lat: t.lat, lon: t.lon }))],
      costing: 'auto',
      directions_options: { units: 'kilometers', language: lang },
      // Lane guidance at junctions where the map data has the lanes.
      turn_lanes: true,
      ...extra,
    }),
    signal,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.trip) {
    throw new Error(data?.error ? `No route: ${data.error}` : `Routing failed (${res.status})`)
  }
  return data as { trip: ValhallaTrip; alternates?: { trip: ValhallaTrip }[] }
}

const shortestOptions = { costing_options: { auto: { shortest: true } } }

/** How long Google's routes wait for the lanes before going without them (about 0.2 s normally). */
const LANES_WAIT_MS = 2500

/** Points along a line at least `stepM` apart, ends kept: Google's line, light enough to send. */
export function thinLine(coords: LngLat[], stepM = 15): LngLat[] {
  const out: LngLat[] = []
  coords.forEach((c, i) => {
    if (!out.length || i === coords.length - 1 || distance(out[out.length - 1], c) >= stepM) out.push(c)
  })
  return out
}

/** The open server's turns, with lanes, along exactly the line given (its map-matching service). */
async function turnsAlong(route: Route, lang: string, signal: AbortSignal): Promise<Route | null> {
  const res = await fetch(VALHALLA.replace(/\/route$/, '/trace_route'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shape: thinLine(route.coords).map(([lon, lat]) => ({ lat, lon })),
      costing: 'auto',
      shape_match: 'map_snap',
      turn_lanes: true,
      directions_options: { units: 'kilometers', language: lang },
    }),
    signal,
  })
  const data = await res.json().catch(() => null)
  return res.ok && data?.trip ? tripToRoute(data.trip, lang, 'fastest') : null
}

/**
 * Google's routes with lanes added. Google's route data has none, so each route's line
 * is given to the open routing server, which follows it on its own map and says which
 * lanes each junction has; those are copied onto Google's turns at the same junctions.
 * Without an answer in time, the routes go without lanes.
 */
async function googleWithLanes(from: From, to: RouteTarget[], lang: string, signal: AbortSignal | undefined, alternatives: boolean): Promise<Route[]> {
  const routes = await googleRoutes(from, to, lang, signal, alternatives)
  const lanes = new AbortController()
  signal?.addEventListener('abort', () => lanes.abort())
  const timer = window.setTimeout(() => lanes.abort(), LANES_WAIT_MS)
  await Promise.all(
    routes.map(async (r) => {
      const traced = await turnsAlong(r, lang, lanes.signal).catch(() => null)
      if (traced) transferLanes(r, traced)
    }),
  )
  window.clearTimeout(timer)
  return routes
}

/** One route through the stops in order (used for rerouting): keeps the driver's fastest/shortest choice. */
export async function fetchRoute(from: From, to: RouteTarget[], lang: string, signal?: AbortSignal, preference: RoutePreference = 'fastest'): Promise<Route> {
  if (usingGoogle()) return (await googleWithLanes(from, to, lang, signal, false))[0]
  const data = await valhalla(from, to, lang, preference === 'shortest' ? shortestOptions : {}, signal)
  return tripToRoute(data.trip, lang, preference, to)
}

/** Climb and descent along a route, from the routing server's elevation data. */
async function addEnergy(route: Route, signal?: AbortSignal): Promise<Route> {
  // Sample ~150 points along the route; enough for climbs, small request.
  const step = Math.max(1, Math.floor(route.coords.length / 150))
  const shape = route.coords.filter((_, i) => i % step === 0 || i === route.coords.length - 1).map(([lon, lat]) => ({ lat, lon }))
  const res = await fetch(VALHALLA.replace(/\/route$/, '/height'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shape, range: false }),
    signal,
  })
  if (!res.ok) return route
  const data = await res.json().catch(() => null)
  if (!Array.isArray(data?.height)) return route
  const { climbM, descentM } = climbStats(data.height)
  const kWh = estimateKWh({ lengthKm: route.totalM / 1000, timeS: route.totalS, climbM, descentM })
  return { ...route, climbM, descentM, kWh }
}

/**
 * Route choices for the preview: the fastest route, up to two alternatives and the
 * shortest route, each with an energy estimate, labelled Fastest/Shortest/Economy.
 * Through several stops the server offers no alternatives, so it is fastest and shortest.
 */
export async function fetchRouteOptions(from: From, to: RouteTarget[], lang: string, signal?: AbortSignal): Promise<RouteOption[]> {
  if (usingGoogle()) {
    // Google: up to three traffic-aware choices (one when there are stops on the way).
    const routes = await googleWithLanes(from, to, lang, signal, true)
    return buildOptions(await Promise.all(routes.map((r) => addEnergy(r, signal).catch(() => r))))
  }
  const [fast, short] = await Promise.allSettled([
    valhalla(from, to, lang, to.length === 1 ? { alternates: 2 } : {}, signal),
    valhalla(from, to, lang, shortestOptions, signal),
  ])
  if (fast.status === 'rejected' && short.status === 'rejected') throw fast.reason
  const candidates: Route[] = []
  if (fast.status === 'fulfilled') {
    candidates.push(tripToRoute(fast.value.trip, lang, 'fastest', to))
    for (const alt of fast.value.alternates ?? []) candidates.push(tripToRoute(alt.trip, lang, 'fastest', to))
  }
  if (short.status === 'fulfilled') candidates.push(tripToRoute(short.value.trip, lang, 'shortest', to))
  // Energy is a bonus: if elevation fails, options still show without Economy.
  const withEnergy = await Promise.all(candidates.map((r) => addEnergy(r, signal).catch(() => r)))
  return buildOptions(withEnergy)
}

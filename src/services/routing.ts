/**
 * Turn-by-turn routing. Prototype provider: the public Valhalla server
 * (FOSSGIS). Returns maneuvers with spoken instructions. No live traffic.
 */
import { decodePolyline6, distance, type LngLat } from '../lib/geo'
import { climbStats, estimateKWh } from '../nav/energy'
import { buildOptions, type RouteOption } from '../nav/routeOptions'
import type { Maneuver, Route } from '../types'

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
}

export type RoutePreference = 'fastest' | 'shortest'

interface ValhallaTrip {
  legs: { shape: string; maneuvers: ValhallaManeuver[] }[]
  summary: { time: number; length: number }
}

function tripToRoute(trip: ValhallaTrip, lang: string, preference: RoutePreference): Route {
  const leg = trip.legs[0]
  const coords: LngLat[] = decodePolyline6(leg.shape)
  const cum: number[] = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]))
  const maneuvers: Maneuver[] = leg.maneuvers.map((m) => ({
    type: m.type,
    instruction: m.instruction,
    verbalAlert: m.verbal_transition_alert_instruction,
    verbalPre: m.verbal_pre_transition_instruction,
    verbalPost: m.verbal_post_transition_instruction,
    street: (m.street_names ?? m.begin_street_names ?? [])[0] ?? '',
    shapeIndex: m.begin_shape_index,
    atM: cum[Math.min(m.begin_shape_index, cum.length - 1)],
    lengthM: m.length * 1000,
    timeS: m.time,
  }))
  return { coords, cum, maneuvers, totalM: cum[cum.length - 1], totalS: trip.summary.time, lang, preference }
}

type From = { lon: number; lat: number; heading?: number | null }

async function valhalla(from: From, to: { lon: number; lat: number }, lang: string, extra: Record<string, unknown>, signal?: AbortSignal) {
  const start: Record<string, number> = { lat: from.lat, lon: from.lon }
  if (from.heading != null) {
    start.heading = Math.round(from.heading)
    start.heading_tolerance = 60
  }
  const res = await fetch(VALHALLA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locations: [start, { lat: to.lat, lon: to.lon }],
      costing: 'auto',
      directions_options: { units: 'kilometers', language: lang },
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

/** One route (used for rerouting): keeps the driver's fastest/shortest choice. */
export async function fetchRoute(from: From, to: { lon: number; lat: number }, lang: string, signal?: AbortSignal, preference: RoutePreference = 'fastest'): Promise<Route> {
  const data = await valhalla(from, to, lang, preference === 'shortest' ? shortestOptions : {}, signal)
  return tripToRoute(data.trip, lang, preference)
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
 */
export async function fetchRouteOptions(from: From, to: { lon: number; lat: number }, lang: string, signal?: AbortSignal): Promise<RouteOption[]> {
  const [fast, short] = await Promise.allSettled([
    valhalla(from, to, lang, { alternates: 2 }, signal),
    valhalla(from, to, lang, shortestOptions, signal),
  ])
  if (fast.status === 'rejected' && short.status === 'rejected') throw fast.reason
  const candidates: Route[] = []
  if (fast.status === 'fulfilled') {
    candidates.push(tripToRoute(fast.value.trip, lang, 'fastest'))
    for (const alt of fast.value.alternates ?? []) candidates.push(tripToRoute(alt.trip, lang, 'fastest'))
  }
  if (short.status === 'fulfilled') candidates.push(tripToRoute(short.value.trip, lang, 'shortest'))
  // Energy is a bonus: if elevation fails, options still show without Economy.
  const withEnergy = await Promise.all(candidates.map((r) => addEnergy(r, signal).catch(() => r)))
  return buildOptions(withEnergy)
}

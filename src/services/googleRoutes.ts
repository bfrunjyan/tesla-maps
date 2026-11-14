/**
 * Routing through Google's Routes API (test, with the Google map only): routes that
 * take live traffic into account, with the traffic level along each stretch.
 * Google's answer is turned into the same Route the rest of Mapic uses.
 */
import { decodePolyline, distance, type LngLat } from '../lib/geo'
import type { Congestion, TrafficSpan } from '../nav/routeTraffic'
import type { Maneuver, Route, RouteStop } from '../types'
import { googleKey } from './googleMaps'

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes'
/** Only what Mapic uses: Google bills by what is asked for. */
const FIELDS = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.travelAdvisory.speedReadingIntervals',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.polyline.encodedPolyline',
  'routes.legs.steps.navigationInstruction',
].join(',')

export interface GoogleStep {
  distanceMeters?: number
  staticDuration?: string
  polyline?: { encodedPolyline?: string }
  navigationInstruction?: { maneuver?: string; instructions?: string }
}
export interface GoogleRoute {
  duration?: string
  distanceMeters?: number
  polyline?: { encodedPolyline?: string }
  travelAdvisory?: { speedReadingIntervals?: { startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: string }[] }
  legs?: { steps?: GoogleStep[] }[]
}

export type Target = { lon: number; lat: number; name?: string }

/** "123s" → 123 */
const seconds = (d: string | undefined) => (d ? parseFloat(d) || 0 : 0)

/** Google's maneuver → the routing server's maneuver type, which icons, voice and zoom use. */
export function maneuverType(m: string | undefined): number {
  switch (m) {
    case 'DEPART': return 1
    case 'TURN_SLIGHT_RIGHT': return 9
    case 'TURN_RIGHT': return 10
    case 'TURN_SHARP_RIGHT': return 11
    case 'UTURN_RIGHT': return 12
    case 'UTURN_LEFT': return 13
    case 'TURN_SHARP_LEFT': return 14
    case 'TURN_LEFT': return 15
    case 'TURN_SLIGHT_LEFT': return 16
    case 'RAMP_RIGHT': return 18
    case 'RAMP_LEFT': return 19
    case 'FORK_RIGHT': return 23
    case 'FORK_LEFT': return 24
    case 'MERGE': return 25
    case 'ROUNDABOUT_LEFT': case 'ROUNDABOUT_RIGHT': return 26
    case 'FERRY': case 'FERRY_TRAIN': return 28
    default: return 8 // straight, name change, unspecified
  }
}

const LEVEL: Record<string, Congestion> = { NORMAL: 'low', SLOW: 'moderate', TRAFFIC_JAM: 'heavy' }

function arrivalWording(lang: string, stopName: string | null) {
  const ru = lang.startsWith('ru')
  if (stopName) {
    return ru
      ? { instruction: `Остановка: ${stopName}`, alert: `Впереди остановка: ${stopName}.`, pre: `Вы прибыли: ${stopName}.` }
      : { instruction: `Arrive at ${stopName}`, alert: `Your stop, ${stopName}, is ahead.`, pre: `You have arrived at ${stopName}.` }
  }
  return ru
    ? { instruction: 'Вы прибыли', alert: 'Скоро пункт назначения.', pre: 'Вы прибыли в пункт назначения.' }
    : { instruction: 'You have arrived', alert: 'Your destination is ahead.', pre: 'You have arrived at your destination.' }
}

/**
 * One of Google's routes as a Mapic route. The line is built from the steps, so each
 * turn sits exactly where its step starts; each leg ends with an arrival at its stop.
 * Step times are without traffic, so they are scaled to add up to the trip's time
 * with traffic. Google's traffic levels are moved from its overview line onto ours by
 * distance along the route.
 */
export function googleRouteToRoute(g: GoogleRoute, lang: string, targets: Target[]): Route {
  const coords: LngLat[] = []
  const cum: number[] = []
  const maneuvers: Maneuver[] = []
  const stops: RouteStop[] = []
  const add = (pts: LngLat[]) => {
    for (const c of coords.length ? pts.slice(1) : pts) {
      cum.push(coords.length ? cum[cum.length - 1] + distance(coords[coords.length - 1], c) : 0)
      coords.push(c)
    }
  }
  const legs = g.legs ?? []
  legs.forEach((leg, li) => {
    for (const step of leg.steps ?? []) {
      const at = coords.length ? coords.length - 1 : 0
      add(decodePolyline(step.polyline?.encodedPolyline ?? '', 5))
      const text = (step.navigationInstruction?.instructions ?? '').replace(/\s*\n+\s*/g, '. ').trim()
      maneuvers.push({
        type: maneuverType(step.navigationInstruction?.maneuver),
        instruction: text || 'Continue',
        verbalAlert: text || undefined,
        verbalPre: text || undefined,
        street: '',
        shapeIndex: at,
        atM: cum[at] ?? 0,
        lengthM: step.distanceMeters ?? 0,
        timeS: seconds(step.staticDuration),
      })
    }
    const last = li === legs.length - 1
    const target = targets[li]
    const words = arrivalWording(lang, last ? null : target?.name ?? null)
    const end = Math.max(0, coords.length - 1)
    maneuvers.push({ type: 4, instruction: words.instruction, verbalAlert: words.alert, verbalPre: words.pre, street: '', shapeIndex: end, atM: cum[end] ?? 0, lengthM: 0, timeS: 0 })
    if (target) stops.push({ lon: target.lon, lat: target.lat, atM: cum[end] ?? 0, maneuverIndex: maneuvers.length - 1 })
  })

  const totalM = cum[cum.length - 1] ?? 0
  const stepS = maneuvers.reduce((sum, m) => sum + m.timeS, 0)
  const totalS = seconds(g.duration) || stepS
  if (stepS > 0) for (const m of maneuvers) m.timeS *= totalS / stepS

  return { coords, cum, maneuvers, totalM, totalS, lang, preference: 'fastest', stops, traffic: trafficSpans(g, totalM), source: 'google' }
}

/** Google's traffic levels, by distance along a route `totalM` long. Neighbouring stretches of one level are joined. */
export function trafficSpans(g: GoogleRoute, totalM: number): TrafficSpan[] {
  const line = decodePolyline(g.polyline?.encodedPolyline ?? '', 5)
  if (line.length < 2) return []
  const at = [0]
  for (let i = 1; i < line.length; i++) at.push(at[i - 1] + distance(line[i - 1], line[i]))
  const scale = at[at.length - 1] > 0 ? totalM / at[at.length - 1] : 0
  const spans: TrafficSpan[] = []
  for (const iv of g.travelAdvisory?.speedReadingIntervals ?? []) {
    const level = iv.speed ? LEVEL[iv.speed] : undefined
    if (!level) continue
    const fromM = at[Math.min(iv.startPolylinePointIndex ?? 0, at.length - 1)] * scale
    const toM = at[Math.min(iv.endPolylinePointIndex ?? at.length - 1, at.length - 1)] * scale
    if (toM <= fromM) continue
    const prev = spans[spans.length - 1]
    if (prev && prev.level === level && Math.abs(prev.toM - fromM) < 1) prev.toM = toM
    else spans.push({ fromM, toM, level })
  }
  return spans
}

/** Routes from Google through the targets in order. `alternatives`: up to three choices (one target only). */
export async function googleRoutes(
  from: { lon: number; lat: number; heading?: number | null },
  targets: Target[],
  lang: string,
  signal?: AbortSignal,
  alternatives = false,
): Promise<Route[]> {
  const point = (p: { lon: number; lat: number }) => ({ latLng: { latitude: p.lat, longitude: p.lon } })
  const origin: Record<string, unknown> = { ...point(from) }
  if (from.heading != null) origin.heading = Math.round(((from.heading % 360) + 360) % 360)
  const dest = targets[targets.length - 1]
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey() ?? '', 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({
      origin: { location: origin },
      destination: { location: point(dest) },
      intermediates: targets.slice(0, -1).map((t) => ({ location: point(t) })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      extraComputations: ['TRAFFIC_ON_POLYLINE'],
      computeAlternativeRoutes: alternatives && targets.length === 1,
      polylineQuality: 'HIGH_QUALITY',
      languageCode: lang,
      units: 'METRIC',
    }),
    signal,
  })
  const data = (await res.json().catch(() => null)) as { routes?: GoogleRoute[]; error?: { message?: string } } | null
  if (!res.ok) throw new Error(data?.error?.message ? `Routing failed: ${data.error.message.split('.')[0]}` : `Routing failed (${res.status})`)
  if (!data?.routes?.length) throw new Error('No route found')
  return data.routes.map((r) => googleRouteToRoute(r, lang, targets))
}

/**
 * Google's predicted driving time (seconds) through the targets, leaving at `departAt`:
 * live traffic for now, Google's traffic forecast for later. One billed request.
 */
export async function googleTravelSeconds(
  from: { lon: number; lat: number },
  targets: Target[],
  departAt: Date,
  signal?: AbortSignal,
): Promise<number> {
  const point = (p: { lon: number; lat: number }) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } })
  // Google refuses a departure in the past; "now" plus a little stays valid in flight.
  const depart = new Date(Math.max(departAt.getTime(), Date.now() + 60_000))
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey() ?? '', 'X-Goog-FieldMask': 'routes.duration' },
    body: JSON.stringify({
      origin: point(from),
      destination: point(targets[targets.length - 1]),
      intermediates: targets.slice(0, -1).map(point),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      departureTime: depart.toISOString(),
    }),
    signal,
  })
  const data = (await res.json().catch(() => null)) as { routes?: { duration?: string }[]; error?: { message?: string } } | null
  const s = seconds(data?.routes?.[0]?.duration)
  if (!res.ok || !s) throw new Error(data?.error?.message ?? `Travel time failed (${res.status})`)
  return s
}

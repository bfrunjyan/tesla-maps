/**
 * Turn-by-turn routing. Prototype provider: the public Valhalla server
 * (FOSSGIS). Returns maneuvers with spoken instructions. No live traffic.
 */
import { decodePolyline6, distance, type LngLat } from '../lib/geo'
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

export async function fetchRoute(
  from: { lon: number; lat: number; heading?: number | null },
  to: { lon: number; lat: number },
  lang: string,
  signal?: AbortSignal,
): Promise<Route> {
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
    }),
    signal,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.trip) {
    throw new Error(data?.error ? `No route: ${data.error}` : `Routing failed (${res.status})`)
  }
  const leg = data.trip.legs[0]
  const coords: LngLat[] = decodePolyline6(leg.shape)
  const cum: number[] = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]))

  const maneuvers: Maneuver[] = (leg.maneuvers as ValhallaManeuver[]).map((m) => ({
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

  return {
    coords,
    cum,
    maneuvers,
    totalM: cum[cum.length - 1],
    totalS: data.trip.summary.time,
    lang,
  }
}

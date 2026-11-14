/**
 * Speed limits along the route being driven.
 *
 * The open routing server's map-matching service follows the route's line (Mapic's or
 * Google's) on OpenStreetMap and returns each road's posted limit ("maxspeed"). Where
 * OpenStreetMap has no limit for a road, none is shown: the sign never guesses. On test
 * routes in Yerevan, main roads had limits (about 60% of the length); side streets mostly
 * not.
 */
import { decodePolyline6, distance, type LngLat } from '../lib/geo'
import { thinLine } from '../services/routing'
import type { NavProgress, Route } from '../types'

const TRACE = 'https://valhalla1.openstreetmap.de/trace_attributes'
const WAIT_MS = 10_000

/** Gaps shorter than this between two stretches with the same limit are bridged. */
const JOIN_GAP_M = 30

export interface SpeedSpan {
  fromM: number
  toM: number
  kmh: number
}

export interface TraceEdge {
  speed_limit?: number | string
  begin_shape_index?: number
  end_shape_index?: number
}

/**
 * The limits along a route from the server's answer: each road's limit placed by where
 * it lies on the matched line, scaled to the route's own length. Neighbouring roads with
 * the same limit are joined; roads without one are left out.
 */
export function spansFromTrace(edges: TraceEdge[], matched: LngLat[], routeTotalM: number): SpeedSpan[] {
  if (matched.length < 2 || routeTotalM <= 0) return []
  const cum = [0]
  for (let i = 1; i < matched.length; i++) cum.push(cum[i - 1] + distance(matched[i - 1], matched[i]))
  const scale = cum[cum.length - 1] > 0 ? routeTotalM / cum[cum.length - 1] : 0
  const spans: SpeedSpan[] = []
  for (const e of edges) {
    const kmh = typeof e.speed_limit === 'number' ? e.speed_limit : Number.NaN
    if (!(kmh > 0 && kmh <= 200)) continue
    const from = cum[Math.min(e.begin_shape_index ?? 0, cum.length - 1)] * scale
    const to = cum[Math.min(e.end_shape_index ?? cum.length - 1, cum.length - 1)] * scale
    if (to <= from) continue
    const prev = spans[spans.length - 1]
    // Junctions often come back without a limit for a few metres: the same limit either
    // side of a short gap is one stretch, so the sign doesn't blink off at each crossing.
    if (prev && prev.kmh === kmh && from - prev.toM < JOIN_GAP_M) prev.toM = to
    else spans.push({ fromM: from, toM: to, kmh })
  }
  return spans
}

/** The limit where the car is on the route, or null where it isn't known (or off the route). */
export function limitAt(spans: SpeedSpan[] | null | undefined, progress: Pick<NavProgress, 'alongM' | 'offRouteM'> | null | undefined): number | null {
  if (!spans?.length || !progress || progress.offRouteM > 30) return null
  const s = spans.find((x) => progress.alongM >= x.fromM && progress.alongM < x.toM)
  return s ? s.kmh : null
}

/** Over the limit by more than this (km/h) turns the speed red, like the car's own warning. */
export const OVER_BY_KMH = 3

export function isOver(speedKmh: number, limit: number | null) {
  return limit != null && speedKmh > limit + OVER_BY_KMH
}

/** Asks the open server for the limits along `route`. Null when it can't say. */
export async function fetchSpeedLimits(route: Route, signal?: AbortSignal): Promise<SpeedSpan[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), WAIT_MS)
  signal?.addEventListener('abort', () => ctrl.abort())
  try {
    const res = await fetch(TRACE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shape: thinLine(route.coords, 20).map(([lon, lat]) => ({ lat, lon })),
        costing: 'auto',
        shape_match: 'map_snap',
        filters: { attributes: ['edge.speed_limit', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { edges?: TraceEdge[]; shape?: string }
    if (!data.edges || !data.shape) return null
    return spansFromTrace(data.edges, decodePolyline6(data.shape), route.totalM)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

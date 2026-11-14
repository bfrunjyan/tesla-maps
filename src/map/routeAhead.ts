/**
 * Drawing the route still ahead of the car without rebuilding it on every GPS fix.
 * While driving the line is trimmed behind the car. The Google map used to throw away
 * every traffic-coloured line and make new ones each time a fix arrived; these helpers
 * decide when a redraw is due and reuse the line objects already on the map. Less work
 * for the car's computer; measured on a desktop it does not change how much memory the
 * map holds (that is Google's own map data: see scripts/perf-drive.mjs --memory).
 */
import type { LngLat } from '../lib/geo'
import { sliceRoute, type Congestion, type TrafficSpan } from '../nav/routeTraffic'

/** How far the car moves along the route before the line behind it is trimmed again. */
export const TRIM_STEP_M = 15

export interface AheadState {
  /** The route drawn (identity: a new route is a new object). */
  route: object | null
  /** The traffic drawn on it (identity). */
  traffic: object | null
  /** Where the line was trimmed: metres along the route, or 0 when not driving. */
  fromM: number
}

/** Whether the line must be drawn again: another route or traffic, or the car moved far enough. */
export function needsRedraw(last: AheadState | null, next: AheadState, stepM = TRIM_STEP_M): boolean {
  if (!last) return true
  if (last.route !== next.route || last.traffic !== next.traffic) return true
  // Backwards too (a new fix can land a little behind the last one).
  return Math.abs(next.fromM - last.fromM) >= stepM
}

export interface TrafficPiece {
  level: Congestion
  coords: LngLat[]
}

/** The traffic colours still ahead of `fromM`, as lines to draw. */
export function trafficAhead(route: { coords: LngLat[]; cum: number[] }, spans: TrafficSpan[], fromM: number): TrafficPiece[] {
  const out: TrafficPiece[] = []
  for (const span of spans) {
    if (span.toM <= fromM) continue
    const coords = sliceRoute(route, Math.max(span.fromM, fromM), span.toM)
    if (coords.length > 1) out.push({ level: span.level, coords })
  }
  return out
}

/**
 * Brings a set of map objects in line with `pieces`: existing objects are updated in
 * place, new ones are made only when there are more pieces than objects, and spare
 * ones are removed. Returns the objects now in use, in the order of `pieces`.
 */
export function syncPool<T, P>(pool: T[], pieces: P[], make: (piece: P) => T, update: (item: T, piece: P) => void, remove: (item: T) => void): T[] {
  const used = pool.slice(0, pieces.length)
  pieces.forEach((piece, i) => {
    if (i < used.length) update(used[i], piece)
    else used.push(make(piece))
  })
  for (const spare of pool.slice(pieces.length)) remove(spare)
  return used
}

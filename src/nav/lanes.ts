/**
 * Lane guidance: which lanes a junction has, where each one goes, and which to take.
 *
 * The lanes come from the open routing server (Valhalla), which reads them from
 * OpenStreetMap's turn:lanes, so they exist only where mappers have added them.
 * Google's route data has no lanes at all; on the Google map they are copied onto
 * Google's turns that sit at the same junction.
 */
import { distance, type LngLat } from '../lib/geo'
import type { Maneuver, NavProgress, Route } from '../types'

export type LaneDir = 'uturn' | 'sharp-left' | 'left' | 'slight-left' | 'through' | 'slight-right' | 'right' | 'sharp-right' | 'merge-left' | 'merge-right'

export interface Lane {
  /** Where the lane goes, as painted on the road, left-most first. Empty: no marking. */
  dirs: LaneDir[]
  /** The direction to follow in this lane, when it is a lane to take. */
  use: LaneDir | null
  /** best: take it, no lane change needed later; ok: also leads on, but may need a change later; no: not for this route. */
  fit: 'best' | 'ok' | 'no'
}

/** Valhalla's lane bits (route API reference, "lanes"). */
const BITS: [number, LaneDir][] = [
  [256, 'uturn'],
  [4, 'sharp-left'],
  [8, 'left'],
  [16, 'slight-left'],
  [2, 'through'],
  [32, 'slight-right'],
  [64, 'right'],
  [128, 'sharp-right'],
  [512, 'merge-left'],
  [1024, 'merge-right'],
]
const dirsOf = (bits: number): LaneDir[] => BITS.filter(([b]) => bits & b).map(([, d]) => d)

export interface ValhallaLane {
  directions: number
  valid?: number
  active?: number
}

/** The server's lanes for one turn, or undefined when it has none worth showing. */
export function lanesFromValhalla(raw: ValhallaLane[] | undefined): Lane[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) return undefined
  const lanes = raw.map((l): Lane => {
    const dirs = dirsOf(l.directions ?? 0)
    const pick = l.active ? l.active : l.valid
    const use = pick ? (dirsOf(pick)[0] ?? null) : null
    return { dirs, use, fit: l.active ? 'best' : l.valid ? 'ok' : 'no' }
  })
  // Lanes that say nothing (no markings and none to take) aren't guidance.
  return lanes.some((l) => l.fit !== 'no') ? lanes : undefined
}

/** Which way a turn goes, from the maneuver types the router uses: -1 left, 0 straight on, 1 right. */
function side(type: number): -1 | 0 | 1 {
  if ([9, 10, 11, 12, 18, 20, 23, 37].includes(type)) return 1
  if ([13, 14, 15, 16, 19, 21, 24, 38].includes(type)) return -1
  return 0
}

/** Within this distance two routes' turns are the same junction. */
export const SAME_JUNCTION_M = 40

/**
 * Copies lanes from one route's turns onto another's (Google's), turn by turn, where a
 * turn of the other route is at the same junction and goes the same way. Returns how
 * many turns got lanes.
 */
export function transferLanes(target: Route, source: Route, maxM = SAME_JUNCTION_M): number {
  const withLanes = source.maneuvers.filter((m) => m.lanes?.length).map((m) => ({ m, at: source.coords[m.shapeIndex] }))
  if (!withLanes.length) return 0
  let copied = 0
  for (const m of target.maneuvers) {
    if (m.lanes) continue
    const at = target.coords[m.shapeIndex]
    if (!at) continue
    let best: { m: Maneuver; d: number } | null = null
    for (const s of withLanes) {
      if (side(s.m.type) !== side(m.type)) continue
      const d = distance(at, s.at)
      if (d <= maxM && (!best || d < best.d)) best = { m: s.m, d }
    }
    if (best) {
      m.lanes = best.m.lanes
      copied++
    }
  }
  return copied
}

/** Lanes are shown from this far before the junction. */
export const SHOW_LANES_FROM_M = 600

/** The lanes to show now: the next turn's, once the car is close enough to it. */
export function upcomingLanes(route: Route | null | undefined, progress: NavProgress | null | undefined): { lanes: Lane[]; at: LngLat; index: number } | null {
  if (!route || !progress) return null
  const m = route.maneuvers[progress.nextIndex]
  if (!m?.lanes?.length || progress.toNextM > SHOW_LANES_FROM_M || progress.offRouteM > 30) return null
  return { lanes: m.lanes, at: route.coords[m.shapeIndex], index: progress.nextIndex }
}

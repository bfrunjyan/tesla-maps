import { bearing, distance, projectOnSegment, type LngLat } from '../lib/geo'
import type { NavProgress, Route } from '../types'
import { angleDiff } from './heading'

/** Two stretches of the route this close to the car count as equally near. */
const SAME_ROAD_M = 5

/**
 * Snap a position to the route and work out what comes next.
 * Searches a window ahead of the last known segment so the car can't jump
 * back to an earlier part of a route that loops near itself, and (given the last
 * distance along and how far the car could have moved) not too far forward either.
 *
 * `course` is the direction the car is really moving, when known. It settles one case:
 * a route that goes out along a street and back the same way (to a stop and on, or a
 * U-turn). Both directions are equally near there; the car is on the one it is driving.
 */
export function computeProgress(route: Route, pos: LngLat, lastSeg = 0, lastAlongM?: number, maxAheadM = Infinity, course: number | null = null): NavProgress {
  const { coords, cum, maneuvers } = route
  const from = Math.max(0, lastSeg - 3)
  const to = Math.min(coords.length - 1, lastSeg + 400)
  // Only as far ahead as the car could have driven since the last fix, so a later
  // stretch of the route that passes close by can't capture a car that turned off.
  const reach = lastAlongM == null ? Infinity : lastAlongM + maxAheadM
  let best = { seg: from, t: 0, dist: Infinity, point: coords[from] as LngLat }
  for (let i = from; i < to; i++) {
    if (i > from && cum[i] > reach) break
    const r = projectOnSegment(pos, coords[i], coords[i + 1])
    if (r.dist < best.dist) best = { seg: i, t: r.t, dist: r.dist, point: r.point }
  }
  if (coords.length === 1) best = { seg: 0, t: 0, dist: 0, point: coords[0] }

  // Driving against the nearest stretch: if the route comes back along the same road
  // just ahead, in the car's direction, that is where the car is.
  const along = (i: number) => (distance(coords[i], coords[i + 1]) > 1 ? Math.abs(angleDiff(bearing(coords[i], coords[i + 1]), course!)) : null)
  if (course != null && coords.length > 1 && (along(best.seg) ?? 0) > 120) {
    for (let i = best.seg + 1; i < to; i++) {
      if (cum[i] > reach) break
      const r = projectOnSegment(pos, coords[i], coords[i + 1])
      const angle = along(i)
      if (r.dist <= best.dist + SAME_ROAD_M && angle != null && angle < 60) {
        best = { seg: i, t: r.t, dist: r.dist, point: r.point }
        break
      }
    }
  }

  const segLen = (cum[best.seg + 1] ?? cum[best.seg]) - cum[best.seg]
  const alongM = cum[best.seg] + segLen * best.t

  // Next maneuver = first one whose point is still ahead of us.
  let nextIndex = maneuvers.findIndex((m, i) => i > 0 && m.atM > alongM + 3)
  if (nextIndex === -1) nextIndex = maneuvers.length - 1
  const toNextM = Math.max(0, maneuvers[nextIndex].atM - alongM)
  const remainingM = Math.max(0, route.totalM - alongM)

  // Remaining time: the rest of the current stretch, scaled, plus all later stretches.
  const cur = maneuvers[Math.max(0, nextIndex - 1)]
  const curFrac = cur.lengthM > 0 ? Math.min(1, toNextM / cur.lengthM) : 0
  let remainingS = cur.timeS * curFrac
  for (let i = nextIndex; i < maneuvers.length; i++) remainingS += maneuvers[i].timeS

  return {
    alongM,
    segIndex: best.seg,
    snapped: best.point,
    offRouteM: best.dist,
    nextIndex,
    toNextM,
    remainingM,
    remainingS,
  }
}

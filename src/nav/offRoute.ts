/**
 * Decides when the driver has left the route and a new one is needed.
 * Pure (apart from the small memory inside the detector), tested on its own.
 *
 * Distance alone is slow and easy to fool: a street one block over is within GPS
 * error of the route. So the direction the car is moving counts too:
 *  - turned off: a little way off the route and moving in another direction;
 *  - far off:    well off the route, whatever the direction;
 *  - wrong way:  still on the route's road, but driving it backwards.
 */
import { angleDiff } from './heading'

export interface OffRouteFix {
  /** When the fix was taken, ms. */
  ts: number
  /** Distance from the route line, metres. */
  offRouteM: number
  /** GPS accuracy radius, metres. */
  accuracy: number
  /** m/s */
  speed: number
  /** Direction the car is actually moving, degrees, or null when unknown. */
  course: number | null
  /** Direction of the route at the nearest point, or null. */
  routeBearing: number | null
}

export type OffRouteReason = 'left-route' | 'wrong-way'

/** Allowance for GPS error: grows with the reported accuracy, up to a limit. */
const noise = (accuracy: number) => Math.min(Math.max(0, accuracy), 30)

/** Well off the route: 35 m plus GPS allowance (at most 65 m). */
export const farLimit = (accuracy: number) => 35 + noise(accuracy)
/** Close enough to still count as on the road: 15 m plus half the allowance (at most 30 m). */
export const nearLimit = (accuracy: number) => 15 + noise(accuracy) / 2

const TURN_DEG = 35
const WRONG_WAY_DEG = 140
const MOVING = 2
const WRONG_WAY_SPEED = 3

export function createOffRouteDetector() {
  let off = { since: 0, fixes: 0, turned: 0 }
  let wrong = { since: 0, fixes: 0 }

  function reset() {
    off = { since: 0, fixes: 0, turned: 0 }
    wrong = { since: 0, fixes: 0 }
  }

  /** Feed every fix while guiding. Returns a reason once a new route is needed. */
  function check(f: OffRouteFix): OffRouteReason | null {
    const angle = f.course != null && f.routeBearing != null ? Math.abs(angleDiff(f.routeBearing, f.course)) : null
    const far = f.offRouteM > farLimit(f.accuracy)
    const turned = f.offRouteM > nearLimit(f.accuracy) && f.speed >= MOVING && angle != null && angle > TURN_DEG

    if (far || turned) {
      if (!off.fixes) off.since = f.ts
      off.fixes++
      if (turned) off.turned++
      const held = f.ts - off.since
      // Turned off: two fixes a second apart are enough. Distance alone needs three fixes, or two over 4 s.
      if ((off.turned >= 2 && held >= 1000) || off.fixes >= 3 || (off.fixes >= 2 && held >= 4000)) {
        reset()
        return 'left-route'
      }
    } else {
      off = { since: 0, fixes: 0, turned: 0 }
    }

    const wrongWay = f.offRouteM <= nearLimit(f.accuracy) && f.speed >= WRONG_WAY_SPEED && angle != null && angle > WRONG_WAY_DEG
    if (wrongWay) {
      if (!wrong.fixes) wrong.since = f.ts
      wrong.fixes++
      if (wrong.fixes >= 3 && f.ts - wrong.since >= 4000) {
        reset()
        return 'wrong-way'
      }
    } else {
      wrong = { since: 0, fixes: 0 }
    }
    return null
  }

  return { check, reset }
}

/**
 * The direction the car is really moving: the GPS course when it is moving, otherwise
 * the bearing from the last fix once it has moved further than the position error.
 */
export function courseOf(o: { gpsHeading: number | null; speed: number; moved: number; movedBearing: number; accuracy: number }): number | null {
  if (o.gpsHeading != null && !Number.isNaN(o.gpsHeading) && o.speed >= 1.4) return o.gpsHeading
  if (o.moved > Math.max(5, Math.min(o.accuracy, 30) * 0.5)) return o.movedBearing
  return null
}

/**
 * How far ahead of its last place on the route the car may be matched. Stops the car
 * being matched to a later part of the route that happens to pass nearby (a parallel
 * street, the far side of a loop) after the driver turns off.
 */
export function maxAheadM(speed: number, sinceLastFixMs: number, accuracy: number) {
  const seconds = Math.min(Math.max(sinceLastFixMs / 1000, 1), 120)
  return Math.max(150, (speed + 8) * seconds * 2 + noise(accuracy))
}

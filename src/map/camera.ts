/**
 * Follow-camera zoom. Pure (apart from one small memory in createNavZoom), so it's
 * tested on its own.
 *
 * - Not navigating: keep the driver's zoom, but never wider than street level.
 * - Navigating, between turns: a wider view that eases out with speed.
 * - Navigating, near a turn: zoom in on the junction while approaching, hold it
 *   through the turn, then ease back out. U-turns come in closest.
 */
export const NAV_ZOOM = 17
export const STREET_ZOOM = 15.5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Eases 0→1 without a jolt at either end. */
const smooth = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

/** Between turns: closer in town, wider on fast roads (15.3 from about 85 km/h). */
export function cruiseZoom(speed: number) {
  return NAV_ZOOM - Math.min(1.7, Math.max(0, speed) / 14)
}

export function followZoom(o: { navigating: boolean; speed: number; current: number }) {
  if (o.navigating) return cruiseZoom(o.speed)
  return Math.max(o.current, STREET_ZOOM)
}

/** How a maneuver pulls the camera in. */
export type TurnClass = 'turn' | 'uturn' | 'fork' | 'arrive' | 'none'

/** Valhalla maneuver type → how much the junction matters to the camera. */
export function turnClass(type: number): TurnClass {
  switch (type) {
    case 10: case 11: case 14: case 15: // right, sharp right, sharp left, left
    case 26: case 27: // roundabout: entering and leaving
      return 'turn'
    case 12: case 13:
      return 'uturn'
    case 9: case 16: // slight right / left
    case 17: case 18: case 19: // ramps
    case 20: case 21: // exits
    case 23: case 24: // keep right / left
    case 25: case 37: case 38: // merges
      return 'fork'
    case 4: case 5: case 6:
      return 'arrive'
    default:
      return 'none' // start, continue, road changes name, keep straight, ferries
  }
}

/** Zoom at the junction itself. Forks are taken at speed, so they stay a little wider. */
export const TURN_ZOOM: Record<TurnClass, number> = { turn: 17.7, uturn: 18.1, fork: 16.9, arrive: 17.7, none: 0 }

/** After the turn: stay close for this long, then ease out by the second distance. */
const HOLD_PAST_M = 30
const OUT_BY_M = 130

export interface NavZoomInput {
  /** The route being driven; a new one (reroute) forgets what came before. */
  route: unknown
  /** m/s */
  speed: number
  /** False while the car is off the route line (a reroute is coming). */
  onRoute: boolean
  next: { index: number; type: number; toM: number } | null
  /** The maneuver just passed and how far behind it is. */
  prev: { type: number; pastM: number } | null
}

/** Where zooming in starts and where it is complete, by speed: about 14 s and 5 s before the turn. */
export function approachWindow(speed: number) {
  return { startM: clamp(speed * 14, 180, 700), fullM: clamp(speed * 5, 60, 250) }
}

/**
 * The navigation zoom, call by call. It remembers how far it has zoomed in for the
 * turn ahead, so braking on the approach (which shortens the window) never makes the
 * map zoom back out before the turn.
 */
export function createNavZoom() {
  let held: { route: unknown; index: number; f: number } = { route: null, index: -1, f: 0 }

  return function navZoom(o: NavZoomInput): number {
    const cruise = cruiseZoom(o.speed)
    if (!o.onRoute) {
      held = { route: null, index: -1, f: 0 }
      return cruise
    }
    let zoom = cruise

    if (o.next) {
      const target = TURN_ZOOM[turnClass(o.next.type)]
      let f = 0
      if (target > cruise) {
        const { startM, fullM } = approachWindow(o.speed)
        f = smooth((startM - o.next.toM) / (startM - fullM))
        if (held.route === o.route && held.index === o.next.index) f = Math.max(f, held.f)
        zoom = Math.max(zoom, cruise + (target - cruise) * f)
      }
      held = { route: o.route, index: o.next.index, f }
    }

    if (o.prev) {
      const target = TURN_ZOOM[turnClass(o.prev.type)]
      if (target > cruise) {
        const f = smooth((OUT_BY_M - o.prev.pastM) / (OUT_BY_M - HOLD_PAST_M))
        zoom = Math.max(zoom, cruise + (target - cruise) * f)
      }
    }
    return zoom
  }
}

/**
 * Turns noisy GPS fixes into a steady heading for the car arrow and the
 * heading-up map. Pure functions, no browser APIs, so it can be tested alone.
 */

export interface HeadingInput {
  /** Heading reported by the GPS, degrees, or null. */
  gpsHeading: number | null
  /** m/s */
  speed: number
  /** Distance moved since the previous fix, meters. */
  moved: number
  /** Bearing from the previous fix to this one, degrees. */
  movedBearing: number
  /** GPS accuracy radius, meters. */
  accuracy: number
  /** Direction of the route at the snapped point, when navigating on route. */
  routeBearing: number | null
}

/** GPS heading is noise below walking pace (~5 km/h). */
const MIN_SPEED_FOR_GPS_HEADING = 1.4
/** Below this the car is treated as stopped and the heading freezes. */
const STOPPED_SPEED = 0.5
const STOPPED_MOVE_M = 2

export function angleDiff(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180
}

function blend(from: number, to: number, t: number) {
  return (from + angleDiff(from, to) * t + 360) % 360
}

/** The best raw heading for this fix, or null to keep the previous one. */
export function rawHeading(i: HeadingInput): number | null {
  const stopped = i.speed < STOPPED_SPEED && i.moved < STOPPED_MOVE_M
  if (stopped) return null
  // On the route: the road's own direction is exact and steady.
  if (i.routeBearing != null) return i.routeBearing
  if (i.gpsHeading != null && !Number.isNaN(i.gpsHeading) && i.speed >= MIN_SPEED_FOR_GPS_HEADING) return i.gpsHeading
  // Off route without a usable GPS heading: the direction we actually moved,
  // once we've moved further than the position noise.
  if (i.moved > Math.max(3, Math.min(i.accuracy, 30) * 0.5)) return i.movedBearing
  return null
}

/**
 * Exponential smoothing on the circle. Small changes (noise) blend slowly;
 * large ones (a real turn) follow quickly so the arrow never lags a corner.
 */
export function smoothHeading(prev: number | null, raw: number | null, speed: number): number | null {
  if (raw == null) return prev
  if (prev == null) return raw
  const diff = Math.abs(angleDiff(prev, raw))
  const base = speed > 8 ? 0.5 : 0.35
  const t = diff > 45 ? 0.85 : diff > 20 ? 0.65 : base
  return blend(prev, raw, t)
}

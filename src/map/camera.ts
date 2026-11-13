/**
 * Follow-camera zoom. Pure, so it's tested on its own.
 *
 * - Navigating: close in, easing out a little with speed.
 * - Not navigating: keep the driver's zoom, but never wider than street level.
 */
export const NAV_ZOOM = 17.2
export const STREET_ZOOM = 15.5

export function followZoom(o: { navigating: boolean; speed: number; current: number }) {
  if (o.navigating) return NAV_ZOOM - Math.min(1.6, o.speed / 15)
  return Math.max(o.current, STREET_ZOOM)
}

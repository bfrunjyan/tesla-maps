/**
 * Follow-camera zoom. Pure, so it's tested on its own.
 *
 * - Navigating: close in, easing out a little with speed.
 * - Not navigating, traffic on: wide enough to see nearby jams (the driver can
 *   still pinch to zoom; that zoom is kept).
 * - Not navigating, traffic off: keep the driver's zoom, but never wider than street level.
 */
export const NAV_ZOOM = 17.2
export const STREET_ZOOM = 16.4
export const TRAFFIC_ZOOM = 14.5

export function followZoom(o: { navigating: boolean; speed: number; showTraffic: boolean; current: number }) {
  if (o.navigating) return NAV_ZOOM - Math.min(1.6, o.speed / 15)
  if (o.showTraffic) return Math.min(Math.max(o.current, 11), 18)
  return Math.max(o.current, 15.5)
}

/** Where to ease when traffic is switched or navigation ends (not navigating, following). */
export function zoomForTrafficToggle(showTraffic: boolean) {
  return showTraffic ? TRAFFIC_ZOOM : STREET_ZOOM
}

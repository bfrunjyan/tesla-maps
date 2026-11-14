/**
 * Keeps the traffic along the shown route up to date: loaded when a route is chosen
 * or recalculated, and again every few minutes while it is on screen.
 */
import { fetchTrafficAlong, hasTraffic } from '../services/traffic'
import { useStore } from '../state/store'
import type { Route } from '../types'
import { routeTrafficSpans } from './routeTraffic'

const REFRESH_MS = 180_000

/** The route on screen: the highlighted choice in the preview, or the one being driven. */
export function shownRoute(nav: ReturnType<typeof useStore.getState>['nav']): Route | null {
  if (!nav) return null
  if (nav.status === 'choosing') return nav.options?.[nav.selected ?? 0]?.route ?? null
  return nav.status === 'active' || nav.status === 'rerouting' ? nav.route : null
}

let abort: AbortController | null = null
let loadedFor: Route | null = null
let loadedAt = 0

async function load(route: Route) {
  abort?.abort()
  const mine = (abort = new AbortController())
  loadedFor = route
  loadedAt = Date.now()
  try {
    const lines = await fetchTrafficAlong(route.coords, mine.signal)
    if (mine.signal.aborted || shownRoute(useStore.getState().nav) !== route) return
    // No answer: keep what is drawn (if it is for this route) rather than wiping it.
    if (lines) useStore.getState().set({ routeTraffic: { route, spans: routeTrafficSpans(route, lines) } })
  } catch {
    /* offline or cancelled: the route stays in its plain colour */
  }
}

function sync() {
  const s = useStore.getState()
  const route = shownRoute(s.nav)
  if (!route) {
    abort?.abort()
    loadedFor = null
    if (s.routeTraffic) s.set({ routeTraffic: null })
    return
  }
  if (route !== loadedFor) {
    if (s.routeTraffic && s.routeTraffic.route !== route) s.set({ routeTraffic: null })
    load(route)
  } else if (Date.now() - loadedAt >= REFRESH_MS && document.visibilityState === 'visible') {
    load(route)
  }
}

let started = false
export function startRouteTraffic() {
  if (started || !hasTraffic()) return
  started = true
  useStore.subscribe((s, prev) => {
    if (s.nav !== prev.nav && shownRoute(s.nav) !== shownRoute(prev.nav)) sync()
    // A new trip starts with traffic on the route only.
    if (s.nav && !prev.nav && s.trafficAllRoads) s.set({ trafficAllRoads: false })
  })
  window.setInterval(sync, 30_000)
  document.addEventListener('visibilitychange', sync)
  sync()
}

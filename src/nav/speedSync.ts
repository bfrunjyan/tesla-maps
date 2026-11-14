/**
 * Keeps the speed limits for the route being driven: asked for once per route, when
 * guidance starts and after each reroute.
 */
import { useStore } from '../state/store'
import type { Route } from '../types'
import { fetchSpeedLimits } from './speedLimits'

let started = false
let abort: AbortController | null = null

function guidedRoute(nav: ReturnType<typeof useStore.getState>['nav']): Route | null {
  return nav && (nav.status === 'active' || nav.status === 'rerouting') ? nav.route : null
}

export function startSpeedLimits() {
  if (started) return
  started = true
  useStore.subscribe((s, prev) => {
    const route = guidedRoute(s.nav)
    if (route === guidedRoute(prev.nav)) return
    abort?.abort()
    if (!route) {
      if (s.speedLimits) s.set({ speedLimits: null })
      return
    }
    // A new route: the old limits no longer line up with it.
    if (s.speedLimits && s.speedLimits.route !== route) s.set({ speedLimits: null })
    const mine = (abort = new AbortController())
    void fetchSpeedLimits(route, mine.signal).then((spans) => {
      if (mine.signal.aborted || guidedRoute(useStore.getState().nav) !== route) return
      if (spans) useStore.getState().set({ speedLimits: { route, spans } })
    })
  })
}

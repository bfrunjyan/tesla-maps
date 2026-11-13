import type { Route } from '../types'

export type RouteTag = 'Fastest' | 'Shortest' | 'Economy'

export interface RouteOption {
  route: Route
  tags: RouteTag[]
}

/** Two routes are the same choice if their length and time are within a whisker. */
function sameRoute(a: Route, b: Route) {
  return Math.abs(a.totalM - b.totalM) < 60 && Math.abs(a.totalS - b.totalS) < 30
}

/**
 * Turns candidate routes into at most 3 distinct options, ordered fastest first,
 * each tagged Fastest / Shortest / Economy (a route can carry several tags).
 * Economy is tagged only when energy estimates exist for every option.
 */
export function buildOptions(candidates: Route[], max = 3): RouteOption[] {
  const unique: Route[] = []
  for (const r of candidates) if (!unique.some((u) => sameRoute(u, r))) unique.push(r)
  const routes = unique.sort((a, b) => a.totalS - b.totalS).slice(0, max)
  if (!routes.length) return []

  const fastest = routes[0]
  const shortest = routes.reduce((a, b) => (b.totalM < a.totalM ? b : a))
  const allHaveEnergy = routes.every((r) => typeof r.kWh === 'number')
  const economy = allHaveEnergy ? routes.reduce((a, b) => (b.kWh! < a.kWh! ? b : a)) : null

  return routes.map((route) => {
    const tags: RouteTag[] = []
    if (route === fastest) tags.push('Fastest')
    if (route === shortest && routes.length > 1) tags.push('Shortest')
    if (route === economy && routes.length > 1) tags.push('Economy')
    return { route, tags }
  })
}

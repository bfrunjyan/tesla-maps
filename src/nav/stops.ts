/**
 * A trip with several stops: the places still to visit, in order. The last one is the
 * destination; the ones before it are "via" stops. Pure helpers, tested on their own.
 */
import type { NavProgress, Place, Route } from '../types'

/** Most places one trip can hold (the destination included). */
export const MAX_STOPS = 8
/** A via stop counts as reached this close to it along the route. */
export const REACHED_M = 30

/** Every place still to visit, in order. */
export function stopsOf(nav: { destination: Place; via?: Place[] } | null | undefined): Place[] {
  return nav ? [...(nav.via ?? []), nav.destination] : []
}

/** The other way round: the last stop is the destination. */
export function splitStops(stops: Place[]): { via: Place[]; destination: Place } {
  return { via: stops.slice(0, -1), destination: stops[stops.length - 1] }
}

/** A, B, C… by position in the trip. */
export function stopLetter(index: number) {
  return String.fromCharCode(65 + (index % 26))
}

/** The list with one item moved to another position. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(list.length - 1, to))
  if (from < 0 || from >= list.length || from === target) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

export const sameSpot = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => a.lon === b.lon && a.lat === b.lat

/** Where this place is on the route, when the route was planned through it. */
function routeStop(route: Route, place: { lon: number; lat: number }) {
  return route.stops?.find((s) => sameSpot(s, place)) ?? null
}

/** Whether the car has got to a via stop (driving past it counts: the trip moves on to the next one). */
export function reachedVia(route: Route, stop: Place, alongM: number, withinM = REACHED_M) {
  const planned = routeStop(route, stop)
  return !!planned && planned.atM < route.totalM && alongM >= planned.atM - withinM
}

/** Seconds of driving from the start of the route to its maneuver `index`. */
function timeToManeuver(route: Route, index: number) {
  let s = 0
  for (let i = 0; i < index && i < route.maneuvers.length; i++) s += route.maneuvers[i].timeS
  return s
}

/**
 * Distance and time left to each stop, for the trip list. Null for a stop the route
 * on screen wasn't planned through (the trip was just changed and the new route is
 * still on its way).
 */
export function stopsRemaining(route: Route | null, progress: NavProgress | null, stops: Place[]): ({ m: number; s: number } | null)[] {
  if (!route) return stops.map(() => null)
  const alongM = progress?.alongM ?? 0
  const doneS = route.totalS - (progress?.remainingS ?? route.totalS)
  return stops.map((stop) => {
    const planned = routeStop(route, stop)
    if (!planned) return null
    return { m: Math.max(0, planned.atM - alongM), s: Math.max(0, timeToManeuver(route, planned.maneuverIndex) - doneS) }
  })
}

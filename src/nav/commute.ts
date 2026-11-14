/**
 * The commute card: opened at Home with Work saved (or at Work with Home saved), Mapic
 * offers the trip to the other one, with its time in today's traffic.
 */
import { distance } from '../lib/geo'
import type { Place } from '../types'

/** Within this distance of Home or Work counts as being there (a parking spot down the street included). */
export const AT_PLACE_M = 400

export interface Commute {
  /** Where the car is: home or work. */
  at: 'home' | 'work'
  /** Where to offer going. */
  to: Place
}

/** The trip to offer from where the car is, or null when it isn't at Home or Work (or the other isn't saved). */
export function commuteFrom(position: { lon: number; lat: number } | null, home: Place | null, work: Place | null): Commute | null {
  if (!position || !home || !work) return null
  const here: [number, number] = [position.lon, position.lat]
  const toHome = distance(here, [home.lon, home.lat])
  const toWork = distance(here, [work.lon, work.lat])
  // Home and Work right next to each other: nothing to offer.
  if (distance([home.lon, home.lat], [work.lon, work.lat]) < AT_PLACE_M * 2) return null
  if (toHome <= AT_PLACE_M && toHome <= toWork) return { at: 'home', to: work }
  if (toWork <= AT_PLACE_M) return { at: 'work', to: home }
  return null
}

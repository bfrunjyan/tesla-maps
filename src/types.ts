import type { LngLat } from './lib/geo'

export type PlaceCategory = 'address' | 'charging' | 'food' | 'attraction' | 'poi' | 'home' | 'work' | 'pin'

export interface Place {
  id: string
  name: string
  address: string
  lon: number
  lat: number
  category?: PlaceCategory
}

export interface Position {
  lon: number
  lat: number
  /** Degrees clockwise from north, or null when unknown (stationary). */
  heading: number | null
  /** m/s */
  speed: number
  accuracy: number
  ts: number
}

export interface Maneuver {
  type: number
  instruction: string
  verbalAlert?: string
  verbalPre?: string
  verbalPost?: string
  street: string
  /** Index into route.coords where the maneuver happens. */
  shapeIndex: number
  /** Distance from route start to the maneuver point, meters. */
  atM: number
  /** Length of the stretch that follows this maneuver, meters. */
  lengthM: number
  timeS: number
}

export interface Route {
  coords: LngLat[]
  /** Cumulative distance along coords, meters. */
  cum: number[]
  maneuvers: Maneuver[]
  totalM: number
  totalS: number
  lang: string
}

export interface NavProgress {
  /** Meters travelled along the route. */
  alongM: number
  /** Index of the segment the car is snapped to. */
  segIndex: number
  snapped: LngLat
  offRouteM: number
  nextIndex: number
  toNextM: number
  remainingM: number
  remainingS: number
}

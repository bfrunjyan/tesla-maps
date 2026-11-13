import type { Map as MLMap } from 'maplibre-gl'

let current: MLMap | null = null

export function setMap(map: MLMap | null) {
  current = map
}

export function getMap() {
  return current
}

export function mapCenter(): { lon: number; lat: number } | null {
  if (!current) return null
  const c = current.getCenter()
  return { lon: c.lng, lat: c.lat }
}

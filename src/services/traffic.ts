/**
 * Live traffic along a route, read from the same traffic tiles the map draws
 * (Mapbox Traffic v1). Swappable: anything that returns TrafficLine[] will do.
 * Coverage depends on the provider; where it has no data the route stays plain.
 */
import type { LngLat } from '../lib/geo'
import { trafficTileUrl } from '../map/style'
import { isCongestion, tilesForRoute, type TrafficLine } from '../nav/routeTraffic'

/** Route traffic is asked for with a tag that changes this often, so it is never older than that. */
const FRESH_MS = 120_000
const PARALLEL = 8

export const hasTraffic = () => !!trafficTileUrl()

/** Traffic lines in the tiles the route passes through, or null when traffic isn't available. */
export async function fetchTrafficAlong(coords: LngLat[], signal?: AbortSignal): Promise<TrafficLine[] | null> {
  const template = trafficTileUrl(FRESH_MS)
  if (!template || coords.length < 2) return null
  // The decoder is only needed once a route exists: keep it out of the first load.
  const [{ PbfReader }, { VectorTile }] = await Promise.all([import('pbf'), import('@mapbox/vector-tile')])
  const tiles = tilesForRoute(coords)
  const lines: TrafficLine[] = []
  let answered = 0

  async function load(t: { z: number; x: number; y: number }) {
    const url = template!.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
    const res = await fetch(url, { signal })
    if (!res.ok) return
    answered++
    const layer = new VectorTile(new PbfReader(await res.arrayBuffer())).layers.traffic
    if (!layer) return
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      const level = feature.properties.congestion
      if (!isCongestion(level)) continue
      const geometry = feature.toGeoJSON(t.x, t.y, t.z).geometry
      if (geometry.type === 'LineString') lines.push({ coords: geometry.coordinates as LngLat[], level })
      else if (geometry.type === 'MultiLineString') for (const part of geometry.coordinates) lines.push({ coords: part as LngLat[], level })
    }
  }

  for (let i = 0; i < tiles.length; i += PARALLEL) {
    await Promise.all(tiles.slice(i, i + PARALLEL).map((t) => load(t).catch(() => {})))
    if (signal?.aborted) return null
  }
  // Nothing answered at all (offline, key refused): unknown, not "no traffic".
  return answered ? lines : null
}

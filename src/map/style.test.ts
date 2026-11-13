import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayerSpecification } from 'maplibre-gl'
import { buildStyle, FREE_FLOW_CLASSES, TRAFFIC, trafficTileUrl } from './style'

const withTraffic = buildStyle({ theme: 'dark', satellite: false, trafficTiles: 'https://example.test/{z}/{x}/{y}.pbf' })
const layer = (id: string) => withTraffic.layers.find((l) => l.id === id) as LayerSpecification & { filter: unknown; paint: Record<string, unknown> }
const ids = withTraffic.layers.map((l) => l.id)

describe('traffic layers', () => {
  it('are absent without a token', () => {
    const plain = buildStyle({ theme: 'dark', satellite: false, trafficTiles: null })
    expect(plain.layers.some((l) => l.id.startsWith('traffic'))).toBe(false)
    expect(plain.sources.traffic).toBeUndefined()
  })

  it('draw free-flow green under slow traffic, both under the buildings', () => {
    expect(ids.indexOf('traffic-free')).toBeLessThan(ids.indexOf('traffic'))
    expect(ids.indexOf('traffic')).toBeLessThan(ids.indexOf('buildings'))
  })

  it('show free-flowing traffic only on main roads, in thin green', () => {
    const free = layer('traffic-free')
    expect(free.paint['line-color']).toBe(TRAFFIC.free)
    expect(JSON.stringify(free.filter)).toContain('"low"')
    for (const cls of ['primary', 'trunk', 'secondary']) expect(FREE_FLOW_CLASSES).toContain(cls)
    for (const cls of ['street', 'service']) expect(FREE_FLOW_CLASSES).not.toContain(cls)
  })

  it('show slow traffic on every road, thicker than free flow', () => {
    const slow = layer('traffic')
    expect(JSON.stringify(slow.filter)).toMatch(/moderate.*heavy.*severe/)
    expect(JSON.stringify(slow.filter)).not.toContain('class')
    const widthAt15 = (l: { paint: Record<string, unknown> }) => {
      const stops = (l.paint['line-width'] as unknown[]).slice(3) as number[]
      return stops[stops.indexOf(15) + 1]
    }
    expect(widthAt15(slow)).toBeGreaterThan(widthAt15(layer('traffic-free')))
  })

  it('start hidden (the traffic button turns them on)', () => {
    expect((layer('traffic') as { layout?: { visibility?: string } }).layout?.visibility).toBe('none')
    expect((layer('traffic-free') as { layout?: { visibility?: string } }).layout?.visibility).toBe('none')
  })
})

describe('trafficTileUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('is null without a token', () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', '')
    expect(trafficTileUrl()).toBeNull()
  })

  it('changes every 10 minutes, so a cached refusal can’t outlive a page load', () => {
    vi.stubEnv('VITE_MAPBOX_TOKEN', 'pk.test')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T14:00:00Z'))
    const a = trafficTileUrl()
    vi.setSystemTime(new Date('2026-11-13T14:05:00Z'))
    expect(trafficTileUrl()).toBe(a)
    vi.setSystemTime(new Date('2026-11-13T14:11:00Z'))
    expect(trafficTileUrl()).not.toBe(a)
    expect(a).toContain('access_token=pk.test')
  })
})

import { describe, expect, it } from 'vitest'
import { followZoom, NAV_ZOOM, STREET_ZOOM, TRAFFIC_ZOOM, zoomForTrafficToggle } from './camera'

describe('followZoom', () => {
  it('stays close while navigating, easing out with speed', () => {
    expect(followZoom({ navigating: true, speed: 0, showTraffic: true, current: 13 })).toBe(NAV_ZOOM)
    expect(followZoom({ navigating: true, speed: 30, showTraffic: false, current: 13 })).toBeCloseTo(NAV_ZOOM - 1.6)
  })

  it('keeps a wider view when traffic is on and not navigating', () => {
    expect(followZoom({ navigating: false, speed: 10, showTraffic: true, current: TRAFFIC_ZOOM })).toBe(TRAFFIC_ZOOM)
  })

  it('respects the driver’s own zoom with traffic on, within limits', () => {
    expect(followZoom({ navigating: false, speed: 0, showTraffic: true, current: 16 })).toBe(16)
    expect(followZoom({ navigating: false, speed: 0, showTraffic: true, current: 8 })).toBe(11)
  })

  it('never goes wider than street level with traffic off', () => {
    expect(followZoom({ navigating: false, speed: 0, showTraffic: false, current: 13 })).toBe(15.5)
    expect(followZoom({ navigating: false, speed: 0, showTraffic: false, current: 17 })).toBe(17)
  })
})

describe('zoomForTrafficToggle', () => {
  it('zooms out to see nearby jams when traffic turns on, back to street level when off', () => {
    expect(zoomForTrafficToggle(true)).toBe(TRAFFIC_ZOOM)
    expect(zoomForTrafficToggle(false)).toBe(STREET_ZOOM)
    expect(TRAFFIC_ZOOM).toBeLessThan(STREET_ZOOM)
  })
})

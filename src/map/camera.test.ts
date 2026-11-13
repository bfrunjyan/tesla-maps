import { describe, expect, it } from 'vitest'
import { followZoom, NAV_ZOOM, STREET_ZOOM } from './camera'

describe('followZoom', () => {
  it('stays close while navigating, easing out with speed', () => {
    expect(followZoom({ navigating: true, speed: 0, current: 13 })).toBe(NAV_ZOOM)
    expect(followZoom({ navigating: true, speed: 30, current: 13 })).toBeCloseTo(NAV_ZOOM - 1.6)
  })

  it('keeps the driver’s zoom when not navigating, never wider than street level', () => {
    expect(followZoom({ navigating: false, speed: 0, current: 17 })).toBe(17)
    expect(followZoom({ navigating: false, speed: 0, current: 13 })).toBe(STREET_ZOOM)
  })
})

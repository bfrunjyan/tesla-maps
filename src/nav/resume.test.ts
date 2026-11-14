import { describe, expect, it } from 'vitest'
import { ALREADY_THERE_M, RESUME_WITHIN_MS, shouldResume, type SavedTrip } from './resume'

const dest = { id: 'd', name: 'Zvartnots Airport', address: '', lon: 44.3959, lat: 40.1473 }
const stop = { id: 's', name: 'Cascade', address: '', lon: 44.5157, lat: 40.1912 }
const now = Date.UTC(2026, 10, 14, 13, 0)
const trip = (at: number, stops = [stop, dest]): SavedTrip => ({ stops, preference: 'fastest', at })
const republicSquare = { lon: 44.5126, lat: 40.1777 }

describe('picking a trip back up', () => {
  it('carries on a trip cut short a few minutes ago', () => {
    expect(shouldResume(trip(now - 3 * 60_000), now, republicSquare)).toBe(true)
    expect(shouldResume(trip(now - 3 * 60_000), now, null)).toBe(true) // no GPS fix yet
  })

  it('lets an old trip go: that is a new drive, not a crash', () => {
    expect(shouldResume(trip(now - RESUME_WITHIN_MS - 1), now, republicSquare)).toBe(false)
  })

  it('does nothing once the car is at the destination', () => {
    const atDest = { lon: dest.lon + 0.0005, lat: dest.lat } // ~40 m away
    expect(ALREADY_THERE_M).toBeGreaterThan(40)
    expect(shouldResume(trip(now - 60_000), now, atDest)).toBe(false)
  })

  it('ignores nothing saved, broken data, or a clock that went backwards', () => {
    expect(shouldResume(null, now, republicSquare)).toBe(false)
    expect(shouldResume({ stops: [], preference: 'fastest', at: now }, now, republicSquare)).toBe(false)
    expect(shouldResume({ stops: [dest] } as unknown as SavedTrip, now, republicSquare)).toBe(false)
    expect(shouldResume(trip(now + 10 * 60_000), now, republicSquare)).toBe(false)
  })
})

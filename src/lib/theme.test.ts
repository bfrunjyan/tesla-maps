import { describe, expect, it } from 'vitest'
import { sunTimes } from './theme'

describe('sunTimes (Auto appearance)', () => {
  it('matches Yerevan on 13 November 2026 within a few minutes', () => {
    const t = sunTimes(new Date('2026-11-13T10:00:00Z'), 40.1777, 44.5126)!
    // Published: sunrise ~07:46, sunset ~17:49 local (UTC+4).
    expect(Math.abs(t.sunrise.getTime() - Date.parse('2026-11-13T03:46:00Z'))).toBeLessThan(5 * 60_000)
    expect(Math.abs(t.sunset.getTime() - Date.parse('2026-11-13T13:49:00Z'))).toBeLessThan(5 * 60_000)
  })

  it('returns null where the sun does not set (polar summer)', () => {
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6)).toBeNull()
  })
})

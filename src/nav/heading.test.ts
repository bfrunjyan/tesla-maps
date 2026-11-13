import { describe, expect, it } from 'vitest'
import { angleDiff, rawHeading, smoothHeading, type HeadingInput } from './heading'

/** Deterministic pseudo-random noise, so the tests never flake. */
function noise(seed: number) {
  let s = seed
  return (amp: number) => {
    s = (s * 16807) % 2147483647
    return ((s / 2147483647) * 2 - 1) * amp
  }
}

const moving = (over: Partial<HeadingInput> = {}): HeadingInput => ({
  gpsHeading: 90,
  speed: 11,
  moved: 11,
  movedBearing: 90,
  accuracy: 8,
  routeBearing: null,
  ...over,
})

function drive(inputs: HeadingInput[], start: number | null = null) {
  let h = start
  const out: number[] = []
  for (const i of inputs) {
    h = smoothHeading(h, rawHeading(i), i.speed)
    out.push(h!)
  }
  return out
}

describe('angleDiff', () => {
  it('takes the short way round', () => {
    expect(angleDiff(350, 10)).toBe(20)
    expect(angleDiff(10, 350)).toBe(-20)
    expect(angleDiff(0, 180)).toBe(-180)
  })
})

describe('rawHeading', () => {
  it('freezes when the car is stopped', () => {
    expect(rawHeading(moving({ speed: 0.2, moved: 1, gpsHeading: 250 }))).toBeNull()
  })

  it('prefers the road direction while on the route', () => {
    expect(rawHeading(moving({ gpsHeading: 120, routeBearing: 45 }))).toBe(45)
  })

  it('ignores GPS heading below walking pace and uses actual movement instead', () => {
    expect(rawHeading(moving({ speed: 1, gpsHeading: 300, moved: 6, movedBearing: 180 }))).toBe(180)
  })

  it('waits until the car has moved beyond the position noise', () => {
    expect(rawHeading(moving({ speed: 1, gpsHeading: null, moved: 2, movedBearing: 10, accuracy: 20 }))).toBeNull()
  })
})

describe('smoothHeading', () => {
  it('cuts ±15° GPS noise to a few degrees on a straight road', () => {
    const n = noise(7)
    const out = drive(Array.from({ length: 40 }, () => moving({ gpsHeading: 90 + n(15) })), 90)
    const avgError = out.reduce((s, h) => s + Math.abs(angleDiff(90, h)), 0) / out.length
    expect(avgError).toBeLessThan(6)
  })

  it('does not spin at a red light', () => {
    const n = noise(3)
    const stops = Array.from({ length: 20 }, () => moving({ speed: Math.abs(n(0.3)), moved: Math.abs(n(1.5)), gpsHeading: 180 + n(180), movedBearing: 180 + n(180) }))
    expect(new Set(drive(stops, 90))).toEqual(new Set([90]))
  })

  it('does not flip when stopped at a corner on the route (snap jitters between segments)', () => {
    const jitter = Array.from({ length: 12 }, (_, i) => moving({ speed: 0.1, moved: 0.8, routeBearing: i % 2 ? 0 : 90 }))
    expect(new Set(drive(jitter, 90))).toEqual(new Set([90]))
  })

  it('follows a real 90° turn within one update', () => {
    const out = drive([moving({ gpsHeading: 90 }), moving({ gpsHeading: 0, movedBearing: 0 })], 90)
    expect(Math.abs(angleDiff(0, out[1]))).toBeLessThan(15)
  })

  it('wraps correctly across north', () => {
    const out = drive([moving({ gpsHeading: 350 }), moving({ gpsHeading: 10 })], 350)
    expect(Math.abs(angleDiff(0, out[1]))).toBeLessThan(10)
  })
})

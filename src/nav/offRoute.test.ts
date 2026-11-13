import { describe, expect, it } from 'vitest'
import { courseOf, createOffRouteDetector, farLimit, maxAheadM, nearLimit, type OffRouteFix } from './offRoute'

/** Route heads north (0°). A fix every second unless said otherwise. */
const fix = (over: Partial<OffRouteFix> & { t: number }): OffRouteFix => ({
  ts: over.t * 1000, offRouteM: 0, accuracy: 10, speed: 10, course: 0, routeBearing: 0, ...over,
})
/** Feeds fixes in order and returns what the detector said for each. */
const run = (fixes: OffRouteFix[]) => {
  const d = createOffRouteDetector()
  return fixes.map((f) => d.check(f))
}

describe('limits', () => {
  it('allow for GPS error, up to a limit', () => {
    expect([farLimit(0), farLimit(10), farLimit(200)]).toEqual([35, 45, 65])
    expect([nearLimit(0), nearLimit(10), nearLimit(200)]).toEqual([15, 20, 30])
  })
})

describe('staying on the route', () => {
  it('says nothing while the car follows the road', () => {
    expect(run([0, 1, 2, 3, 4, 5].map((t) => fix({ t, offRouteM: 4 })))).toEqual(Array(6).fill(null))
  })

  it('tolerates GPS drift to the side on a wide road', () => {
    // 28 m off but still driving the road's direction: not a turn, not far.
    expect(run([0, 1, 2, 3, 4, 5, 6].map((t) => fix({ t, offRouteM: 28, accuracy: 20, course: 6 })))).toEqual(Array(7).fill(null))
  })

  it('ignores a single wild fix', () => {
    expect(run([fix({ t: 0 }), fix({ t: 1, offRouteM: 300, course: 90 }), fix({ t: 2 }), fix({ t: 3 })])).toEqual([null, null, null, null])
  })

  it('does not mistake a stop at a junction for a turn', () => {
    // Standing still 25 m from the line with a meaningless heading.
    expect(run([0, 1, 2, 3, 4].map((t) => fix({ t, offRouteM: 25, speed: 0, course: null })))).toEqual(Array(5).fill(null))
  })
})

describe('turning off the route', () => {
  it('notices within two fixes when the car takes another street', () => {
    // Left turn at 40 km/h: 11 m further from the route every second, heading west.
    const said = run([fix({ t: 0 }), fix({ t: 1, offRouteM: 12, course: 270 }), fix({ t: 2, offRouteM: 23, course: 270 }), fix({ t: 3, offRouteM: 34, course: 270 })])
    expect(said).toEqual([null, null, null, 'left-route'])
  })

  it('notices a gentle fork too', () => {
    const said = run([fix({ t: 0, offRouteM: 22, course: 40 }), fix({ t: 1, offRouteM: 29, course: 40 })])
    expect(said).toEqual([null, 'left-route'])
  })

  it('needs more than one fix', () => {
    expect(run([fix({ t: 0, offRouteM: 40, course: 270 })])).toEqual([null])
  })

  it('still works when fixes arrive only every 5 seconds', () => {
    const said = run([fix({ t: 0 }), fix({ t: 5, offRouteM: 55, course: 270 }), fix({ t: 10, offRouteM: 110, course: 270 })])
    expect(said).toEqual([null, null, 'left-route'])
  })
})

describe('far from the route', () => {
  it('notices a street one block over, even heading the same way', () => {
    // Parallel street 70 m away, same direction as the route.
    const said = run([0, 1, 2].map((t) => fix({ t, offRouteM: 70, course: 0 })))
    expect(said).toEqual([null, null, 'left-route'])
  })

  it('notices without any direction at all', () => {
    const said = run([0, 1, 2].map((t) => fix({ t, offRouteM: 90, course: null, routeBearing: null })))
    expect(said).toEqual([null, null, 'left-route'])
  })

  it('needs less distance when GPS is accurate, more when it is poor', () => {
    const at50 = (accuracy: number) => run([0, 1, 2].map((t) => fix({ t, offRouteM: 50, accuracy })))[2]
    expect(at50(5)).toBe('left-route')
    expect(at50(30)).toBeNull()
  })

  it('starts counting again after the car is back on the road', () => {
    const said = run([fix({ t: 0, offRouteM: 70 }), fix({ t: 1, offRouteM: 70 }), fix({ t: 2, offRouteM: 3 }), fix({ t: 3, offRouteM: 70 }), fix({ t: 4, offRouteM: 70 })])
    expect(said).toEqual([null, null, null, null, null])
  })
})

describe('driving the route backwards', () => {
  it('notices after a few seconds', () => {
    const said = run([0, 1, 2, 3, 4].map((t) => fix({ t, offRouteM: 5, course: 180 })))
    expect(said).toEqual([null, null, null, null, 'wrong-way'])
  })

  it('ignores a moment of reversed heading, and slow manoeuvring', () => {
    expect(run([fix({ t: 0, course: 180 }), fix({ t: 1, course: 180 }), fix({ t: 2 }), fix({ t: 3 }), fix({ t: 4 })])).toEqual(Array(5).fill(null))
    expect(run([0, 1, 2, 3, 4, 5].map((t) => fix({ t, course: 180, speed: 1.5 })))).toEqual(Array(6).fill(null))
  })
})

describe('after a new route', () => {
  it('starts fresh once it has spoken', () => {
    const d = createOffRouteDetector()
    const off = (t: number) => fix({ t, offRouteM: 70 })
    expect([d.check(off(0)), d.check(off(1)), d.check(off(2))]).toEqual([null, null, 'left-route'])
    expect(d.check(off(3))).toBeNull()
  })
})

describe('the direction the car is moving', () => {
  it('uses the GPS course while moving', () => {
    expect(courseOf({ gpsHeading: 87, speed: 8, moved: 8, movedBearing: 120, accuracy: 10 })).toBe(87)
  })
  it('falls back to the direction actually travelled', () => {
    expect(courseOf({ gpsHeading: null, speed: 8, moved: 8, movedBearing: 120, accuracy: 10 })).toBe(120)
    expect(courseOf({ gpsHeading: NaN, speed: 8, moved: 8, movedBearing: 120, accuracy: 10 })).toBe(120)
  })
  it('is unknown when the car has barely moved', () => {
    expect(courseOf({ gpsHeading: 87, speed: 0.3, moved: 1, movedBearing: 120, accuracy: 10 })).toBeNull()
    expect(courseOf({ gpsHeading: null, speed: 3, moved: 6, movedBearing: 120, accuracy: 40 })).toBeNull()
  })
})

describe('how far ahead the car may be matched', () => {
  it('is at least 150 m, and grows with speed and with gaps between fixes', () => {
    expect(maxAheadM(0, 1000, 10)).toBe(150)
    expect(maxAheadM(14, 1000, 10)).toBe(150)
    expect(maxAheadM(30, 10_000, 10)).toBe(770)
    expect(maxAheadM(25, 600_000, 0)).toBe(33 * 120 * 2)
  })
})

import { describe, expect, it } from 'vitest'
import { NAV_ZOOM, STREET_ZOOM, TURN_ZOOM, approachWindow, createNavZoom, cruiseZoom, followZoom, turnClass, type NavZoomInput } from './camera'

const ROUTE = {}
const KMH = (v: number) => v / 3.6
const RIGHT = 10
const UTURN = 13
const CONTINUE = 8
const EXIT_RIGHT = 20
const DESTINATION = 4

/** Approaching maneuver `type`, `toM` metres ahead, with nothing notable behind. */
const ahead = (type: number, toM: number, speed: number, index = 3): NavZoomInput => ({
  route: ROUTE, speed, onRoute: true, next: { index, type, toM }, prev: { type: CONTINUE, pastM: 900 },
})
/** Just past maneuver `type`, the next one far away. */
const behind = (type: number, pastM: number, speed: number): NavZoomInput => ({
  route: ROUTE, speed, onRoute: true, next: { index: 4, type: CONTINUE, toM: 2000 }, prev: { type, pastM },
})

describe('followZoom', () => {
  it('eases out with speed while navigating', () => {
    expect(followZoom({ navigating: true, speed: 0, current: 13 })).toBe(NAV_ZOOM)
    expect(followZoom({ navigating: true, speed: 30, current: 13 })).toBeCloseTo(NAV_ZOOM - 1.7)
  })

  it('keeps the driver’s zoom when not navigating, never wider than street level', () => {
    expect(followZoom({ navigating: false, speed: 0, current: 17 })).toBe(17)
    expect(followZoom({ navigating: false, speed: 0, current: 13 })).toBe(STREET_ZOOM)
  })
})

describe('which maneuvers pull the camera in', () => {
  it('turns, roundabouts, U-turns, forks and arriving do; carrying on does not', () => {
    expect([10, 15, 11, 14, 26, 27].map(turnClass)).toEqual(Array(6).fill('turn'))
    expect([12, 13].map(turnClass)).toEqual(['uturn', 'uturn'])
    expect([9, 16, 18, 19, 20, 21, 23, 24, 25].map(turnClass)).toEqual(Array(9).fill('fork'))
    expect([4, 5, 6].map(turnClass)).toEqual(Array(3).fill('arrive'))
    expect([0, 1, 7, 8, 22, 28].map(turnClass)).toEqual(Array(6).fill('none'))
  })
})

describe('zooming in for a turn', () => {
  it('stays at cruising zoom while the turn is far away', () => {
    const speed = KMH(50)
    expect(createNavZoom()(ahead(RIGHT, 1200, speed))).toBe(cruiseZoom(speed))
  })

  it('zooms in steadily on the approach and is fully in before the turn', () => {
    const speed = KMH(50)
    const zoom = createNavZoom()
    const { startM, fullM } = approachWindow(speed)
    const steps = [startM + 50, startM - 20, (startM + fullM) / 2, fullM + 10, fullM, 20, 0].map((toM) => zoom(ahead(RIGHT, toM, speed)))
    expect(steps[0]).toBe(cruiseZoom(speed))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1])
    expect(steps[2]).toBeGreaterThan(cruiseZoom(speed) + 0.4)
    expect(steps[4]).toBeCloseTo(TURN_ZOOM.turn)
    expect(steps[6]).toBeCloseTo(TURN_ZOOM.turn)
  })

  it('starts earlier on fast roads: about 14 seconds before the turn', () => {
    expect(approachWindow(KMH(30)).startM).toBe(180)
    expect(approachWindow(KMH(90)).startM).toBeCloseTo(350)
    expect(approachWindow(KMH(250)).startM).toBe(700)
    const zoom = createNavZoom()
    expect(zoom(ahead(EXIT_RIGHT, 300, KMH(90)))).toBeGreaterThan(cruiseZoom(KMH(90)))
    expect(createNavZoom()(ahead(RIGHT, 300, KMH(30)))).toBe(cruiseZoom(KMH(30)))
  })

  it('does not zoom back out when the car brakes on the approach', () => {
    const zoom = createNavZoom()
    const before = zoom(ahead(RIGHT, 200, KMH(70)))
    expect(before).toBeGreaterThan(cruiseZoom(KMH(70)) + 0.3)
    // Braking hard: at 20 km/h the window would only start at 180 m.
    expect(zoom(ahead(RIGHT, 190, KMH(20)))).toBeGreaterThanOrEqual(before)
  })

  it('comes in closest for a U-turn', () => {
    expect(createNavZoom()(ahead(UTURN, 10, KMH(15)))).toBeCloseTo(TURN_ZOOM.uturn)
    expect(TURN_ZOOM.uturn).toBeGreaterThan(TURN_ZOOM.turn)
  })

  it('zooms in less for an exit or a fork than for a turn', () => {
    const exit = createNavZoom()(ahead(EXIT_RIGHT, 50, KMH(90)))
    expect(exit).toBeCloseTo(TURN_ZOOM.fork)
    expect(exit).toBeGreaterThan(cruiseZoom(KMH(90)) + 1)
    expect(exit).toBeLessThan(TURN_ZOOM.turn)
  })

  it('zooms in on the destination when arriving', () => {
    expect(createNavZoom()(ahead(DESTINATION, 30, KMH(20)))).toBeCloseTo(TURN_ZOOM.arrive)
  })

  it('ignores maneuvers that are not turns', () => {
    expect(createNavZoom()(ahead(CONTINUE, 20, KMH(50)))).toBe(cruiseZoom(KMH(50)))
  })

  it('never zooms out for a maneuver: a fork at walking pace keeps the cruising zoom', () => {
    expect(createNavZoom()(ahead(EXIT_RIGHT, 10, 0))).toBe(cruiseZoom(0))
  })
})

describe('zooming out after a turn', () => {
  it('holds the close view through the turn, then eases out', () => {
    const speed = KMH(25)
    const zoom = createNavZoom()
    const steps = [0, 15, 30, 60, 100, 130, 200].map((pastM) => zoom(behind(RIGHT, pastM, speed)))
    expect(steps[0]).toBeCloseTo(TURN_ZOOM.turn)
    expect(steps[2]).toBeCloseTo(TURN_ZOOM.turn)
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1])
    expect(steps[3]).toBeLessThan(TURN_ZOOM.turn)
    expect(steps[3]).toBeGreaterThan(cruiseZoom(speed))
    expect(steps[5]).toBeCloseTo(cruiseZoom(speed))
    expect(steps[6]).toBe(cruiseZoom(speed))
  })

  it('does the same after a U-turn', () => {
    const zoom = createNavZoom()
    expect(zoom(behind(UTURN, 10, KMH(15)))).toBeCloseTo(TURN_ZOOM.uturn)
    expect(zoom(behind(UTURN, 300, KMH(40)))).toBe(cruiseZoom(KMH(40)))
  })

  it('passes the turn without a jump', () => {
    const speed = KMH(20)
    const zoom = createNavZoom()
    const justBefore = zoom(ahead(RIGHT, 2, speed, 3))
    const justAfter = zoom({ route: ROUTE, speed, onRoute: true, next: { index: 4, type: CONTINUE, toM: 800 }, prev: { type: RIGHT, pastM: 3 } })
    expect(justAfter).toBeCloseTo(justBefore)
  })

  it('stays in when the next turn follows straight away', () => {
    const speed = KMH(30)
    const zoom = createNavZoom()
    const z = zoom({ route: ROUTE, speed, onRoute: true, next: { index: 4, type: RIGHT, toM: 90 }, prev: { type: 15, pastM: 110 } })
    expect(z).toBeGreaterThan(cruiseZoom(speed) + 0.3)
  })
})

describe('rerouting', () => {
  it('uses the cruising zoom while off the route', () => {
    expect(createNavZoom()({ ...ahead(RIGHT, 20, KMH(30)), onRoute: false })).toBe(cruiseZoom(KMH(30)))
  })

  it('forgets the old turn when a new route arrives', () => {
    const zoom = createNavZoom()
    zoom(ahead(RIGHT, 20, KMH(30), 3))
    // New route: maneuver 3 is now a turn far ahead.
    expect(zoom({ ...ahead(RIGHT, 900, KMH(30), 3), route: {} })).toBe(cruiseZoom(KMH(30)))
  })
})

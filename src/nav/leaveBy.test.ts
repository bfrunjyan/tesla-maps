import { describe, expect, it } from 'vitest'
import { defaultArrival, leaveByFor, stepArrival } from './leaveBy'

const at = (h: number, m: number) => new Date(2026, 10, 16, h, m).getTime()

describe('leave by', () => {
  it('works back from the arrival time with the traffic expected then', async () => {
    // 20 min now; 30 min in the 8:30 rush.
    const travel = async (depart: Date) => (depart.getHours() === 8 && depart.getMinutes() >= 20 ? 30 * 60 : 20 * 60)
    const r = await leaveByFor(new Date(at(9, 0)), 20 * 60, travel, at(7, 0))
    expect(r.lateMin).toBe(0)
    expect(r.travelS).toBe(30 * 60)
    expect(r.departAt.getHours()).toBe(8)
    expect(r.departAt.getMinutes()).toBe(30)
  })

  it('asks at most twice (each forecast is billed)', async () => {
    let asked = 0
    await leaveByFor(new Date(at(9, 0)), 1200, async () => (asked++, 1500), at(7, 0))
    expect(asked).toBe(2)
  })

  it('says how late when leaving now is already too late', async () => {
    const r = await leaveByFor(new Date(at(9, 0)), 40 * 60, async () => 40 * 60, at(8, 35))
    expect(r.lateMin).toBe(15)
    expect(r.departAt.getTime()).toBe(at(8, 35))
  })

  it('rounds the departure down to the minute', async () => {
    const r = await leaveByFor(new Date(at(9, 0)), 1000, async () => 1000, at(7, 0)) // 16 min 40 s
    expect(r.departAt.getHours()).toBe(8)
    expect(r.departAt.getMinutes()).toBe(43)
    expect(r.departAt.getSeconds()).toBe(0)
  })
})

describe('the arrival time picker', () => {
  it('starts at the next quarter hour after today’s drive plus 15 minutes', () => {
    const d = defaultArrival(at(8, 2), 20 * 60) // 8:02 + 20 + 15 = 8:37 → 8:45
    expect([d.getHours(), d.getMinutes()]).toEqual([8, 45])
  })

  it('steps in quarter hours and never into the past', () => {
    expect(stepArrival(new Date(at(9, 0)), 1, at(8, 0)).getMinutes()).toBe(15)
    expect(stepArrival(new Date(at(8, 15)), -2, at(8, 5)).getTime()).toBe(at(8, 15))
  })
})

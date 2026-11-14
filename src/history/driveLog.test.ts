import { describe, expect, it } from 'vitest'
import { addDays, addDriving, countsAsDriving, fillPeriod, KEEP_DAYS, localDay, periodFor, pruneDays, shiftAnchor, sumTotals, weekStart, whPerKm, type Days } from './driveLog'

const fix = (ts: number, speed = 12, accuracy = 5) => ({ ts, speed, accuracy })

describe('what counts as driving', () => {
  it('counts a normal second of driving', () => {
    expect(countsAsDriving(fix(0), fix(1000), 12)).toBe(true)
  })

  it('ignores a parked car whose GPS position drifts', () => {
    // The browser reports no speed; the position wanders by less than its own error.
    expect(countsAsDriving(fix(0, 0, 8), fix(1000, 0, 8), 4)).toBe(false)
    // It reports standing still.
    expect(countsAsDriving(fix(0, 0.3), fix(1000, 0.3), 3)).toBe(false)
  })

  it('counts driving even when the browser reports no speed', () => {
    expect(countsAsDriving(fix(0, 0, 6), fix(1000, 0, 6), 13)).toBe(true)
  })

  it('counts sparse fixes and the car’s rougher GPS', () => {
    // A browser that sends a fix every 20 seconds, 220 m apart.
    expect(countsAsDriving(fix(0), fix(20_000), 220)).toBe(true)
    // Between buildings the car reports 80 m accuracy.
    expect(countsAsDriving(fix(0, 12, 80), fix(1000, 12, 80), 12)).toBe(true)
  })

  it('ignores GPS jumps, gaps and poor fixes', () => {
    expect(countsAsDriving(fix(0), fix(1000), 400)).toBe(false) // 1,440 km/h
    expect(countsAsDriving(fix(0), fix(60_000), 600)).toBe(false) // a minute in a tunnel
    expect(countsAsDriving(fix(0), fix(1000, 12, 120), 12)).toBe(false)
    expect(countsAsDriving(fix(1000), fix(1000), 12)).toBe(false)
  })
})

describe('the daily log', () => {
  it('adds driving to the local day it happened on', () => {
    const days: Days = {}
    const morning = new Date(2026, 10, 14, 8, 30).getTime()
    addDriving(days, morning, { metres: 1000, wh: 150, seconds: 80 })
    addDriving(days, morning + 60_000, { metres: 500, wh: 70, seconds: 40 })
    addDriving(days, new Date(2026, 10, 15, 0, 5).getTime(), { metres: 200, wh: 30, seconds: 20 })
    expect(days).toEqual({
      '2026-11-14': { metres: 1500, wh: 220, seconds: 120 },
      '2026-11-15': { metres: 200, wh: 30, seconds: 20 },
    })
  })

  it('drops days older than it keeps', () => {
    const today = '2026-11-14'
    const days: Days = { [addDays(today, -KEEP_DAYS - 1)]: { metres: 1, wh: 1, seconds: 1 }, [today]: { metres: 2, wh: 2, seconds: 2 } }
    expect(Object.keys(pruneDays(days, today))).toEqual([today])
  })
})

describe('dates', () => {
  it('starts weeks on Monday', () => {
    expect(weekStart('2026-11-14')).toBe('2026-11-09') // Saturday → Monday
    expect(weekStart('2026-11-09')).toBe('2026-11-09')
    expect(weekStart('2026-11-15')).toBe('2026-11-09') // Sunday
  })

  it('crosses months, years and daylight-saving changes cleanly', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('periods', () => {
  const today = '2026-11-14'

  it('shows the 7 days of the week, Monday first', () => {
    const p = periodFor('day', today, today)
    expect(p.buckets.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(p.title).toBe('9 – 15 Nov 2026')
    expect(p.buckets[5].current).toBe(true)
    expect(p.buckets[6].future).toBe(true)
    expect(p.buckets[5].full).toBe('Saturday 14 November')
  })

  it('shows 12 weeks ending with the anchor’s week', () => {
    const p = periodFor('week', today, today)
    expect(p.buckets).toHaveLength(12)
    expect(p.buckets[11].from).toBe('2026-11-09')
    expect(p.buckets[0].from).toBe('2026-08-24')
    expect(p.buckets[11].current).toBe(true)
    expect(p.title).toBe('24 Aug – 15 Nov 2026')
  })

  it('shows the 12 months of the year', () => {
    const p = periodFor('month', today, today)
    expect(p.buckets.map((b) => b.label)[0]).toBe('Jan')
    expect(p.buckets[1].to).toBe('2026-02-28')
    expect(p.buckets[10].current).toBe(true)
    expect(p.buckets[11].future).toBe(true)
    expect(p.title).toBe('2026')
  })

  it('names periods that cross a year', () => {
    expect(periodFor('day', '2026-12-30', today).title).toBe('28 Dec 2026 – 3 Jan 2027')
  })

  it('adds each day’s totals to its bucket', () => {
    const days = [
      { day: '2026-11-09', metres: 10_000, wh: 1500, seconds: 900 },
      { day: '2026-11-14', metres: 5000, wh: 800, seconds: 600 },
      { day: '2026-11-14', metres: 1000, wh: 100, seconds: 60 }, // another device
      { day: '2026-11-20', metres: 99_000, wh: 1, seconds: 1 }, // next week: not in this one
    ]
    const week = fillPeriod(periodFor('day', today, today), days)
    expect(week.buckets[0].metres).toBe(10_000)
    expect(week.buckets[5]).toMatchObject({ metres: 6000, wh: 900, seconds: 660 })
    expect(sumTotals(week.buckets).metres).toBe(16_000)
    const year = fillPeriod(periodFor('month', today, today), days)
    expect(year.buckets[10].metres).toBe(115_000)
  })

  it('moves back and forward by a whole period', () => {
    expect(shiftAnchor('day', today, -1)).toBe('2026-11-07')
    expect(shiftAnchor('week', today, -1)).toBe(addDays(today, -84))
    expect(shiftAnchor('month', today, 1)).toBe('2027-11-01')
  })
})

describe('consumption', () => {
  it('is energy per kilometre, once there is enough driving to say', () => {
    expect(whPerKm({ metres: 20_000, wh: 3000, seconds: 1 })).toBe(150)
    expect(whPerKm({ metres: 100, wh: 30, seconds: 1 })).toBeNull()
  })
})

describe('labels', () => {
  it('writes every month with three letters', () => {
    const today = '2026-11-14'
    expect(periodFor('month', today, today).buckets.map((b) => b.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    expect(periodFor('week', '2026-09-10', today).buckets.at(-1)!.label).toBe('7 Sep')
    expect(periodFor('day', '2026-09-10', today).title).toBe('7 – 13 Sep 2026')
  })
})

/**
 * Driving history, the pure part: what counts as driving between two GPS fixes, a log
 * of daily totals, and turning days into the periods the history screen shows (days of
 * a week, weeks, months of a year). Only totals per day are kept, never where the car went.
 */
export interface DayTotal {
  /** Local date, YYYY-MM-DD. */
  day: string
  metres: number
  wh: number
  seconds: number
}
export type Totals = Omit<DayTotal, 'day'>

/* ------------------------------------------------------------ dates */

const pad = (n: number) => String(n).padStart(2, '0')
/** The local calendar day of a moment, YYYY-MM-DD. */
export function localDay(at: Date | number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** A YYYY-MM-DD day as a local date at noon (noon keeps clear of daylight-saving jumps). */
export function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
export function addDays(day: string, n: number): string {
  const d = dateOf(day)
  d.setDate(d.getDate() + n)
  return localDay(d)
}
/** Monday of the week the day is in (weeks start on Monday). */
export function weekStart(day: string): string {
  const dow = (dateOf(day).getDay() + 6) % 7
  return addDays(day, -dow)
}

/* ------------------------------------------------------------ recording */

/**
 * Fixes further apart than this are a gap (tunnel, app in the background), not driving
 * time. Generous, as a car's browser may send its position only every few seconds.
 */
export const MAX_GAP_S = 30
/** Slower than walking pace is standing still or GPS drift. */
export const MIN_SPEED_MPS = 1.5
/** Faster than 250 km/h is a GPS jump. */
export const MAX_SPEED_MPS = 70
/** Fixes vaguer than this are skipped (the car's browser may report a wide margin even when on track). */
const MAX_ACCURACY_M = 100

export interface Fix {
  ts: number
  /** Speed the GPS reported (m/s); 0 when it doesn't report one. */
  speed: number
  accuracy: number
}

/**
 * Whether the car really drove `movedM` between two fixes: recent fixes, a believable
 * speed, and (when the browser reports no speed) a move bigger than the GPS's own error,
 * so a parked car's drifting position doesn't add kilometres.
 */
export function countsAsDriving(prev: Fix, next: Fix, movedM: number): boolean {
  const dt = (next.ts - prev.ts) / 1000
  if (dt <= 0 || dt > MAX_GAP_S) return false
  if (next.accuracy > MAX_ACCURACY_M) return false
  const derived = movedM / dt
  if (derived > MAX_SPEED_MPS) return false
  if (next.speed > 0) return next.speed >= MIN_SPEED_MPS && derived >= MIN_SPEED_MPS / 2
  return derived >= MIN_SPEED_MPS && movedM > next.accuracy
}

export type Days = Record<string, Totals>

/** Adds a stretch of driving to its day. Returns the day it went to. */
export function addDriving(days: Days, at: number, add: Totals): string {
  const day = localDay(at)
  const t = (days[day] ??= { metres: 0, wh: 0, seconds: 0 })
  t.metres += add.metres
  t.wh += add.wh
  t.seconds += add.seconds
  return day
}

/** Days older than this are dropped from the device (the account keeps them). */
export const KEEP_DAYS = 400
export function pruneDays(days: Days, today: string): Days {
  const oldest = addDays(today, -KEEP_DAYS)
  return Object.fromEntries(Object.entries(days).filter(([d]) => d >= oldest))
}

/* ------------------------------------------------------------ periods */

export type Granularity = 'day' | 'week' | 'month'

export interface Bucket extends Totals {
  /** First and last day it covers. */
  from: string
  to: string
  /** Under the bar ("Mon", "17 Nov", "Jan") and in full ("Monday 17 November"). */
  label: string
  full: string
  /** Today, this week or this month. */
  current: boolean
  /** Entirely after today: nothing could have been driven yet. */
  future: boolean
}

export interface Period {
  granularity: Granularity
  /** What the screen shows: "10 – 16 Nov 2026", "25 Aug – 16 Nov 2026", "2026". */
  title: string
  from: string
  to: string
  buckets: Bucket[]
}

const WEEKS_SHOWN = 12
const fmt = (day: string, o: Intl.DateTimeFormatOptions) => dateOf(day).toLocaleDateString('en-GB', o)
/** Three letters for every month: en-GB's own short form writes "Sept". */
const mon = (day: string) => fmt(day, { month: 'long' }).slice(0, 3)
/** "7 Sep", or "7 Sep 2026" with the year. */
const dayMonth = (day: string, withYear = false) => `${dateOf(day).getDate()} ${mon(day)}${withYear ? ` ${dateOf(day).getFullYear()}` : ''}`
function span(from: string, to: string): string {
  const a = dateOf(from)
  const b = dateOf(to)
  const year = b.getFullYear()
  if (a.getFullYear() !== year) return `${dayMonth(from, true)} – ${dayMonth(to, true)}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${dayMonth(to)} ${year}`
  return `${dayMonth(from)} – ${dayMonth(to)} ${year}`
}

/**
 * The period that contains `anchor`: the week's 7 days, the 12 weeks ending with the
 * anchor's week, or the year's 12 months. Totals are filled in by `fillPeriod`.
 */
export function periodFor(g: Granularity, anchor: string, today: string): Period {
  const empty = { metres: 0, wh: 0, seconds: 0 }
  const make = (from: string, to: string, label: string, full: string, current: boolean): Bucket => ({ ...empty, from, to, label, full, current, future: from > today })
  if (g === 'day') {
    const mon = weekStart(anchor)
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(mon, i)
      return make(d, d, fmt(d, { weekday: 'short' }), fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }), d === today)
    })
    return { granularity: g, title: span(mon, addDays(mon, 6)), from: mon, to: addDays(mon, 6), buckets }
  }
  if (g === 'week') {
    const lastMon = weekStart(anchor)
    const firstMon = addDays(lastMon, -7 * (WEEKS_SHOWN - 1))
    const thisWeek = weekStart(today)
    const buckets = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
      const from = addDays(firstMon, 7 * i)
      const to = addDays(from, 6)
      return make(from, to, dayMonth(from), `Week of ${span(from, to)}`, from === thisWeek)
    })
    return { granularity: g, title: span(firstMon, addDays(lastMon, 6)), from: firstMon, to: addDays(lastMon, 6), buckets }
  }
  const year = dateOf(anchor).getFullYear()
  const buckets = Array.from({ length: 12 }, (_, m) => {
    const from = `${year}-${pad(m + 1)}-01`
    const to = localDay(new Date(year, m + 1, 0, 12))
    return make(from, to, mon(from), fmt(from, { month: 'long', year: 'numeric' }), today >= from && today <= to)
  })
  return { granularity: g, title: String(year), from: `${year}-01-01`, to: `${year}-12-31`, buckets }
}

/** The period's buckets with the days' totals added in. */
export function fillPeriod(p: Period, days: DayTotal[]): Period {
  const buckets = p.buckets.map((b) => ({ ...b, metres: 0, wh: 0, seconds: 0 }))
  for (const d of days) {
    const b = buckets.find((x) => d.day >= x.from && d.day <= x.to)
    if (!b) continue
    b.metres += d.metres
    b.wh += d.wh
    b.seconds += d.seconds
  }
  return { ...p, buckets }
}

/** The anchor moved one period back (-1) or forward (+1). */
export function shiftAnchor(g: Granularity, anchor: string, dir: -1 | 1): string {
  if (g === 'day') return addDays(anchor, 7 * dir)
  if (g === 'week') return addDays(anchor, 7 * WEEKS_SHOWN * dir)
  const d = dateOf(anchor)
  return localDay(new Date(d.getFullYear() + dir, d.getMonth(), 1, 12))
}

export function sumTotals(list: Totals[]): Totals {
  return list.reduce((t, x) => ({ metres: t.metres + x.metres, wh: t.wh + x.wh, seconds: t.seconds + x.seconds }), { metres: 0, wh: 0, seconds: 0 })
}

/** Watt-hours per kilometre, or null with too little driving to say. */
export function whPerKm(t: Totals): number | null {
  return t.metres >= 500 ? t.wh / (t.metres / 1000) : null
}

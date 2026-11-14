/**
 * "Leave by" for an arrival time: when to set off so as to arrive on time, with the
 * traffic expected at that hour. Google can predict the driving time for a departure,
 * not for an arrival, so this works backwards: guess the departure from today's time,
 * ask for the time at that departure, and correct once more.
 */
export interface LeaveBy {
  /** When to leave. */
  departAt: Date
  /** The drive, as forecast for that departure (seconds). */
  travelS: number
  /** Leaving now already gets there late: by how many minutes. */
  lateMin: number
}

/** Rounded down to the minute: "leave by 8:41" means 8:41 at the latest. */
const floorMinute = (ms: number) => Math.floor(ms / 60_000) * 60_000

export async function leaveByFor(arriveAt: Date, nowTravelS: number, travelAt: (depart: Date) => Promise<number>, now = Date.now()): Promise<LeaveBy> {
  const arrive = arriveAt.getTime()
  let travelS = nowTravelS
  for (let i = 0; i < 2; i++) {
    const depart = Math.max(now, arrive - travelS * 1000)
    travelS = await travelAt(new Date(depart))
  }
  const departMs = arrive - travelS * 1000
  if (departMs <= now) {
    return { departAt: new Date(now), travelS, lateMin: Math.max(0, Math.ceil((now + travelS * 1000 - arrive) / 60_000)) }
  }
  return { departAt: new Date(floorMinute(departMs)), travelS, lateMin: 0 }
}

/** A sensible first arrival time to offer: today's drive plus 15 minutes, rounded up to the quarter hour. */
export function defaultArrival(now: number, travelS: number): Date {
  const quarter = 15 * 60_000
  return new Date(Math.ceil((now + travelS * 1000 + quarter) / quarter) * quarter)
}

/** Steps the arrival time by quarter hours, never into the past. */
export function stepArrival(arriveAt: Date, quarters: number, now: number): Date {
  const next = arriveAt.getTime() + quarters * 15 * 60_000
  return new Date(Math.max(next, Math.ceil(now / (15 * 60_000)) * 15 * 60_000))
}

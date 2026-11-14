import { Hono } from 'hono'
import { sql } from '../db.ts'
import { requireUser, type AppEnv } from '../lib/session.ts'

/**
 * Driving history: distance, energy and driving time per day. Devices send the running
 * totals of their own log (see migrations/005_drive_days.sql); reads add the logs up.
 */
export const drives = new Hono<AppEnv>()
drives.use('*', requireUser)

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Generous limits for one day: 2,500 km, 1 MWh, all 24 hours. */
const MAX = { metres: 2_500_000, wh: 1_000_000, seconds: 86_400 }
const MAX_DAYS_PER_SAVE = 400

const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const whole = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

drives.get('/', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  if (!isDay(from) || !isDay(to) || from > to) return c.json({ error: 'Give from and to as YYYY-MM-DD' }, 400)
  const rows = await sql<{ day: string; metres: number; wh: number; seconds: number }[]>`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(metres)::int AS metres, sum(wh)::int AS wh, sum(seconds)::int AS seconds
    FROM drive_days
    WHERE user_id = ${c.get('user')!.id} AND day BETWEEN ${from} AND ${to}
    GROUP BY day ORDER BY day`
  return c.json({ days: rows })
})

drives.put('/', async (c) => {
  const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const logId = b.logId
  const days = b.days
  if (typeof logId !== 'string' || !UUID.test(logId) || !Array.isArray(days) || days.length > MAX_DAYS_PER_SAVE) {
    return c.json({ error: 'Invalid driving history' }, 400)
  }
  // Not more than a day ahead of the server (time zones), nothing malformed.
  const tomorrow = new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10)
  for (const d of days as Record<string, unknown>[]) {
    if (!d || !isDay(d.day) || d.day > tomorrow || !whole(d.metres, MAX.metres) || !whole(d.wh, MAX.wh) || !whole(d.seconds, MAX.seconds)) {
      return c.json({ error: 'Invalid driving history' }, 400)
    }
  }
  const userId = c.get('user')!.id
  // A log's totals only grow, so an older request arriving late can't shrink a day.
  for (const d of days as { day: string; metres: number; wh: number; seconds: number }[]) {
    await sql`
      INSERT INTO drive_days (user_id, log_id, day, metres, wh, seconds)
      VALUES (${userId}, ${logId}, ${d.day}, ${d.metres}, ${d.wh}, ${d.seconds})
      ON CONFLICT (user_id, log_id, day) DO UPDATE SET
        metres = GREATEST(drive_days.metres, EXCLUDED.metres),
        wh = GREATEST(drive_days.wh, EXCLUDED.wh),
        seconds = GREATEST(drive_days.seconds, EXCLUDED.seconds),
        updated_at = now()`
  }
  return c.json({ ok: true })
})

import type { Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { config } from '../config.ts'

/**
 * In-memory fixed-window limiter. Fine for a single instance; move to
 * Postgres/Redis if the app is scaled to several instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>()

/** Tests only: start from empty limits. */
export function resetRateLimits() {
  buckets.clear()
}

export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  b.count++
  return b.count <= limit
}

setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}, 60_000).unref()

export function clientIp(c: Context): string {
  if (config.trustProxy) {
    const fwd = c.req.header('x-forwarded-for')
    if (fwd) return fwd.split(',')[0].trim()
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function tooMany(c: Context) {
  return c.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429)
}

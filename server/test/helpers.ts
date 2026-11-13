import { app } from '../app.ts'
import { config } from '../config.ts'
import { migrate, sql } from '../db.ts'
import { resetRateLimits } from '../lib/rateLimit.ts'

/** Wipes and re-creates the schema. Refuses to run on anything but a *_test database. */
export async function resetDatabase() {
  const name = new URL(config.databaseUrl).pathname.slice(1)
  if (!name.endsWith('_test')) throw new Error(`Refusing to reset non-test database "${name}"`)
  try {
    await sql`SELECT 1`
  } catch (err) {
    throw new Error(
      `Test database not reachable (${(err as { code?: string }).code ?? (err as Error).message}). Start it with:\n` +
        '  docker run -d --rm --name teslamaps-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=teslamaps -p 54340:5432 postgres:16\n' +
        '  docker exec teslamaps-db psql -U postgres -c "CREATE DATABASE teslamaps_test"',
    )
  }
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await migrate()
  resetRateLimits()
}

/** A browser-like client: keeps cookies, sends JSON with the app's Origin. */
export function client() {
  const jar = new Map<string, string>()
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(path, {
      method,
      headers: {
        Origin: config.appUrl,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const [k, v] = pair.split('=')
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a))
      if (expired || v === '') jar.delete(k.trim())
      else jar.set(k.trim(), v)
    }
    // Loosely typed on purpose: tests assert on the shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json().catch(() => null)) as any
    return { status: res.status, json, res }
  }
  return {
    jar,
    get: (path: string) => call('GET', path),
    post: (path: string, body: unknown = {}, headers?: Record<string, string>) => call('POST', path, body, headers),
    put: (path: string, body: unknown) => call('PUT', path, body),
    del: (path: string) => call('DELETE', path),
    raw: call,
  }
}

export const place = (id: string, name = id, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  address: `${name} street, Yerevan`,
  lon: 44.5 + Math.random() / 100,
  lat: 40.18 + Math.random() / 100,
  ...extra,
})

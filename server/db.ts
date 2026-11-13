import { readdir, readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { config } from './config.ts'

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  // Railway's internal Postgres URL is plain TCP; public URLs require TLS.
  ssl: /sslmode=require/.test(config.databaseUrl) ? 'require' : undefined,
  onnotice: () => {},
})

/** Apply server/migrations/*.sql in order, once each, inside a transaction. */
export async function migrate() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  const dir = new URL('./migrations/', import.meta.url)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name))
  for (const file of files) {
    if (applied.has(file)) continue
    const body = await readFile(new URL(file, dir), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
    })
    console.log(`[db] applied ${file}`)
  }
}

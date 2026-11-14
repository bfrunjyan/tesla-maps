/**
 * Records driving history on this device and keeps the account's copy up to date.
 *
 * Each device keeps a log of daily totals with its own id. Signed in, the log's
 * running totals are sent to the account now and then; the account adds up the logs
 * of all the driver's devices. Signing out, or another account signing in, starts a
 * fresh log, so one account's driving never lands in another's.
 */
import { load, save } from '../lib/storage'
import { api } from '../services/api'
import { addDriving, localDay, pruneDays, type DayTotal, type Days, type Totals } from './driveLog'

const KEY = 'driveLog'
const SAVE_EVERY_MS = 15_000
const SYNC_EVERY_MS = 120_000

interface Log {
  logId: string
  /** The account this log belongs to; null while no one is signed in. */
  owner: string | null
  days: Days
  /** Days changed since they were last sent to the account. */
  dirty: string[]
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
const fresh = (owner: string | null): Log => ({ logId: newId(), owner, days: {}, dirty: [] })

let log: Log = (() => {
  const stored = load<Log | null>(KEY, null)
  return stored?.logId && stored.days ? { ...stored, dirty: stored.dirty ?? [] } : fresh(null)
})()
let unsaved = false
let saveTimer: number | undefined

function persist() {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  if (!unsaved) return
  unsaved = false
  log.days = pruneDays(log.days, localDay(Date.now()))
  save(KEY, log)
}

/** Adds a stretch of driving that ended at `at`. Saved to the device within seconds. */
export function recordDriving(at: number, add: Totals) {
  const day = addDriving(log.days, at, add)
  if (!log.dirty.includes(day)) log.dirty.push(day)
  unsaved = true
  saveTimer ??= window.setTimeout(persist, SAVE_EVERY_MS)
}

/** This device's days, for showing history without an account. */
export function localDays(): DayTotal[] {
  return Object.entries(log.days)
    .map(([day, t]) => ({ day, ...t }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

const rounded = (day: string): DayTotal => {
  const t = log.days[day]
  return { day, metres: Math.round(t.metres), wh: Math.round(t.wh), seconds: Math.round(t.seconds) }
}

let syncing: Promise<void> | null = null
/** Sends the changed days to the account (signed in only). Safe to call often. */
export function syncDrives(): Promise<void> {
  if (!log.owner || !log.dirty.length) return syncing ?? Promise.resolve()
  syncing ??= (async () => {
    const sent = log.logId
    const days = log.dirty.filter((d) => log.days[d]).map((d) => rounded(d))
    try {
      await api.saveDrives(sent, days)
      if (log.logId !== sent) return // signed out meanwhile: that log is gone
      // A day driven on while it was being sent stays marked for the next time.
      const same = (d: string) => days.some((x) => x.day === d && JSON.stringify(x) === JSON.stringify(rounded(d)))
      log.dirty = log.dirty.filter((d) => !same(d))
      unsaved = true
      persist()
    } catch {
      /* offline: they go with the next sync */
    } finally {
      syncing = null
    }
  })()
  return syncing
}

/**
 * Signed in as `userId` (or signed out: null). A guest's log joins the account it signs
 * in to; a log that belongs to someone else is set aside and a fresh one started.
 */
export function setDriveOwner(userId: string | null) {
  if (log.owner === userId) return
  if (userId && !log.owner) {
    log.owner = userId
    log.dirty = Object.keys(log.days)
  } else {
    log = fresh(userId)
  }
  unsaved = true
  persist()
  if (userId) void syncDrives()
}

/**
 * The account's history between two days. This device's own log counts too, so driving
 * that hasn't reached the account yet (no connection, or the account refused it) still
 * shows: each day is at least what this device recorded.
 */
export async function fetchDays(from: string, to: string, signedIn: boolean): Promise<DayTotal[]> {
  const local = localDays().filter((d) => d.day >= from && d.day <= to)
  if (!signedIn) return local
  await syncDrives()
  const { days } = await api.drives(from, to)
  return atLeastLocal(days, local)
}

/** Each day's account total, raised to this device's own figures where those are higher. */
export function atLeastLocal(account: DayTotal[], local: DayTotal[]): DayTotal[] {
  const byDay = new Map(account.map((d) => [d.day, { ...d }]))
  for (const l of local) {
    const a = byDay.get(l.day)
    if (!a) byDay.set(l.day, { ...l, metres: Math.round(l.metres), wh: Math.round(l.wh), seconds: Math.round(l.seconds) })
    else if (l.metres > a.metres) byDay.set(l.day, { day: l.day, metres: Math.round(l.metres), wh: Math.max(a.wh, Math.round(l.wh)), seconds: Math.max(a.seconds, Math.round(l.seconds)) })
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/** Metres this device recorded today: shown in the history so a drive can be checked at once. */
export function recordedToday(): number {
  return log.days[localDay(Date.now())]?.metres ?? 0
}

let started = false
export function startDriveSync() {
  if (started) return
  started = true
  window.setInterval(() => void syncDrives(), SYNC_EVERY_MS)
  // Leaving the page or parking with the screen off: save now, send when possible.
  const flush = () => {
    persist()
    if (document.visibilityState === 'hidden') void syncDrives()
  }
  document.addEventListener('visibilitychange', flush)
  window.addEventListener('pagehide', flush)
}

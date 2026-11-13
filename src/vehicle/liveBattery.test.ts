import { describe, expect, it } from 'vitest'
import type { TeslaReading } from '../types'
import { READ_EVERY_MS, ago, duration, readingLine, shouldRead } from './liveBattery'

const base = { connected: true, visible: true, sinceLastMs: Infinity, moving: false, charging: false, navigating: false }
const MIN = 60_000

describe('when Mapic asks the car for its battery', () => {
  it('never asks when no Tesla is connected', () => {
    for (const event of ['open', 'route', 'visible', 'tick', 'manual'] as const) {
      expect(shouldRead({ ...base, event, connected: false, moving: true })).toBe(false)
    }
  })

  it('asks when the app opens and when the driver presses refresh', () => {
    expect(shouldRead({ ...base, event: 'open', sinceLastMs: 0 })).toBe(true)
    expect(shouldRead({ ...base, event: 'manual', sinceLastMs: 0, visible: false })).toBe(true)
  })

  it('asks when a route is planned, unless it asked in the last 2 minutes', () => {
    expect(shouldRead({ ...base, event: 'route', sinceLastMs: 3 * MIN })).toBe(true)
    expect(shouldRead({ ...base, event: 'route', sinceLastMs: 1 * MIN })).toBe(false)
  })

  it('checks every 10 minutes while driving, navigating or charging', () => {
    expect(shouldRead({ ...base, event: 'tick', sinceLastMs: READ_EVERY_MS, moving: true })).toBe(true)
    expect(shouldRead({ ...base, event: 'tick', sinceLastMs: READ_EVERY_MS, navigating: true })).toBe(true)
    expect(shouldRead({ ...base, event: 'tick', sinceLastMs: READ_EVERY_MS, charging: true })).toBe(true)
    expect(shouldRead({ ...base, event: 'tick', sinceLastMs: READ_EVERY_MS - 1, moving: true })).toBe(false)
  })

  it('leaves a parked, unplugged car alone', () => {
    expect(shouldRead({ ...base, event: 'tick', sinceLastMs: 5 * 3600_000 })).toBe(false)
  })

  it('does not ask while the page is hidden, and catches up when it is shown again', () => {
    expect(shouldRead({ ...base, event: 'tick', visible: false, moving: true })).toBe(false)
    expect(shouldRead({ ...base, event: 'visible', sinceLastMs: 11 * MIN })).toBe(true)
    expect(shouldRead({ ...base, event: 'visible', sinceLastMs: 4 * MIN })).toBe(false)
  })
})

describe('wording', () => {
  const reading = (over: Partial<TeslaReading>): TeslaReading => ({
    pct: 72, rangeKm: 324, charging: 'unplugged', minutesToFull: null, limitPct: 80, powerKw: null, at: '2026-11-14T10:00:00.000Z', live: true, ...over,
  })

  it('shows range alone when unplugged', () => {
    expect(readingLine(reading({}))).toBe('324 km range')
    expect(readingLine(reading({ charging: 'unknown', rangeKm: null }))).toBe('')
  })

  it('adds what the charger is doing', () => {
    expect(readingLine(reading({ charging: 'charging', minutesToFull: 35 }))).toBe('324 km range · Charging, 35 min to 80%')
    expect(readingLine(reading({ charging: 'charging', minutesToFull: 80, limitPct: null }))).toBe('324 km range · Charging, 1 h 20 min')
    expect(readingLine(reading({ charging: 'charging' }))).toBe('324 km range · Charging')
    expect(readingLine(reading({ charging: 'complete' }))).toBe('324 km range · Charging complete')
    expect(readingLine(reading({ charging: 'stopped' }))).toBe('324 km range · Plugged in, not charging')
  })

  it('words durations and ages plainly', () => {
    expect([0.4, 35, 60, 80, 120].map(duration)).toEqual(['1 min', '35 min', '1 h', '1 h 20 min', '2 h'])
    expect([30_000, 12 * MIN, 59 * MIN, 3 * 3600_000, 26 * 3600_000, 50 * 3600_000, -5].map(ago)).toEqual([
      'just now', '12 min ago', '59 min ago', '3 h ago', 'yesterday', '2 days ago', 'just now',
    ])
  })
})

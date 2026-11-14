import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/api', () => ({ api: { saveDrives: vi.fn(), drives: vi.fn() } }))
vi.stubGlobal('window', globalThis)

const { atLeastLocal } = await import('./recorder')

const day = (d: string, metres: number, wh = metres / 10, seconds = metres / 10) => ({ day: d, metres, wh, seconds })

describe('history shown while signed in', () => {
  it('shows the account’s days as they are when this car has nothing more', () => {
    const account = [day('2026-11-12', 5000), day('2026-11-13', 8000)]
    expect(atLeastLocal(account, [day('2026-11-13', 3000)])).toEqual(account)
  })

  it('shows a drive the account hasn’t received yet', () => {
    expect(atLeastLocal([day('2026-11-12', 5000)], [day('2026-11-14', 30_400.6, 4870.2, 2400.4)])).toEqual([
      day('2026-11-12', 5000),
      { day: '2026-11-14', metres: 30_401, wh: 4870, seconds: 2400 },
    ])
  })

  it('raises a day to what this car recorded when the account is behind', () => {
    expect(atLeastLocal([day('2026-11-14', 10_000, 1500, 900)], [day('2026-11-14', 30_000, 4500, 2400)])).toEqual([
      { day: '2026-11-14', metres: 30_000, wh: 4500, seconds: 2400 },
    ])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Driving with Mapic open records the distance, whatever the browser puts in a fix's
// timestamp. The car's browser was seen giving every fix the same timestamp, which
// made every second look like no time had passed, so a 30 km drive recorded nothing.
vi.mock('../services/routing', () => ({ fetchRoute: vi.fn(), fetchRouteOptions: vi.fn() }))
vi.mock('../services/search', () => ({ reverseGeocode: vi.fn(async () => null) }))
vi.mock('../lib/voice', () => ({ speak: vi.fn(), cancelSpeech: vi.fn(), setVoiceEnabled: vi.fn() }))
vi.mock('../history/recorder', () => ({ recordDriving: vi.fn() }))

vi.stubGlobal('window', globalThis)

const { recordDriving } = await import('../history/recorder')
const { useStore } = await import('../state/store')
const { onPosition } = await import('./controller')
const recorded = vi.mocked(recordDriving)

const LAT0 = 40.18
const LON0 = 44.5
const SPEED = 11 // m/s

/** Drives north for `seconds`, one fix a second, each fix stamped by `stamp`. */
async function drive(seconds: number, stamp: (i: number) => number, every = 1000) {
  for (let i = 1; i <= seconds; i++) {
    await vi.advanceTimersByTimeAsync(every)
    const north = (SPEED * i * every) / 1000
    onPosition({ lon: LON0, lat: LAT0 + north / 111_320, heading: 0, speed: SPEED, accuracy: 8, ts: stamp(i) }, 'gps')
  }
}
const metres = () => recorded.mock.calls.reduce((sum, [, t]) => sum + t.metres, 0)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-14T10:00:00Z') })
  recorded.mockClear()
  useStore.setState({ position: null, nav: null })
})

describe('recording a drive', () => {
  it('records a minute of driving with no route set', async () => {
    await drive(60, () => Date.now())
    expect(metres()).toBeGreaterThan(600)
    expect(metres()).toBeLessThan(700)
  })

  it('records it when the browser stamps every fix with the same time', async () => {
    const frozen = Date.now()
    await drive(60, () => frozen)
    expect(metres()).toBeGreaterThan(600)
  })

  it('records it when the browser stamps fixes in a different unit', async () => {
    await drive(60, (i) => i) // seconds since something, not milliseconds since 1970
    expect(metres()).toBeGreaterThan(600)
  })

  it('records it when fixes come only every 15 seconds', async () => {
    await drive(8, () => Date.now(), 15_000)
    expect(metres()).toBeGreaterThan(1100)
  })

  it('records nothing from the map preview’s pretend drive', async () => {
    for (let i = 1; i <= 20; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      onPosition({ lon: LON0, lat: LAT0 + (SPEED * i) / 111_320, heading: 0, speed: SPEED, accuracy: 8, ts: Date.now() }, 'fallback')
    }
    expect(metres()).toBe(0)
  })
})

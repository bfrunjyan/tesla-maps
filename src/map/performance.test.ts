import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fpsFromTimestamps, isSlowGpu, SLOW_FPS, watchFrameRate } from './performance'

describe('isSlowGpu', () => {
  it.each([
    ['Mesa Intel(R) HD Graphics 505 (APL 3)', true], // Tesla MCU2 (Intel Atom)
    ['ANGLE (Intel, Mesa Intel(R) HD Graphics 500 (APL 2), OpenGL 4.6)', true],
    ['Google SwiftShader', true], // software rendering
    ['llvmpipe (LLVM 15.0.7, 256 bits)', true],
    ['none', true], // no WebGL at all
    ['AMD Radeon Graphics (navi23, LLVM 15.0.7, DRM 3.49)', false], // Tesla MCU3 (AMD Ryzen)
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)', false],
  ])('%s → slow=%s', (name, slow) => {
    expect(isSlowGpu(name)).toBe(slow)
  })
})

function frames(fps: number, count: number, pauseEvery = 0) {
  const out: number[] = []
  let t = 0
  for (let i = 0; i < count; i++) {
    t += 1000 / fps
    if (pauseEvery && i > 0 && i % pauseEvery === 0) t += 2000 // map idle between animations
    out.push(t)
  }
  return out
}

describe('fpsFromTimestamps', () => {
  it('measures steady frame rates', () => {
    expect(fpsFromTimestamps(frames(60, 80))).toBeCloseTo(60, 0)
    expect(fpsFromTimestamps(frames(15, 80))).toBeCloseTo(15, 0)
  })

  it('ignores idle pauses between animations', () => {
    expect(fpsFromTimestamps(frames(60, 80, 20))).toBeCloseTo(60, 0)
  })

  it('makes no call from too few frames', () => {
    expect(fpsFromTimestamps(frames(60, 10))).toBeNull()
  })
})

describe('watchFrameRate', () => {
  let now = 0
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function fakeMap() {
    const handlers = new Set<() => void>()
    return {
      on: (_: 'render', cb: () => void) => handlers.add(cb),
      off: (_: 'render', cb: () => void) => handlers.delete(cb),
      render(fps: number, seconds: number) {
        for (let i = 0; i < fps * seconds; i++) {
          now += 1000 / fps
          handlers.forEach((h) => h())
        }
      },
      listeners: () => handlers.size,
    }
  }

  it('switches after two slow windows in a row, then stops listening', () => {
    const map = fakeMap()
    const onSlow = vi.fn()
    watchFrameRate(map, onSlow)
    map.render(15, 4)
    vi.advanceTimersByTime(4000)
    expect(onSlow).not.toHaveBeenCalled() // one slow moment isn't enough
    map.render(15, 4)
    vi.advanceTimersByTime(4000)
    expect(onSlow).toHaveBeenCalledWith(15)
    expect(map.listeners()).toBe(0)
  })

  it('stays on full detail when the map is smooth', () => {
    const map = fakeMap()
    const onSlow = vi.fn()
    watchFrameRate(map, onSlow)
    for (let i = 0; i < 5; i++) {
      map.render(50, 4)
      vi.advanceTimersByTime(4000)
    }
    expect(onSlow).not.toHaveBeenCalled()
  })

  it('needs consecutive slow windows (a smooth one resets the count)', () => {
    const map = fakeMap()
    const onSlow = vi.fn()
    watchFrameRate(map, onSlow)
    for (const fps of [15, 50, 15, 50]) {
      map.render(fps, 4)
      vi.advanceTimersByTime(4000)
    }
    expect(onSlow).not.toHaveBeenCalled()
    expect(SLOW_FPS).toBe(22)
  })
})

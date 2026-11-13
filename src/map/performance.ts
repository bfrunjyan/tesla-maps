/**
 * Lite map for slower car computers (Tesla MCU2, Intel Atom, roughly 2018–2021
 * Model 3/Y). Two signals: the GPU name at start, and the measured frame rate
 * while the map is moving. Pure decision helpers are exported for testing.
 */

/** GPUs that struggle with 3D buildings at high pixel density. */
const SLOW_GPU = /HD Graphics 5\d\d|Atom|Apollo ?Lake|SwiftShader|llvmpipe|softpipe|Software/i

export function gpuName(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return 'none'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name
  } catch {
    return 'unknown'
  }
}

export function isSlowGpu(name: string) {
  return name === 'none' || SLOW_GPU.test(name)
}

/** Frames per second from frame timestamps (ms), ignoring pauses between animations. */
export function fpsFromTimestamps(ts: number[]): number | null {
  const gaps: number[] = []
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1]
    if (d > 0 && d < 500) gaps.push(d) // longer gaps are idle time, not slow frames
  }
  if (gaps.length < 20) return null
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  return 1000 / median
}

export const SLOW_FPS = 22

/**
 * Watches the map's frame rate while it animates. Calls onSlow once, after two
 * consecutive 4-second windows under SLOW_FPS (one slow moment isn't enough).
 */
export function watchFrameRate(map: { on: (e: 'render', cb: () => void) => unknown; off: (e: 'render', cb: () => void) => unknown }, onSlow: (fps: number) => void) {
  let frames: number[] = []
  let slowWindows = 0
  const onRender = () => frames.push(performance.now())
  map.on('render', onRender)
  const timer = window.setInterval(() => {
    const fps = fpsFromTimestamps(frames)
    frames = []
    if (fps == null) return // map was mostly idle
    slowWindows = fps < SLOW_FPS ? slowWindows + 1 : 0
    if (slowWindows >= 2) {
      stop()
      onSlow(Math.round(fps))
    }
  }, 4000)
  const stop = () => {
    window.clearInterval(timer)
    map.off('render', onRender)
  }
  return stop
}

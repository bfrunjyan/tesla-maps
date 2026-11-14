/**
 * During a trip, a map the driver moved goes back to following the car by itself,
 * 5 seconds after the last touch, like the car's own navigation. Any touch, drag,
 * pinch or scroll on the screen starts the 5 seconds again, so the map never jumps
 * away while the driver is still looking around.
 */
import { useStore } from '../state/store'

export const RECENTER_AFTER_MS = 5000

const guiding = (s: ReturnType<typeof useStore.getState>) => s.nav?.status === 'active' || s.nav?.status === 'rerouting'

let timer: ReturnType<typeof setTimeout> | undefined
let started = false

function schedule() {
  clearTimeout(timer)
  timer = undefined
  const s = useStore.getState()
  if (!guiding(s) || s.follow) return
  timer = setTimeout(() => {
    const now = useStore.getState()
    if (guiding(now) && !now.follow) now.set({ follow: true })
  }, RECENTER_AFTER_MS)
}

/** The driver touched the screen: count the 5 seconds from now. */
export function noteActivity() {
  if (timer !== undefined) schedule()
}

export function startAutoRecenter(target: Pick<Window, 'addEventListener'> = window) {
  if (started) return
  started = true
  useStore.subscribe((s, prev) => {
    // Let go of the car during a trip (or a trip started with the map moved): start counting.
    if (s.follow !== prev.follow || guiding(s) !== guiding(prev)) schedule()
  })
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove', 'keydown'] as const) {
    target.addEventListener(
      type,
      (e: Event) => {
        // A mouse just passing over the map isn't the driver using it.
        if (type === 'pointermove' && (e as PointerEvent).buttons === 0) return
        noteActivity()
      },
      { passive: true, capture: true },
    )
  }
}

/** For tests: forget the timer and the listeners' state. */
export function resetAutoRecenter() {
  clearTimeout(timer)
  timer = undefined
  started = false
}

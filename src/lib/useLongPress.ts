import { useRef } from 'react'

/** Tap runs `onTap`; holding for `ms` runs `onLong` instead. */
export function useLongPress(onTap: () => void, onLong: () => void, ms = 600) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const clear = () => window.clearTimeout(timer.current)
  return {
    onPointerDown: () => {
      fired.current = false
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLong()
      }, ms)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: () => {
      if (!fired.current) onTap()
      fired.current = false
    },
  }
}

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { DotsSixVertical, Plus, X } from '@phosphor-icons/react'
import { formatDistance, formatDuration } from '../lib/geo'
import { moveStop, removeStop } from '../nav/controller'
import { MAX_STOPS, stopLetter } from '../nav/stops'
import { useStore } from '../state/store'
import type { Place } from '../types'

/** Height of one stop, in px (also in styles.css: .stop). Dragging counts in whole rows. */
const ROW = 46

/**
 * The trip's stops in order: A, B, C… Drag a stop by its handle to reorder (or focus the
 * handle and press the up and down arrows), tap × to take it out, "Add stop" to add one.
 */
export function StopsList({ stops, remaining, busy }: { stops: Place[]; remaining?: ({ m: number; s: number } | null)[]; busy?: boolean }) {
  const [drag, setDrag] = useState<{ index: number; dy: number } | null>(null)
  const start = useRef(0)
  const many = stops.length > 1
  /** Where the dragged stop would land if let go now. */
  const target = drag ? Math.max(0, Math.min(stops.length - 1, drag.index + Math.round(drag.dy / ROW))) : -1

  const onDown = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Keep getting the finger's moves once it leaves the handle.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* no capture: the drag still works while the finger stays on the handle */
    }
    start.current = e.clientY
    setDrag({ index, dy: 0 })
  }
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    // The stop follows the finger, but not past the ends of the list.
    const dy = Math.max(-drag.index * ROW, Math.min((stops.length - 1 - drag.index) * ROW, e.clientY - start.current))
    setDrag({ index: drag.index, dy })
  }
  const onUp = () => {
    if (!drag) return
    setDrag(null)
    if (target !== drag.index) moveStop(drag.index, target)
  }
  const onKey = (index: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    moveStop(index, index + (e.key === 'ArrowUp' ? -1 : 1))
  }

  return (
    <div className="stops" aria-busy={busy}>
      <ol className="stops__list" data-dragging={!!drag}>
        {stops.map((stop, i) => {
          // The other stops step aside to show where the dragged one will land.
          let shift = 0
          if (drag && i !== drag.index) {
            if (drag.index < i && i <= target) shift = -ROW
            else if (target <= i && i < drag.index) shift = ROW
          }
          const dragged = drag?.index === i
          // Letters follow the order as it would be if the stop were let go now.
          const shown = dragged ? target : i + shift / ROW
          const left = remaining?.[i]
          return (
            <li key={stop.id} className="stop" data-dragged={dragged} style={{ transform: `translateY(${dragged ? drag.dy : shift}px)` }}>
              {many && (
                <button
                  className="stop__handle"
                  aria-label={`Move ${stop.name}. Stop ${i + 1} of ${stops.length}. Drag, or use the up and down arrow keys`}
                  onPointerDown={onDown(i)}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={onKey(i)}
                >
                  <DotsSixVertical size={20} weight="bold" aria-hidden />
                </button>
              )}
              <span className="stop__letter" data-last={shown === stops.length - 1} aria-hidden>{stopLetter(shown)}</span>
              <span className="stop__text">
                <span className="stop__name">{stop.name}</span>
                {left && <span className="stop__meta">{formatDuration(left.s)} · {formatDistance(left.m)}</span>}
              </span>
              {many && (
                <button className="icon-btn icon-btn--sm stop__remove" aria-label={`Remove ${stop.name} from the trip`} onClick={() => removeStop(i)}>
                  <X size={18} weight="bold" />
                </button>
              )}
            </li>
          )
        })}
      </ol>
      <AddStopButton count={stops.length} />
    </div>
  )
}

/** Opens the search panel to pick one more place for the trip. */
export function AddStopButton({ count }: { count: number }) {
  if (count >= MAX_STOPS) return <p className="stops__full">A trip can have up to {MAX_STOPS} stops.</p>
  return (
    <button
      className="stops__add"
      onClick={() => {
        const s = useStore.getState()
        // The driver is planning by hand now: the preview won't start by itself, even if no stop gets added.
        if (s.nav && !s.nav.edited) s.set({ nav: { ...s.nav, edited: true } })
        s.openPanel('add-stop')
      }}
    >
      <Plus size={18} weight="bold" aria-hidden />
      Add stop
    </button>
  )
}

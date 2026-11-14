import { useEffect, useState } from 'react'
import { Clock, Minus, Plus } from '@phosphor-icons/react'
import { formatClock } from '../lib/geo'
import { defaultArrival, leaveByFor, stepArrival, type LeaveBy as Result } from '../nav/leaveBy'
import { stopsOf } from '../nav/stops'
import { googleTravelSeconds } from '../services/googleRoutes'
import { useStore } from '../state/store'

/**
 * "Arrive by" in the route choices (Google map only, as it needs Google's traffic
 * forecast): pick an arrival time in quarter hours and see when to leave.
 */
export function LeaveBy({ travelS }: { travelS: number }) {
  const [open, setOpen] = useState(false)
  const [arriveAt, setArriveAt] = useState<Date | null>(null)
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; result?: Result }>({ status: 'idle' })

  useEffect(() => {
    if (!open || !arriveAt) return
    const s = useStore.getState()
    const from = s.position ?? null
    const nav = s.nav
    if (!from || !nav) return
    const ctrl = new AbortController()
    setState((prev) => ({ status: 'loading', result: prev.result }))
    // Wait for the driver to stop tapping +/− before asking (each forecast is billed).
    const timer = window.setTimeout(() => {
      leaveByFor(arriveAt, travelS, (depart) => googleTravelSeconds(from, stopsOf(nav), depart, ctrl.signal))
        .then((result) => !ctrl.signal.aborted && setState({ status: 'done', result }))
        .catch(() => !ctrl.signal.aborted && setState({ status: 'error' }))
    }, 700)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [open, arriveAt, travelS])

  if (!open) {
    return (
      <button
        className="stops__add leave-by__open"
        onClick={() => {
          setArriveAt(defaultArrival(Date.now(), travelS))
          setOpen(true)
        }}
      >
        <Clock size={18} weight="bold" aria-hidden />
        Arrive by…
      </button>
    )
  }

  const r = state.result
  return (
    <div className="leave-by" role="group" aria-label="Arrive by">
      <div className="leave-by__picker">
        <span className="leave-by__label">Arrive by</span>
        <button className="icon-btn leave-by__step" aria-label="15 minutes earlier" onClick={() => arriveAt && setArriveAt(stepArrival(arriveAt, -1, Date.now()))}>
          <Minus size={18} weight="bold" />
        </button>
        <span className="leave-by__time" aria-live="polite">{arriveAt ? formatClock(arriveAt) : ''}</span>
        <button className="icon-btn leave-by__step" aria-label="15 minutes later" onClick={() => arriveAt && setArriveAt(stepArrival(arriveAt, 1, Date.now()))}>
          <Plus size={18} weight="bold" />
        </button>
      </div>
      <p className="leave-by__result" data-state={state.status} aria-live="polite">
        {state.status === 'error' && !r
          ? 'Couldn’t get the traffic forecast.'
          : !r
            ? 'Checking the traffic forecast…'
            : r.lateMin > 0
              ? <>Leave now: you’d arrive <strong>{r.lateMin} min late</strong></>
              : <>Leave by <strong>{formatClock(r.departAt)}</strong> · {Math.round(r.travelS / 60)} min drive</>}
      </p>
    </div>
  )
}

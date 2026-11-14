import { useEffect, useMemo, useState } from 'react'
import { Briefcase, House, X } from '@phosphor-icons/react'
import { formatClock } from '../lib/geo'
import { startNavigation } from '../nav/controller'
import { commuteFrom } from '../nav/commute'
import { googleTravelSeconds } from '../services/googleRoutes'
import { usingGoogle } from '../services/googleMaps'
import { fetchRoute } from '../services/routing'
import { useStore } from '../state/store'

/** Dismissed for this visit to Home or Work: until the car has been somewhere else. */
let dismissedAt: 'home' | 'work' | null = null

/**
 * Opened at Home with Work saved (or the other way round): "To Work · 24 min", one tap
 * to go. The time is in today's traffic on the Google map, without traffic otherwise.
 */
export function CommuteCard() {
  const real = useStore((s) => s.positionSource === 'gps')
  const position = useStore((s) => s.position)
  const home = useStore((s) => s.home)
  const work = useStore((s) => s.work)
  const google = useStore((s) => usingGoogle(s))
  const lon = position ? Math.round(position.lon * 1000) / 1000 : null
  const lat = position ? Math.round(position.lat * 1000) / 1000 : null
  const commute = useMemo(() => (real && lon != null && lat != null ? commuteFrom({ lon, lat }, home, work) : null), [real, lon, lat, home, work])
  const [minutes, setMinutes] = useState<number | null>(null)
  const [, rerender] = useState(0)

  // Somewhere else than Home or Work: the card can come back next time.
  useEffect(() => {
    if (!commute) dismissedAt = null
  }, [commute])

  const toId = commute?.to.id
  useEffect(() => {
    setMinutes(null)
    if (!commute || dismissedAt === commute.at) return
    const from = useStore.getState().position
    if (!from) return
    const ctrl = new AbortController()
    const ask = google
      ? googleTravelSeconds(from, [commute.to], new Date(), ctrl.signal)
      : fetchRoute(from, [commute.to], useStore.getState().lang, ctrl.signal).then((r) => r.totalS)
    ask.then((s) => !ctrl.signal.aborted && setMinutes(Math.max(1, Math.round(s / 60)))).catch(() => {})
    return () => ctrl.abort()
    // Asked once per arrival at Home or Work, not on every GPS fix.
  }, [commute?.at, toId, google])

  if (!commute || dismissedAt === commute.at) return null
  const toWork = commute.at === 'home'
  const arrive = minutes != null ? formatClock(new Date(Date.now() + minutes * 60_000)) : null
  return (
    <section className="surface card commute" aria-label={toWork ? 'Trip to Work' : 'Trip to Home'}>
      <button className="commute__go" onClick={() => startNavigation(commute.to)}>
        <span className="commute__icon" aria-hidden>
          {toWork ? <Briefcase size={20} weight="fill" /> : <House size={20} weight="fill" />}
        </span>
        <span className="commute__text">
          <span className="commute__title">
            {toWork ? 'To Work' : 'To Home'}
            {minutes != null && <span className="commute__time"> · {minutes} min</span>}
          </span>
          <span className="commute__sub">{arrive ? `Arrive ${arrive}${google ? ' with traffic' : ''}` : 'Checking the drive…'}</span>
        </span>
      </button>
      <button
        className="icon-btn commute__close"
        aria-label="Not now"
        onClick={() => {
          dismissedAt = commute.at
          rerender((n) => n + 1)
        }}
      >
        <X size={18} weight="bold" />
      </button>
    </section>
  )
}

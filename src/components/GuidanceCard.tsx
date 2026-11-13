import { ArrowClockwise, CaretDown, CircleNotch, SpeakerHigh, SpeakerSlash, Star, X } from '@phosphor-icons/react'
import { formatClock, formatDistance, formatDuration } from '../lib/geo'
import { endNavigation, startNavigation } from '../nav/controller'
import { useStore } from '../state/store'
import { ManeuverIcon } from './icons'
import { useArrival } from '../vehicle/useArrival'
import { BatteryIcon } from './BatteryIcon'
import { RoutePreview } from './RoutePreview'

/** Turn-by-turn card: next maneuver, upcoming turn list, trip summary. */
export function GuidanceCard() {
  const nav = useStore((s) => s.nav)
  const voiceOn = useStore((s) => s.voiceOn)
  const listOpen = useStore((s) => s.turnListOpen)
  const favorites = useStore((s) => s.favorites)
  const s = useStore.getState()
  const arrival = useArrival(nav?.route, nav?.route ? (nav.progress?.remainingM ?? nav.route.totalM) / Math.max(1, nav.route.totalM) : 1)
  if (!nav) return null
  if (nav.status === 'choosing') return <RoutePreview />
  const dest = nav.destination
  const fav = favorites.some((f) => f.id === dest.id)

  const destHeader = (
    <div className="guide__dest">
      <span className="guide__dest-name">{dest.name}</span>
      <button className="icon-btn icon-btn--sm" aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav} onClick={() => s.toggleFavorite(dest)}>
        <Star size={18} weight={fav ? 'fill' : 'bold'} className={fav ? 'is-fav' : undefined} />
      </button>
    </div>
  )

  if (nav.status === 'routing' || nav.status === 'error' || !nav.route) {
    return (
      <section className="surface card guide" aria-live="polite">
        {destHeader}
        <div className="guide__state">
          {nav.status === 'error' ? (
            <>
              <p className="guide__state-text">{nav.error ?? 'Couldn’t find a route.'}</p>
              <div className="guide__state-actions">
                <button className="btn btn--primary" onClick={() => startNavigation(dest)}>
                  <ArrowClockwise size={18} aria-hidden /> Try again
                </button>
                <button className="btn" onClick={endNavigation}>Cancel</button>
              </div>
            </>
          ) : (
            <p className="guide__state-text">
              <CircleNotch weight="bold" className="spin" size={20} aria-hidden /> Finding the best route…
            </p>
          )}
        </div>
      </section>
    )
  }

  const route = nav.route
  const p = nav.progress
  const nextIdx = p?.nextIndex ?? 1
  const next = route.maneuvers[nextIdx] ?? route.maneuvers[route.maneuvers.length - 1]
  const remainingS = p?.remainingS ?? route.totalS
  const remainingM = p?.remainingM ?? route.totalM
  const eta = new Date(Date.now() + remainingS * 1000)
  const upcoming = route.maneuvers.slice(nextIdx + 1)
  const arrived = nav.status === 'arrived'

  return (
    <section className="surface card guide" aria-label="Turn-by-turn directions">
      <div className="guide__next" aria-live="polite">
        <span className="guide__next-icon">
          <ManeuverIcon type={arrived ? 4 : next.type} size={52} />
        </span>
        <div className="guide__next-text">
          <span className="guide__next-dist">{arrived ? 'Arrived' : formatDistance(p?.toNextM ?? next.atM)}</span>
          <span className="guide__next-street">{arrived ? dest.name : next.street || next.instruction}</span>
        </div>
        {nav.status === 'rerouting' && (
          <span className="badge" role="status">
            <CircleNotch weight="bold" className="spin" size={14} aria-hidden /> Rerouting
          </span>
        )}
      </div>

      {!arrived && upcoming.length > 0 && (
        <>
          <button className="guide__toggle" aria-expanded={listOpen} onClick={() => s.set({ turnListOpen: !listOpen })}>
            <span>{listOpen ? 'Hide turns' : `${upcoming.length} more turn${upcoming.length === 1 ? '' : 's'}`}</span>
            <CaretDown size={20} className="guide__chev" data-open={listOpen} aria-hidden />
          </button>
          {listOpen && (
            <ol className="turns">
              {upcoming.map((m, i) => (
                <li className="turn" key={`${m.shapeIndex}-${i}`}>
                  <ManeuverIcon type={m.type} size={28} />
                  <span className="turn__text">{m.instruction}</span>
                  <span className="turn__dist">{formatDistance(Math.max(0, m.atM - (p?.alongM ?? 0)))}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <footer className="guide__foot">
        <div className="guide__summary">
          <span className="guide__eta">{formatClock(eta)}</span>
          <span className="guide__meta">
            {formatDuration(remainingS)} · {formatDistance(remainingM)}
            {arrival && (
              <span className="arrival" data-level={arrival.level} aria-label={arrival.reachable ? `${arrival.pct} percent battery at arrival` : 'Charging needed to arrive'}>
                {' · '}
                <BatteryIcon pct={Math.max(0, arrival.pct)} size={18} />
                {arrival.reachable ? `${arrival.pct}%` : 'Charge needed'}
              </span>
            )}
          </span>
          {destHeader}
        </div>
        <button className="icon-btn" aria-label={voiceOn ? 'Mute voice guidance' : 'Unmute voice guidance'} aria-pressed={!voiceOn} onClick={() => s.setVoice(!voiceOn)}>
          {voiceOn ? <SpeakerHigh size={22} /> : <SpeakerSlash size={22} />}
        </button>
        <button className="icon-btn icon-btn--danger" aria-label="End trip" onClick={endNavigation}>
          <X size={24} weight="bold" />
        </button>
      </footer>
    </section>
  )
}

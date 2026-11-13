import { ArrowClockwise, CaretDown, CaretUp, CircleNotch, SpeakerHigh, SpeakerSlash, Star, X } from '@phosphor-icons/react'
import { formatClock, formatDistance, formatDuration } from '../lib/geo'
import { endNavigation, startNavigation } from '../nav/controller'
import { useStore } from '../state/store'
import { ManeuverIcon } from './icons'
import { useArrival } from '../vehicle/useArrival'
import { BatteryIcon } from './BatteryIcon'
import { RoutePreview } from './RoutePreview'

/**
 * Turn-by-turn card: next maneuver, upcoming turn list, trip summary.
 * The driver can hide it; a small chip with the next turn stays and brings it back.
 */
export function GuidanceCard() {
  const nav = useStore((s) => s.nav)
  const voiceOn = useStore((s) => s.voiceOn)
  const listOpen = useStore((s) => s.turnListOpen)
  const hidden = useStore((s) => s.guideHidden)
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
  const nextDist = arrived ? 'Arrived' : formatDistance(p?.toNextM ?? next.atM)
  const nextStreet = arrived ? dest.name : next.street || next.instruction

  if (hidden) {
    return (
      <button className="surface card guide-chip" aria-expanded={false} aria-label={`${nextDist}, ${nextStreet}. Show directions`} onClick={() => s.setGuideHidden(false)}>
        {nav.status === 'rerouting' ? <CircleNotch weight="bold" className="spin" size={22} aria-hidden /> : <ManeuverIcon type={arrived ? 4 : next.type} size={28} />}
        <span className="guide-chip__dist" aria-live="polite">{nextDist}</span>
        <CaretDown size={16} weight="bold" className="guide-chip__caret" aria-hidden />
      </button>
    )
  }

  return (
    <section className="surface card guide" aria-label="Turn-by-turn directions">
      <div className="guide__next">
        <span className="guide__next-icon">
          <ManeuverIcon type={arrived ? 4 : next.type} size={40} />
        </span>
        <div className="guide__next-text" aria-live="polite">
          <span className="guide__next-dist">{nextDist}</span>
          <span className="guide__next-street">{nextStreet}</span>
          {nav.status === 'rerouting' && (
            <span className="badge" role="status">
              <CircleNotch weight="bold" className="spin" size={13} aria-hidden /> Rerouting
            </span>
          )}
        </div>
        <button className="icon-btn icon-btn--sm guide__hide" aria-label="Hide directions" aria-expanded onClick={() => s.setGuideHidden(true)}>
          <CaretUp size={18} weight="bold" />
        </button>
      </div>

      {!arrived && upcoming.length > 0 && (
        <>
          <button className="guide__toggle" aria-expanded={listOpen} onClick={() => s.set({ turnListOpen: !listOpen })}>
            <span>{listOpen ? 'Hide turns' : `${upcoming.length} more turn${upcoming.length === 1 ? '' : 's'}`}</span>
            <CaretDown size={16} weight="bold" className="guide__chev" data-open={listOpen} aria-hidden />
          </button>
          {listOpen && (
            <ol className="turns">
              {upcoming.map((m, i) => (
                <li className="turn" key={`${m.shapeIndex}-${i}`}>
                  <ManeuverIcon type={m.type} size={24} />
                  <span className="turn__text">{m.instruction}</span>
                  <span className="turn__dist">{formatDistance(Math.max(0, m.atM - (p?.alongM ?? 0)))}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <footer className="guide__foot">
        <div className="guide__trip">
          <span className="guide__eta">{formatClock(eta)}</span>
          <span className="guide__meta">
            {formatDuration(remainingS)} · {formatDistance(remainingM)}
          </span>
          {arrival && (
            <span className="arrival" data-level={arrival.level} aria-label={arrival.reachable ? `${arrival.pct} percent battery at arrival` : 'Charging needed to arrive'}>
              <BatteryIcon pct={Math.max(0, arrival.pct)} size={16} />
              {arrival.reachable ? `${arrival.pct}%` : 'Charge needed'}
            </span>
          )}
        </div>
        <div className="guide__bar">
          {destHeader}
          <button className="icon-btn icon-btn--sm" aria-label={voiceOn ? 'Mute voice guidance' : 'Unmute voice guidance'} aria-pressed={!voiceOn} onClick={() => s.setVoice(!voiceOn)}>
            {voiceOn ? <SpeakerHigh size={20} /> : <SpeakerSlash size={20} />}
          </button>
          <button className="icon-btn icon-btn--sm icon-btn--danger" aria-label="End trip" onClick={endNavigation}>
            <X size={20} weight="bold" />
          </button>
        </div>
      </footer>
    </section>
  )
}

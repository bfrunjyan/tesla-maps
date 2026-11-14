import { useEffect, useState } from 'react'
import { ArrowClockwise, Car, CircleNotch, NavigationArrow, Star, X } from '@phosphor-icons/react'
import { formatDistance, formatDuration } from '../lib/geo'
import { endNavigation, goWithRoute, retryRoute, selectRoute } from '../nav/controller'
import { stopsOf } from '../nav/stops'
import { samePlace, useStore } from '../state/store'
import type { Place, Route } from '../types'
import { vehicleSpec } from '../vehicle/catalog'
import { useArrival } from '../vehicle/useArrival'
import { BatteryIcon } from './BatteryIcon'
import { usingGoogle } from '../services/googleMaps'
import { LeaveBy } from './LeaveBy'
import { AddStopButton, StopsList } from './StopsList'

const AUTO_START_S = 10

/**
 * The trip before guidance starts: its stops (add, remove, reorder) and the route
 * choices. Fastest is pre-selected and starts by itself after 10 s unless the driver
 * touches anything or has changed the stops (then they tap Go).
 */
export function RoutePreview() {
  const nav = useStore((s) => s.nav)
  const [secondsLeft, setSecondsLeft] = useState(AUTO_START_S)
  const [auto, setAuto] = useState(() => !useStore.getState().nav?.edited)
  const choosing = nav?.status === 'choosing'

  // Any touch anywhere (card, map, buttons) hands control to the driver.
  useEffect(() => {
    if (!auto) return
    const stop = () => setAuto(false)
    window.addEventListener('pointerdown', stop, { capture: true })
    window.addEventListener('keydown', stop, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', stop, { capture: true })
      window.removeEventListener('keydown', stop, { capture: true })
    }
  }, [auto])

  // The countdown runs only while there are routes to start on.
  useEffect(() => {
    if (!auto || !choosing) return
    if (secondsLeft <= 0) return goWithRoute()
    const t = window.setTimeout(() => setSecondsLeft((n) => n - 1), 1000)
    return () => window.clearTimeout(t)
  }, [auto, choosing, secondsLeft])

  const vehicle = useStore((s) => s.vehicle)
  const battery = useStore((s) => s.battery)
  const favorites = useStore((s) => s.favorites)
  const google = useStore((s) => usingGoogle(s))
  if (!nav) return null
  const stops = stopsOf(nav)
  const options = choosing ? nav.options ?? [] : []
  const fastest = options[0]?.route
  const selected = nav.selected ?? 0
  const anyEnergy = options.some((o) => typeof o.route.kWh === 'number')
  const carReady = !!vehicleSpec(vehicle) && !!battery

  return (
    <section className="surface card route-preview" aria-label={stops.length > 1 ? 'Plan the trip' : 'Choose a route'}>
      <header className="route-preview__head">
        <div className="route-preview__titles">
          <span className="route-preview__label">{stops.length > 1 ? `Trip · ${stops.length} stops` : 'Route to'}</span>
          {stops.length === 1 && <h2 className="route-preview__dest">{nav.destination.name}</h2>}
        </div>
        <button className="icon-btn" aria-label="Cancel" onClick={endNavigation}>
          <X size={22} weight="bold" />
        </button>
      </header>

      {stops.length > 1 ? (
        <StopsList stops={stops} busy={nav.status === 'routing'} />
      ) : (
        <div className="route-preview__actions">
          <AddStopButton count={1} />
          <FavoriteButton place={nav.destination} favorite={favorites.some((f) => samePlace(f, nav.destination))} />
        </div>
      )}

      {nav.status === 'routing' && (
        <p className="route-preview__state" role="status">
          <CircleNotch weight="bold" className="spin" size={20} aria-hidden /> Finding the best route…
        </p>
      )}
      {nav.status === 'error' && (
        <div className="route-preview__error" role="alert">
          <p className="route-preview__state">{nav.error ?? 'Couldn’t find a route.'}</p>
          <button className="btn" onClick={retryRoute}>
            <ArrowClockwise size={18} aria-hidden /> Try again
          </button>
        </div>
      )}

      {options.length > 0 && (
        <div className="route-options" role="radiogroup" aria-label="Routes">
          {options.map((o, i) => {
            // Compare the minutes as shown, so 52 vs 49 reads +3.
            const extra = Math.round(o.route.totalS / 60) - Math.round(fastest!.totalS / 60)
            return (
              <button
                key={i}
                role="radio"
                aria-checked={selected === i}
                className="route-option"
                onClick={() => selectRoute(i)}
              >
                <span className="route-option__main">
                  <span className="route-option__time">{formatDuration(o.route.totalS)}</span>
                  <span className="route-option__meta">
                    <span>{formatDistance(o.route.totalM)}</span>
                    <ArrivalMeta route={o.route} />
                  </span>
                </span>
                <span className="route-option__side">
                  {o.tags.map((t) => (
                    <span key={t} className="tag" data-tag={t}>{t}</span>
                  ))}
                  {!o.tags.length && extra > 0 && <span className="route-option__extra">+{extra} min</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {anyEnergy &&
        (carReady ? (
          <p className="route-preview__note">Charge at arrival is an estimate from distance, speed and climbs.</p>
        ) : (
          <button className="route-preview__setup" onClick={() => useStore.getState().set({ carSheetOpen: true })}>
            <Car size={18} aria-hidden />
            {vehicle ? 'Set your battery level to see charge at arrival' : 'Choose your car to see charge at arrival'}
          </button>
        ))}

      {/* When to leave for an arrival time: needs Google's traffic forecast. */}
      {choosing && google && options[selected] && <LeaveBy travelS={options[selected].route.totalS} />}

      <button className="btn btn--primary btn--block route-preview__go" disabled={!choosing} onClick={() => goWithRoute()}>
        <NavigationArrow size={20} aria-hidden />
        Go{auto && choosing && <span className="route-preview__count"> · {secondsLeft}</span>}
      </button>
    </section>
  )
}

/** "→ 54 %" at arrival when the car and battery are known; otherwise the energy estimate. */
function ArrivalMeta({ route }: { route: Route }) {
  const arrival = useArrival(route)
  if (arrival) {
    return (
      <span className="arrival" data-level={arrival.level}>
        <BatteryIcon pct={Math.max(0, arrival.pct)} size={16} />
        {arrival.reachable ? `${arrival.pct}% at arrival` : 'Charge needed'}
      </span>
    )
  }
  if (typeof route.kWh !== 'number') return null
  return <span>≈{route.kWh.toFixed(1)} kWh</span>
}

/** Saves the destination as a favorite, or removes it, right from the route choices. */
function FavoriteButton({ place, favorite }: { place: Place; favorite: boolean }) {
  return (
    <button
      className="stops__add route-preview__fav"
      aria-pressed={favorite}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={() => useStore.getState().toggleFavorite(place)}
    >
      <Star size={18} weight={favorite ? 'fill' : 'bold'} className={favorite ? 'is-fav' : undefined} aria-hidden />
      Favorite
    </button>
  )
}

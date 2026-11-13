import { useEffect, useState } from 'react'
import { Car, NavigationArrow, X } from '@phosphor-icons/react'
import { formatDistance, formatDuration } from '../lib/geo'
import { endNavigation, goWithRoute, selectRoute } from '../nav/controller'
import { useStore } from '../state/store'
import type { Route } from '../types'
import { vehicleSpec } from '../vehicle/catalog'
import { useArrival } from '../vehicle/useArrival'
import { BatteryIcon } from './BatteryIcon'

const AUTO_START_S = 10

/**
 * Route choices before guidance starts. Fastest is pre-selected and starts by
 * itself after 10 s unless the driver touches anything (then they tap Go).
 */
export function RoutePreview() {
  const nav = useStore((s) => s.nav)
  const [secondsLeft, setSecondsLeft] = useState(AUTO_START_S)
  const [auto, setAuto] = useState(true)

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

  useEffect(() => {
    if (!auto) return
    if (secondsLeft <= 0) return goWithRoute()
    const t = window.setTimeout(() => setSecondsLeft((n) => n - 1), 1000)
    return () => window.clearTimeout(t)
  }, [auto, secondsLeft])

  const vehicle = useStore((s) => s.vehicle)
  const battery = useStore((s) => s.battery)
  if (!nav?.options) return null
  const fastest = nav.options[0].route
  const selected = nav.selected ?? 0
  const anyEnergy = nav.options.some((o) => typeof o.route.kWh === 'number')
  const carReady = !!vehicleSpec(vehicle) && !!battery

  return (
    <section className="surface card route-preview" aria-label="Choose a route">
      <header className="route-preview__head">
        <div className="route-preview__titles">
          <span className="route-preview__label">Route to</span>
          <h2 className="route-preview__dest">{nav.destination.name}</h2>
        </div>
        <button className="icon-btn" aria-label="Cancel" onClick={endNavigation}>
          <X size={22} weight="bold" />
        </button>
      </header>

      <div className="route-options" role="radiogroup" aria-label="Routes">
        {nav.options.map((o, i) => {
          // Compare the minutes as shown, so 52 vs 49 reads +3.
          const extra = Math.round(o.route.totalS / 60) - Math.round(fastest.totalS / 60)
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
                  {formatDistance(o.route.totalM)}
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

      {anyEnergy &&
        (carReady ? (
          <p className="route-preview__note">Charge at arrival is an estimate from distance, speed and climbs.</p>
        ) : (
          <button className="route-preview__setup" onClick={() => useStore.getState().set({ carSheetOpen: true })}>
            <Car size={18} aria-hidden />
            {vehicle ? 'Set your battery level to see charge at arrival' : 'Choose your car to see charge at arrival'}
          </button>
        ))}

      <button className="btn btn--primary btn--block route-preview__go" onClick={() => goWithRoute()}>
        <NavigationArrow size={20} aria-hidden />
        Go{auto && <span className="route-preview__count"> · {secondsLeft}</span>}
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
        {' · '}
        <BatteryIcon pct={Math.max(0, arrival.pct)} size={16} />
        {arrival.reachable ? `${arrival.pct}% at arrival` : 'Charge needed'}
      </span>
    )
  }
  if (typeof route.kWh !== 'number') return null
  return <> · ≈{route.kWh.toFixed(1)} kWh</>
}

import { useEffect, useState } from 'react'
import { BatteryMedium, NavigationArrow, X } from '@phosphor-icons/react'
import { formatDistance, formatDuration } from '../lib/geo'
import { endNavigation, goWithRoute, selectRoute } from '../nav/controller'
import { useStore } from '../state/store'

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

  if (!nav?.options) return null
  const fastest = nav.options[0].route
  const selected = nav.selected ?? 0
  const anyEnergy = nav.options.some((o) => typeof o.route.kWh === 'number')

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
                  {typeof o.route.kWh === 'number' && (
                    <>
                      {' · '}
                      <BatteryMedium size={14} aria-hidden /> ≈{o.route.kWh.toFixed(1)} kWh
                    </>
                  )}
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

      {anyEnergy && <p className="route-preview__note">Battery use is an estimate from distance, speed and climbs.</p>}

      <button className="btn btn--primary btn--block route-preview__go" onClick={() => goWithRoute()}>
        <NavigationArrow size={20} aria-hidden />
        Go{auto && <span className="route-preview__count"> · {secondsLeft}</span>}
      </button>
    </section>
  )
}

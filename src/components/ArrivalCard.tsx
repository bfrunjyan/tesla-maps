import { useEffect, useMemo, useState } from 'react'
import { Lightning, X } from '@phosphor-icons/react'
import { chargerToPlace, nearestChargers } from '../lib/chargers'
import { distance, formatDistance } from '../lib/geo'
import { startNavigation } from '../nav/controller'
import { stopsOf } from '../nav/stops'
import { useShownChargers } from '../services/googleChargers'
import { usingGoogle } from '../services/googleMaps'
import { googleParking } from '../services/googleParking'
import { parkingNear } from '../services/search'
import { useStore } from '../state/store'
import type { Place } from '../types'

/** The card shows from this far before the destination. */
export const SHOW_FROM_M = 800
/** A charger further than this from the destination isn't "at" it. */
const CHARGER_WITHIN_M = 1500
const MAX_PARKING = 3

/** Car parks already looked up, per destination. */
const parkingCache = new Map<string, Place[]>()
const keyOf = (p: { lon: number; lat: number }) => `${p.lon.toFixed(4)},${p.lat.toFixed(4)}`
const dismissed = new Set<string>()

/**
 * Close to the destination: where to park and the nearest charger, each one tap to go
 * there instead. Car parks come from Google on the Google map, from OpenStreetMap
 * otherwise (it names few of them in Armenia).
 */
export function ArrivalCard() {
  const nav = useStore((s) => s.nav)
  const google = useStore((s) => usingGoogle(s))
  const chargers = useShownChargers()
  const [parking, setParking] = useState<Place[] | null>(null)
  const [, rerender] = useState(0)
  const guiding = nav?.status === 'active' || nav?.status === 'rerouting'
  const near = guiding && !nav?.via?.length && (nav?.progress?.remainingM ?? Infinity) <= SHOW_FROM_M
  const dest = nav?.destination ?? null
  const key = dest ? keyOf(dest) : ''

  useEffect(() => {
    if (!near || !dest) return
    const cached = parkingCache.get(key)
    if (cached) return setParking(cached)
    setParking(null)
    const ctrl = new AbortController()
    const ask = google ? googleParking(dest, SHOW_FROM_M, ctrl.signal) : parkingNear(dest, 1, ctrl.signal)
    ask
      .then((list) => {
        parkingCache.set(key, list)
        if (!ctrl.signal.aborted) setParking(list)
      })
      .catch(() => !ctrl.signal.aborted && setParking([]))
    return () => ctrl.abort()
    // Once per destination, when the car gets close.
  }, [near, key, google])

  const charger = useMemo(() => {
    if (!dest) return null
    const n = nearestChargers(chargers, dest, 'all', 1)[0]
    return n && n.meters <= CHARGER_WITHIN_M ? n : null
  }, [chargers, dest])

  if (!near || !dest || dismissed.has(key)) return null
  const rows = (parking ?? []).slice(0, MAX_PARKING)
  if (parking && !rows.length && !charger) return null
  const fromDest = (p: { lon: number; lat: number }) => formatDistance(distance([dest.lon, dest.lat], [p.lon, p.lat]))
  // Going somewhere near the destination instead: keep any stops still ahead out of it.
  const goInstead = (p: Place) => {
    if (stopsOf(useStore.getState().nav).length > 1) return
    startNavigation(p)
  }

  return (
    <section className="surface card dest-near" aria-label={`Near ${dest.name}`}>
      <header className="dest-near__head">
        <h3 className="dest-near__title">Near {dest.name}</h3>
        <button
          className="icon-btn dest-near__close"
          aria-label="Hide"
          onClick={() => {
            dismissed.add(key)
            rerender((n) => n + 1)
          }}
        >
          <X size={16} weight="bold" />
        </button>
      </header>
      <ul className="dest-near__list">
        {parking == null && <li className="dest-near__loading">Looking for parking…</li>}
        {rows.map((p) => (
          <li key={p.id}>
            <button className="dest-near__row" onClick={() => goInstead(p)}>
              {/* The parking sign drivers know: a white P on blue. */}
              <span className="dest-near__icon dest-near__icon--parking" aria-hidden>
                P
              </span>
              <span className="dest-near__text">
                <span className="dest-near__name">{p.name}</span>
                <span className="dest-near__sub">{p.address}</span>
              </span>
              <span className="dest-near__meta">{fromDest(p)}</span>
            </button>
          </li>
        ))}
        {charger && (
          <li>
            <button className="dest-near__row" onClick={() => goInstead(chargerToPlace(charger.charger))}>
              <span className="dest-near__icon dest-near__icon--charger" aria-hidden>
                <Lightning size={16} weight="fill" />
              </span>
              <span className="dest-near__text">
                <span className="dest-near__name">{charger.charger.name}</span>
                <span className="dest-near__sub">Nearest charger</span>
              </span>
              <span className="dest-near__meta">{formatDistance(charger.meters)}</span>
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}

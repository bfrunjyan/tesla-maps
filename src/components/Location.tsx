import { useEffect, useRef } from 'react'
import { ArrowClockwise, NavigationArrow, X } from '@phosphor-icons/react'
import { skipLocation, startWatching } from '../nav/controller'
import { useStore, type GpsStatus } from '../state/store'

const CHIP: Partial<Record<GpsStatus, { label: string; tone: 'neutral' | 'warn' | 'bad' | 'busy' }>> = {
  'needs-permission': { label: 'Location off', tone: 'neutral' },
  finding: { label: 'Finding GPS…', tone: 'busy' },
  weak: { label: 'Weak GPS', tone: 'warn' },
  lost: { label: 'GPS lost', tone: 'warn' },
  unavailable: { label: 'No GPS signal', tone: 'warn' },
  denied: { label: 'Location blocked', tone: 'bad' },
}

/** Small status chip; hidden while GPS is healthy, like the car's own UI. */
export function GpsIndicator() {
  const gps = useStore((s) => s.gps)
  const set = useStore((s) => s.set)
  const chip = CHIP[gps]
  if (!chip) return null
  const opensSheet = gps === 'needs-permission' || gps === 'denied'
  const explain = () => {
    if (opensSheet) return set({ locationSheetOpen: true })
    const s = useStore.getState()
    if (gps === 'weak') s.showToast('GPS is imprecise here. Your position may jump a little.')
    else if (gps === 'lost') s.showToast('No GPS update for a few seconds. It comes back on its own.')
    else s.showToast('Waiting for a GPS signal…')
  }
  return (
    <button className="surface gps-chip" data-tone={chip.tone} onClick={explain} aria-label={`${chip.label}. ${opensSheet ? 'Turn on location' : 'Details'}`}>
      <span className="gps-chip__dot" aria-hidden />
      <span>{chip.label}</span>
    </button>
  )
}

/** Explains location before the browser's prompt, or how to unblock it. */
export function LocationSheet() {
  const open = useStore((s) => s.locationSheetOpen)
  const gps = useStore((s) => s.gps)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && skipLocation()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const blocked = gps === 'denied'

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && skipLocation()}>
      <div ref={ref} className="surface sheet loc-sheet" role="dialog" aria-modal="true" aria-labelledby="loc-title" tabIndex={-1}>
        <header className="sheet__head">
          <h2 id="loc-title" className="sheet__title">{blocked ? 'Location is blocked' : 'Use your car’s location'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={skipLocation}>
            <X size={22} weight="bold" />
          </button>
        </header>
        <div className="loc-sheet__body">
          <span className="loc-sheet__icon" aria-hidden>
            <NavigationArrow size={30} />
          </span>
          {blocked ? (
            <>
              <p className="sheet__text">Mapic can’t see where the car is, so it can’t follow you or guide turns. To turn location back on:</p>
              <ol className="loc-steps">
                <li>Tap the icon at the left of the address bar.</li>
                <li>Set <strong>Location</strong> to <strong>Allow</strong>.</li>
                <li>Reload this page.</li>
              </ol>
            </>
          ) : (
            <>
              <p className="sheet__text">Mapic shows where you are, follows the car and guides each turn. Your location is used for maps and routes only and isn’t saved to your account.</p>
              <p className="sheet__text loc-sheet__hint">Next, the car asks to share your location. Tap <strong>Allow</strong>.</p>
            </>
          )}
          <div className="account__actions">
            {blocked ? (
              <button className="btn btn--primary" onClick={() => location.reload()}>
                <ArrowClockwise size={20} weight="bold" aria-hidden /> Reload page
              </button>
            ) : (
              <button className="btn btn--primary" onClick={startWatching}>
                <NavigationArrow size={20} aria-hidden /> Allow location
              </button>
            )}
            <button className="btn" onClick={skipLocation}>Not now</button>
          </div>
        </div>
      </div>
    </div>
  )
}

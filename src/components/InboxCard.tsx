import { DeviceMobile, NavigationArrow, X } from '@phosphor-icons/react'
import { startNavigation } from '../nav/controller'
import { inboxDone } from '../nav/inbox'
import { useStore } from '../state/store'

/** In the car: a place sent from the driver's phone, one tap to go. */
export function InboxCard() {
  const item = useStore((s) => s.inbox)
  if (!item) return null
  const { place } = item
  return (
    <section className="surface card inbox" aria-label={`Sent from your phone: ${place.name}`}>
      <header className="inbox__head">
        <DeviceMobile size={16} weight="bold" aria-hidden />
        <span className="inbox__label">From your phone</span>
        <button className="icon-btn inbox__close" aria-label="Dismiss" onClick={inboxDone}>
          <X size={16} weight="bold" />
        </button>
      </header>
      <h3 className="inbox__name">{place.name}</h3>
      {place.address && <p className="inbox__address">{place.address}</p>}
      <button
        className="btn btn--primary btn--block inbox__go"
        onClick={() => {
          inboxDone()
          startNavigation(place)
        }}
      >
        <NavigationArrow size={18} aria-hidden />
        Navigate
      </button>
    </section>
  )
}

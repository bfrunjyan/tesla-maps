import { useState } from 'react'
import { Briefcase, House, Lightning, NavigationArrow, PaperPlaneTilt, PencilSimple, Star, X } from '@phosphor-icons/react'
import { isFast, powerLabel } from '../lib/chargers'
import { distance, formatDistance } from '../lib/geo'
import { startNavigation } from '../nav/controller'
import { isPhone, sendToCar } from '../nav/inbox'
import { useStore } from '../state/store'
import { RenameField } from './RenameField'

/** Shown for a tapped POI, a charger or a long-press dropped pin. */
export function PlaceCard() {
  const place = useStore((s) => s.selectedPlace)
  const position = useStore((s) => s.position)
  const favorites = useStore((s) => s.favorites)
  const [editing, setEditing] = useState(false)
  const [sending, setSending] = useState(false)
  const user = useStore((st) => st.user)
  const s = useStore.getState()
  if (!place) return null
  const saved = favorites.find((f) => f.id === place.id)
  const fav = !!saved
  const name = saved?.name ?? place.name
  const charger = place.charger
  const dist = position ? formatDistance(distance([position.lon, position.lat], [place.lon, place.lat])) : ''

  return (
    <section className="surface card place-card" aria-label={name} key={place.id}>
      <header className="place-card__head">
        <div className="place-card__titles">
          {editing ? (
            <RenameField
              initial={name}
              onSave={(v) => {
                s.renamePlace(place, v)
                setEditing(false)
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <h2 className="place-card__title">{name}</h2>
          )}
        </div>
        <div className="place-card__tools">
          {!editing && (
            <button className="icon-btn place-card__tool" aria-label="Rename" onClick={() => setEditing(true)}>
              <PencilSimple size={18} />
            </button>
          )}
          <button className="icon-btn place-card__tool" aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav} onClick={() => s.toggleFavorite({ ...place, name })}>
            <Star size={18} weight={fav ? 'fill' : 'bold'} className={fav ? 'is-fav' : undefined} />
          </button>
          <button className="icon-btn place-card__tool" aria-label="Close" onClick={() => s.set({ selectedPlace: null })}>
            <X size={18} weight="bold" />
          </button>
        </div>
      </header>
      {/* Below the buttons, the details get the card's full width. */}
      {charger ? (
        <>
          <p className="place-card__sub">{[charger.operator !== name ? charger.operator : null, dist].filter(Boolean).join(' · ') || 'Charging station'}</p>
          <ul className="specs" aria-label="Charger details">
            <li className="spec" data-fast={isFast(charger)}>
              <Lightning size={15} aria-hidden />
              {powerLabel(charger) ?? 'Power not listed'}
            </li>
            {charger.connectors.map((c) => (
              <li key={c} className="spec">{c}</li>
            ))}
            {charger.points != null && <li className="spec">{charger.points} {charger.points === 1 ? 'point' : 'points'}</li>}
            {charger.status && (
              <li className="spec" data-status={charger.status.state}>
                {charger.status.state === 'free'
                  ? charger.status.free != null && charger.status.total != null
                    ? `${charger.status.free} of ${charger.status.total} free`
                    : 'Free'
                  : charger.status.state === 'busy'
                    ? 'Busy'
                    : 'Offline'}
              </li>
            )}
          </ul>
        </>
      ) : (
        <p className="place-card__sub">{[place.address, dist].filter(Boolean).join(' · ')}</p>
      )}
      <div className="place-card__actions">
        <button className="btn btn--primary" onClick={() => startNavigation({ ...place, name })}>
          <NavigationArrow size={18} aria-hidden />
          Navigate
        </button>
        <button
          className="btn"
          onClick={() => {
            s.setHome({ ...place, name })
            s.showToast('Home saved')
          }}
        >
          <House size={16} aria-hidden />
          Set as Home
        </button>
        <button
          className="btn"
          onClick={() => {
            s.setWork({ ...place, name })
            s.showToast('Work saved')
          }}
        >
          <Briefcase size={16} aria-hidden />
          Set as Work
        </button>
        {/* On a phone, signed in: send the place to the car, where it shows up ready to go. */}
        {user && isPhone() && (
          <button
            className="btn place-card__send"
            disabled={sending}
            onClick={async () => {
              setSending(true)
              try {
                await sendToCar({ ...place, name })
                s.showToast('Sent. It will show up in your car.')
              } catch {
                s.showToast('Couldn’t send it. Check the connection.')
              } finally {
                setSending(false)
              }
            }}
          >
            <PaperPlaneTilt size={16} aria-hidden />
            Send to car
          </button>
        )}
      </div>
    </section>
  )
}

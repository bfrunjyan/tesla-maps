import { useState } from 'react'
import { Briefcase, House, NavigationArrow, PencilSimple, Star, X } from '@phosphor-icons/react'
import { distance, formatDistance } from '../lib/geo'
import { startNavigation } from '../nav/controller'
import { useStore } from '../state/store'
import { RenameField } from './RenameField'

/** Shown for a tapped POI, a charger or a long-press dropped pin. */
export function PlaceCard() {
  const place = useStore((s) => s.selectedPlace)
  const position = useStore((s) => s.position)
  const favorites = useStore((s) => s.favorites)
  const [editing, setEditing] = useState(false)
  const s = useStore.getState()
  if (!place) return null
  const saved = favorites.find((f) => f.id === place.id)
  const fav = !!saved
  const name = saved?.name ?? place.name
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
          <p className="place-card__sub">{[place.address, dist].filter(Boolean).join(' · ')}</p>
        </div>
        {!editing && (
          <button className="icon-btn" aria-label="Rename" onClick={() => setEditing(true)}>
            <PencilSimple size={22} />
          </button>
        )}
        <button className="icon-btn" aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav} onClick={() => s.toggleFavorite({ ...place, name })}>
          <Star size={22} weight={fav ? 'fill' : 'bold'} className={fav ? 'is-fav' : undefined} />
        </button>
        <button className="icon-btn" aria-label="Close" onClick={() => s.set({ selectedPlace: null })}>
          <X size={22} weight="bold" />
        </button>
      </header>
      <div className="place-card__actions">
        <button className="btn btn--primary" onClick={() => startNavigation({ ...place, name })}>
          <NavigationArrow size={20} aria-hidden />
          Navigate
        </button>
        <button
          className="btn"
          onClick={() => {
            s.setHome({ ...place, name })
            s.showToast('Home saved')
          }}
        >
          <House size={18} aria-hidden />
          Set as Home
        </button>
        <button
          className="btn"
          onClick={() => {
            s.setWork({ ...place, name })
            s.showToast('Work saved')
          }}
        >
          <Briefcase size={18} aria-hidden />
          Set as Work
        </button>
      </div>
    </section>
  )
}

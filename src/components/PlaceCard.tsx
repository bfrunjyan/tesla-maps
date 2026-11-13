import { Briefcase, House, NavigationArrow, Star, X } from '@phosphor-icons/react'
import { distance, formatDistance } from '../lib/geo'
import { startNavigation } from '../nav/controller'
import { useStore } from '../state/store'

/** Shown for a tapped POI, a charger or a long-press dropped pin. */
export function PlaceCard() {
  const place = useStore((s) => s.selectedPlace)
  const position = useStore((s) => s.position)
  const favorites = useStore((s) => s.favorites)
  const s = useStore.getState()
  if (!place) return null
  const fav = favorites.some((f) => f.id === place.id)
  const dist = position ? formatDistance(distance([position.lon, position.lat], [place.lon, place.lat])) : ''

  return (
    <section className="surface card place-card" aria-label={place.name} key={place.id}>
      <header className="place-card__head">
        <div className="place-card__titles">
          <h2 className="place-card__title">{place.name}</h2>
          <p className="place-card__sub">{[place.address, dist].filter(Boolean).join(' · ')}</p>
        </div>
        <button className="icon-btn" aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav} onClick={() => s.toggleFavorite(place)}>
          <Star size={22} weight={fav ? 'fill' : 'bold'} className={fav ? 'is-fav' : undefined} />
        </button>
        <button className="icon-btn" aria-label="Close" onClick={() => s.set({ selectedPlace: null })}>
          <X size={22} weight="bold" />
        </button>
      </header>
      <div className="place-card__actions">
        <button className="btn btn--primary" onClick={() => startNavigation(place)}>
          <NavigationArrow size={20} aria-hidden />
          Navigate
        </button>
        <button
          className="btn"
          onClick={() => {
            s.setHome(place)
            s.showToast('Home saved')
          }}
        >
          <House size={18} aria-hidden />
          Set as Home
        </button>
        <button
          className="btn"
          onClick={() => {
            s.setWork(place)
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

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChargerFilterControl } from './ChargerBar'
import { RenameField } from './RenameField'
import { Bank, Briefcase, CircleNotch, ClockCounterClockwise, ForkKnife, House, Lightning, MagnifyingGlass, MapPin, PencilSimple, Star, X } from '@phosphor-icons/react'
import { chargerToPlace, isFast, nearestChargers } from '../lib/chargers'
import { distance, formatDistance } from '../lib/geo'
import { useLongPress } from '../lib/useLongPress'
import { FALLBACK_CENTER, startNavigation } from '../nav/controller'
import { categorySearch, searchPlaces, type CategoryKind } from '../services/search'
import { useStore, type SearchTab } from '../state/store'
import type { Place } from '../types'

const TABS: { id: SearchTab; label: string }[] = [
  { id: 'recents', label: 'Recents' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'charging', label: 'Charging' },
  { id: 'hungry', label: 'Hungry' },
  { id: 'lucky', label: 'Lucky' },
]

const EMPTY: Record<SearchTab, string> = {
  recents: 'Recent destinations will appear here.',
  favorites: 'Favorites will appear here. Tap star when viewing a place on the map to favorite.',
  charging: 'No charging stations found nearby.',
  hungry: 'No restaurants found nearby.',
  lucky: 'Nothing interesting found nearby. Try again somewhere else.',
}

function choosePlace(place: Place) {
  const s = useStore.getState()
  if (s.searchMode === 'set-home') {
    s.setHome(place)
    s.closePanel()
    s.showToast('Home saved')
  } else if (s.searchMode === 'set-work') {
    s.setWork(place)
    s.closePanel()
    s.showToast('Work saved')
  } else {
    startNavigation(place)
  }
}

/** Navigate to Home/Work when saved; otherwise (or on long press) set it. */
function useShortcut(kind: 'home' | 'work') {
  const place = useStore((s) => s[kind])
  const openPanel = useStore((s) => s.openPanel)
  const setMode = kind === 'home' ? 'set-home' : 'set-work'
  return useLongPress(
    () => (place ? startNavigation(place) : openPanel(setMode)),
    () => openPanel(setMode),
  )
}

export function SearchBox() {
  const panelOpen = useStore((s) => s.panelOpen)
  const searchMode = useStore((s) => s.searchMode)
  const query = useStore((s) => s.query)
  const set = useStore((s) => s.set)
  const openPanel = useStore((s) => s.openPanel)
  const closePanel = useStore((s) => s.closePanel)
  const inputRef = useRef<HTMLInputElement>(null)
  const home = useShortcut('home')
  const work = useShortcut('work')

  useEffect(() => {
    if (panelOpen) inputRef.current?.focus()
  }, [panelOpen])

  const placeholder =
    searchMode === 'set-home' ? 'Set Home address' : searchMode === 'set-work' ? 'Set Work address' : 'Navigate'

  return (
    <div className="search" data-open={panelOpen}>
      <div className="surface search-pill">
        {panelOpen ? (
          <>
            <MagnifyingGlass className="search-pill__icon" size={20} weight="bold" aria-hidden />
            <input
              ref={inputRef}
              className="search-pill__input"
              value={query}
              placeholder={placeholder}
              aria-label={placeholder}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closePanel()
              }}
            />
            <button className="icon-btn" aria-label="Close search" onClick={closePanel}>
              <X size={20} weight="bold" />
            </button>
          </>
        ) : (
          <>
            <button className="search-pill__trigger" onClick={() => openPanel()}>
              <MagnifyingGlass size={20} weight="bold" aria-hidden />
              <span>Navigate</span>
            </button>
            <button className="icon-btn" aria-label="Navigate home (hold to change)" {...home}>
              <House size={20} />
            </button>
            <button className="icon-btn" aria-label="Navigate to work (hold to change)" {...work}>
              <Briefcase size={20} />
            </button>
          </>
        )}
      </div>
      {panelOpen && <SearchPanel />}
    </div>
  )
}

function SearchPanel() {
  const query = useStore((s) => s.query.trim())
  const tab = useStore((s) => s.tab)
  const searchMode = useStore((s) => s.searchMode)
  const homePlace = useStore((s) => s.home)
  const workPlace = useStore((s) => s.work)
  const set = useStore((s) => s.set)
  const user = useStore((s) => s.user)
  const authReady = useStore((s) => s.authReady)
  const home = useShortcut('home')
  const work = useShortcut('work')

  return (
    <div className="surface panel" role="dialog" aria-label="Search">
      {searchMode === 'navigate' && (
        <div className="panel__shortcuts">
          <button className="shortcut" {...home}>
            <House size={20} aria-hidden />
            <span>Home</span>
            {!homePlace && <span className="shortcut__hint">Set</span>}
          </button>
          <button className="shortcut" {...work}>
            <Briefcase size={20} aria-hidden />
            <span>Work</span>
            {!workPlace && <span className="shortcut__hint">Set</span>}
          </button>
        </div>
      )}
      {searchMode === 'navigate' && !user && authReady && !query && (
        <button className="panel__signin" onClick={() => set({ panelOpen: false, accountOpen: true })}>
          Sign in to keep Home, Work and favorites on all your cars
        </button>
      )}
      {query ? (
        <SearchResults query={query} />
      ) : (
        <>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className="tab"
                onClick={() => set({ tab: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
          <TabContent tab={tab} />
        </>
      )}
    </div>
  )
}

function useOrigin() {
  const pos = useStore((s) => s.position)
  // Round so tiny GPS jitter doesn't refetch lists.
  const lon = pos ? Math.round(pos.lon * 500) / 500 : FALLBACK_CENTER.lon
  const lat = pos ? Math.round(pos.lat * 500) / 500 : FALLBACK_CENTER.lat
  return useMemo(() => ({ lon, lat }), [lon, lat])
}

function SearchResults({ query }: { query: string }) {
  const origin = useOrigin()
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; nearby: Place[]; further: Place[] }>({ status: 'loading', nearby: [], further: [] })

  useEffect(() => {
    const ctrl = new AbortController()
    setState((s) => ({ ...s, status: 'loading' }))
    const t = window.setTimeout(() => {
      searchPlaces(query, origin, ctrl.signal)
        .then((r) => setState({ status: 'done', ...r }))
        .catch(() => !ctrl.signal.aborted && setState({ status: 'error', nearby: [], further: [] }))
    }, 220)
    return () => {
      window.clearTimeout(t)
      ctrl.abort()
    }
  }, [query, origin])

  if (state.status === 'error') return <p className="empty">Search is unavailable right now. Check your connection.</p>
  if (state.status === 'done' && !state.nearby.length && !state.further.length) return <p className="empty">No results for “{query}”.</p>
  return (
    <div className="results">
      {state.status === 'done' && !state.nearby.length && <p className="results__note">Nothing called “{query}” nearby.</p>}
      <PlaceList places={state.nearby} loading={state.status === 'loading'} />
      {state.further.length > 0 && (
        <>
          <h3 className="results__heading">Further away</h3>
          <PlaceList places={state.further} />
        </>
      )}
    </div>
  )
}

const categoryCache = new Map<string, Place[]>()

function TabContent({ tab }: { tab: SearchTab }) {
  const recents = useStore((s) => s.recents)
  const favorites = useStore((s) => s.favorites)
  const origin = useOrigin()
  const kind: CategoryKind | null = tab === 'hungry' || tab === 'lucky' ? tab : null
  const cacheKey = kind && `${kind}:${origin.lon},${origin.lat}`
  const [state, setState] = useState<{ key: string | null; status: 'loading' | 'done' | 'error'; places: Place[] }>({ key: null, status: 'done', places: [] })

  useEffect(() => {
    if (!kind || !cacheKey) return
    const cached = categoryCache.get(cacheKey)
    if (cached) return setState({ key: cacheKey, status: 'done', places: cached })
    const ctrl = new AbortController()
    setState({ key: cacheKey, status: 'loading', places: [] })
    categorySearch(kind, origin, ctrl.signal)
      .then((places) => {
        let list = places
          .map((p) => ({ p, d: distance([origin.lon, origin.lat], [p.lon, p.lat]) }))
          .sort((a, b) => a.d - b.d)
          .map((x) => x.p)
        if (kind === 'lucky') list = shuffle(list).slice(0, 8)
        categoryCache.set(cacheKey, list)
        setState({ key: cacheKey, status: 'done', places: list })
      })
      .catch(() => !ctrl.signal.aborted && setState({ key: cacheKey, status: 'error', places: [] }))
    return () => ctrl.abort()
  }, [kind, cacheKey, origin])

  if (tab === 'recents') return recents.length ? <PlaceList places={recents} /> : <p className="empty">{EMPTY.recents}</p>
  if (tab === 'favorites') return favorites.length ? <PlaceList places={favorites} editable /> : <p className="empty">{EMPTY.favorites}</p>
  if (tab === 'charging') return <ChargingTab />
  if (state.status === 'error') return <p className="empty">Couldn’t load places right now. Try again in a moment.</p>
  if (state.status === 'done' && state.key === cacheKey && !state.places.length) return <p className="empty">{EMPTY[tab]}</p>
  return <PlaceList places={state.key === cacheKey ? state.places : []} loading={state.status === 'loading' || state.key !== cacheKey} />
}

/** Nearest charging stations, with the same All / Fast filter as the map. */
function ChargingTab() {
  const chargers = useStore((s) => s.chargers)
  const state = useStore((s) => s.chargersState)
  const filter = useStore((s) => s.chargerFilter)
  const origin = useOrigin()

  useEffect(() => {
    useStore.getState().loadChargers()
  }, [])

  const places = useMemo(() => nearestChargers(chargers, origin, filter).map((n) => chargerToPlace(n.charger)), [chargers, origin, filter])

  return (
    <div className="results">
      <div className="panel__filter">
        <ChargerFilterControl />
      </div>
      {state === 'error' ? (
        <p className="empty">Couldn’t load charging stations. Check your connection.</p>
      ) : state !== 'ready' ? (
        <PlaceList places={[]} loading />
      ) : places.length ? (
        <PlaceList places={places} />
      ) : (
        <p className="empty">{filter === 'fast' ? 'No fast chargers are listed yet. Switch to All to see every station.' : EMPTY.charging}</p>
      )}
    </div>
  )
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function PlaceIcon({ place }: { place: Place }) {
  const favorites = useStore((s) => s.favorites)
  const recents = useStore((s) => s.recents)
  if (favorites.some((f) => f.id === place.id)) return <Star size={20} />
  switch (place.category) {
    case 'charging': return <Lightning size={20} className={place.charger && isFast(place.charger) ? 'is-fast' : undefined} />
    case 'food': return <ForkKnife size={20} />
    case 'attraction': return <Bank size={20} />
    case 'home': return <House size={20} />
    case 'work': return <Briefcase size={20} />
  }
  if (recents.some((r) => r.id === place.id)) return <ClockCounterClockwise size={20} />
  return <MapPin size={20} />
}

function PlaceList({ places, loading, editable }: { places: Place[]; loading?: boolean; editable?: boolean }) {
  const origin = useStore((s) => s.position)
  const [editingId, setEditingId] = useState<string | null>(null)
  return (
    <div className="list" aria-busy={loading}>
      {loading && (
        <div className="list__loading" role="status">
          <CircleNotch weight="bold" className="spin" size={22} aria-hidden />
          <span>Searching…</span>
        </div>
      )}
      <ul>
        {places.map((p) => (
          <li key={p.id} className="row-wrap">
            {editingId === p.id ? (
              <div className="row row--editing">
                <span className="row__icon"><PlaceIcon place={p} /></span>
                <RenameField
                  initial={p.name}
                  onSave={(v) => {
                    useStore.getState().renamePlace(p, v)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <>
                <button className="row" onClick={() => choosePlace(p)}>
                  <span className="row__icon"><PlaceIcon place={p} /></span>
                  <span className="row__text">
                    <span className="row__title">{p.name}</span>
                    {p.address && <span className="row__sub">{p.address}</span>}
                  </span>
                  {origin && <span className="row__meta">{formatDistance(distance([origin.lon, origin.lat], [p.lon, p.lat]))}</span>}
                </button>
                {editable && (
                  <button className="icon-btn row__edit" aria-label={`Rename ${p.name}`} onClick={() => setEditingId(p.id)}>
                    <PencilSimple size={20} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

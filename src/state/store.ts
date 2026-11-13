import { create } from 'zustand'
import { load, save } from '../lib/storage'
import { api, type AuthMethods, type SavedPlaces, type User } from '../services/api'
import type { RouteOption } from '../nav/routeOptions'
import type { NavProgress, Place, Position, Route } from '../types'

export type SearchTab = 'recents' | 'favorites' | 'charging' | 'hungry' | 'lucky'
export type SearchMode = 'navigate' | 'set-home' | 'set-work'
export type Lang = 'en-US' | 'ru-RU'
export type ThemeSetting = 'auto' | 'light' | 'dark'
export type Theme = 'light' | 'dark'
export type MapDetail = 'auto' | 'full' | 'lite'
/** GPS health as the driver should see it. 'ok' shows nothing. */
export type GpsStatus = 'idle' | 'needs-permission' | 'finding' | 'ok' | 'weak' | 'lost' | 'denied' | 'unavailable'

export interface NavState {
  destination: Place
  route: Route | null
  progress: NavProgress | null
  status: 'routing' | 'choosing' | 'active' | 'rerouting' | 'arrived' | 'error'
  error?: string
  /** Route choices while status is 'choosing'. */
  options?: RouteOption[]
  selected?: number
}

interface Toast {
  id: number
  text: string
}

interface State {
  position: Position | null
  positionSource: 'gps' | 'fallback' | 'sim' | 'pending'
  gps: GpsStatus
  /** The location explainer sheet (before the browser prompt, or when blocked). */
  locationSheetOpen: boolean
  follow: boolean
  northUp: boolean
  threeD: boolean
  showPois: boolean
  showChargers: boolean
  chargers: Place[]
  toolsVisible: boolean
  mapBearing: number
  satellite: boolean
  showTraffic: boolean
  themeSetting: ThemeSetting
  /** Map detail setting; 'auto' uses autoLite, detected per car. */
  mapDetail: MapDetail
  autoLite: boolean
  theme: Theme
  settingsOpen: boolean

  panelOpen: boolean
  searchMode: SearchMode
  query: string
  tab: SearchTab

  selectedPlace: Place | null
  nav: NavState | null
  turnListOpen: boolean

  home: Place | null
  work: Place | null
  favorites: Place[]
  recents: Place[]

  voiceOn: boolean
  lang: Lang
  areaLabel: string
  toast: Toast | null

  /** Signed-in account, or null for a guest. Places sync to the account when set. */
  user: User | null
  authReady: boolean
  authMethods: AuthMethods | null
  accountOpen: boolean
}

interface Actions {
  set: (patch: Partial<State>) => void
  openPanel: (mode?: SearchMode) => void
  closePanel: () => void
  showToast: (text: string) => void
  setHome: (p: Place | null) => void
  setWork: (p: Place | null) => void
  toggleFavorite: (p: Place) => void
  isFavorite: (p: Place) => boolean
  /** Rename a saved favorite (synced) and the open place card, if it's the same place. */
  renamePlace: (p: Place, name: string) => void
  addRecent: (p: Place) => void
  setVoice: (on: boolean) => void
  setLang: (lang: Lang) => void
  /** Replace saved places (after sign-in / loading the account). */
  setPlaces: (p: SavedPlaces) => void
  /** Remove personal places from this device (sign-out). */
  clearPlaces: () => void
}

const samePlace = (a: Place, b: Place) =>
  a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5)

let toastSeq = 0

/** When signed in, mirror a change to the account; local state has already changed. */
function cloud(get: () => State & Actions, op: () => Promise<unknown>) {
  if (!get().user) return
  op().catch(() => get().showToast('Couldn’t save to your account. Check the connection.'))
}

export const useStore = create<State & Actions>((set, get) => ({
  position: null,
  positionSource: 'pending',
  gps: 'idle',
  locationSheetOpen: false,
  follow: true,
  northUp: load('northUp', false),
  threeD: load('threeD', true),
  showPois: load('showPois', false),
  showChargers: false,
  chargers: [],
  toolsVisible: false,
  mapBearing: 0,
  satellite: load('satellite', false),
  showTraffic: load('showTraffic', false),
  themeSetting: load<ThemeSetting>('themeSetting', 'auto'),
  mapDetail: load<MapDetail>('mapDetail', 'auto'),
  autoLite: load('autoLite', false),
  theme: 'dark',
  settingsOpen: false,

  panelOpen: false,
  searchMode: 'navigate',
  query: '',
  tab: 'favorites',

  selectedPlace: null,
  nav: null,
  turnListOpen: false,

  home: load<Place | null>('home', null),
  work: load<Place | null>('work', null),
  favorites: load<Place[]>('favorites', []),
  recents: load<Place[]>('recents', []),

  voiceOn: load('voiceOn', true),
  lang: load<Lang>('lang', 'en-US'),
  areaLabel: '',
  toast: null,

  user: null,
  authReady: false,
  authMethods: null,
  accountOpen: false,

  set: (patch) => {
    set(patch)
    for (const key of ['northUp', 'threeD', 'showPois', 'satellite', 'showTraffic', 'themeSetting', 'mapDetail', 'autoLite'] as const) {
      if (key in patch) save(key, patch[key])
    }
  },
  openPanel: (mode = 'navigate') => set({ panelOpen: true, searchMode: mode, query: '', selectedPlace: null }),
  closePanel: () => set({ panelOpen: false, searchMode: 'navigate', query: '' }),
  showToast: (text) => set({ toast: { id: ++toastSeq, text } }),
  setHome: (p) => {
    const home = p && { ...p, category: 'home' as const }
    save('home', home)
    set({ home })
    cloud(get, () => api.setHomeWork('home', home))
  },
  setWork: (p) => {
    const work = p && { ...p, category: 'work' as const }
    save('work', work)
    set({ work })
    cloud(get, () => api.setHomeWork('work', work))
  },
  toggleFavorite: (p) => {
    const favs = get().favorites
    const existing = favs.filter((f) => samePlace(f, p))
    const next = existing.length ? favs.filter((f) => !samePlace(f, p)) : [p, ...favs]
    save('favorites', next)
    set({ favorites: next })
    cloud(get, () => (existing.length ? Promise.all(existing.map((f) => api.removeFavorite(f.id))) : api.addFavorite(p)))
  },
  isFavorite: (p) => get().favorites.some((f) => samePlace(f, p)),
  renamePlace: (p, name) => {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!clean) return
    const saved = get().favorites.find((f) => samePlace(f, p))
    if (saved) {
      const renamed = { ...saved, name: clean }
      const next = get().favorites.map((f) => (f === saved ? renamed : f))
      save('favorites', next)
      set({ favorites: next })
      cloud(get, () => api.addFavorite(renamed))
    }
    const open = get().selectedPlace
    if (open && samePlace(open, p)) set({ selectedPlace: { ...open, name: clean } })
  },
  addRecent: (p) => {
    const next = [p, ...get().recents.filter((r) => !samePlace(r, p))].slice(0, 25)
    save('recents', next)
    set({ recents: next })
    cloud(get, () => api.addRecent(p))
  },
  setVoice: (on) => {
    save('voiceOn', on)
    set({ voiceOn: on })
  },
  setLang: (lang) => {
    save('lang', lang)
    set({ lang })
  },
  setPlaces: ({ home, work, favorites, recents }) => {
    save('home', home)
    save('work', work)
    save('favorites', favorites)
    save('recents', recents)
    set({ home, work, favorites, recents })
  },
  clearPlaces: () => get().setPlaces({ home: null, work: null, favorites: [], recents: [] }),
}))

/** Whether the lite map is in effect. */
export const isLite = (s: { mapDetail: MapDetail; autoLite: boolean }) => s.mapDetail === 'lite' || (s.mapDetail === 'auto' && s.autoLite)

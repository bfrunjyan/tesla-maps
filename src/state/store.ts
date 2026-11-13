import { create } from 'zustand'
import { load, save } from '../lib/storage'
import type { NavProgress, Place, Position, Route } from '../types'

export type SearchTab = 'recents' | 'favorites' | 'charging' | 'hungry' | 'lucky'
export type SearchMode = 'navigate' | 'set-home' | 'set-work'
export type Lang = 'en-US' | 'ru-RU'
export type ThemeSetting = 'auto' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export interface NavState {
  destination: Place
  route: Route | null
  progress: NavProgress | null
  status: 'routing' | 'active' | 'rerouting' | 'arrived' | 'error'
  error?: string
}

interface Toast {
  id: number
  text: string
}

interface State {
  position: Position | null
  positionSource: 'gps' | 'fallback' | 'sim' | 'pending'
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
  addRecent: (p: Place) => void
  setVoice: (on: boolean) => void
  setLang: (lang: Lang) => void
}

const samePlace = (a: Place, b: Place) =>
  a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5)

let toastSeq = 0

export const useStore = create<State & Actions>((set, get) => ({
  position: null,
  positionSource: 'pending',
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

  set: (patch) => {
    set(patch)
    for (const key of ['northUp', 'threeD', 'showPois', 'satellite', 'showTraffic', 'themeSetting'] as const) {
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
  },
  setWork: (p) => {
    const work = p && { ...p, category: 'work' as const }
    save('work', work)
    set({ work })
  },
  toggleFavorite: (p) => {
    const favs = get().favorites
    const next = favs.some((f) => samePlace(f, p)) ? favs.filter((f) => !samePlace(f, p)) : [p, ...favs]
    save('favorites', next)
    set({ favorites: next })
  },
  isFavorite: (p) => get().favorites.some((f) => samePlace(f, p)),
  addRecent: (p) => {
    const next = [p, ...get().recents.filter((r) => !samePlace(r, p))].slice(0, 25)
    save('recents', next)
    set({ recents: next })
  },
  setVoice: (on) => {
    save('voiceOn', on)
    set({ voiceOn: on })
  },
  setLang: (lang) => {
    save('lang', lang)
    set({ lang })
  },
}))

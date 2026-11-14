import { create } from 'zustand'
import { withNumberFirst } from '../lib/address'
import { load, save } from '../lib/storage'
import { api, type AuthMethods, type SavedPlaces, type User } from '../services/api'
import type { RouteOption } from '../nav/routeOptions'
import type { TrafficSpan } from '../nav/routeTraffic'
import type { SpeedSpan } from '../nav/speedLimits'
import type { ChargerFilter } from '../lib/chargers'
import { clampPct } from '../nav/battery'
import type { Battery, Charger, NavProgress, Place, Position, Route, TeslaLink, TeslaNote, Vehicle } from '../types'

export type SearchTab = 'recents' | 'favorites' | 'charging' | 'hungry' | 'lucky'
/** 'add-stop': the search panel opened from a trip, to add another place to it. */
export type SearchMode = 'navigate' | 'set-home' | 'set-work' | 'add-stop'
export type Lang = 'en-US' | 'ru-RU'
export type ThemeSetting = 'auto' | 'light' | 'dark'
export type Theme = 'light' | 'dark'
export type MapDetail = 'auto' | 'full' | 'lite'
/** 'google': the Google map with Google routing and traffic (a test, needs VITE_GOOGLE_MAPS_KEY). */
export type MapProvider = 'standard' | 'google'
/** GPS health as the driver should see it. 'ok' shows nothing. */
export type GpsStatus = 'idle' | 'needs-permission' | 'finding' | 'ok' | 'weak' | 'lost' | 'denied' | 'unavailable'

export interface NavState {
  /** The last place of the trip. */
  destination: Place
  /** Stops to make on the way, in order (see nav/stops.ts). */
  via?: Place[]
  /** The driver changed the trip's stops: the preview no longer starts by itself. */
  edited?: boolean
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
  chargers: Charger[]
  /** Google's stations near where the Google map has been (shown only on the Google map). */
  googleChargers: Charger[]
  chargersState: 'idle' | 'loading' | 'ready' | 'error'
  chargerFilter: ChargerFilter

  /** The driver's car and its battery level (for charge at arrival). */
  vehicle: Vehicle | null
  battery: Battery | null
  carSheetOpen: boolean
  /** Connect Tesla: the linked account and what the car last reported. */
  tesla: TeslaLink
  teslaNote: TeslaNote
  teslaBusy: boolean
  /** The connected Tesla is a different model or year than the chosen car: offer to match it. */
  carPrompt: boolean
  toolsVisible: boolean
  mapBearing: number
  satellite: boolean
  showTraffic: boolean
  /** While a route is shown, traffic is drawn on the route only; true shows it on all roads again for this trip. */
  trafficAllRoads: boolean
  /** Traffic along the route being shown (the chosen option, or the one being driven). */
  routeTraffic: { route: Route; spans: TrafficSpan[] } | null
  /** Posted speed limits along the route being driven (see nav/speedLimits.ts). */
  speedLimits: { route: Route; spans: SpeedSpan[] } | null
  themeSetting: ThemeSetting
  /** Map detail setting; 'auto' uses autoLite, detected per car. */
  mapDetail: MapDetail
  autoLite: boolean
  mapProvider: MapProvider
  theme: Theme
  settingsOpen: boolean

  panelOpen: boolean
  searchMode: SearchMode
  query: string
  tab: SearchTab

  selectedPlace: Place | null
  nav: NavState | null
  turnListOpen: boolean
  /** The trip's stops are open in the directions card (add, remove, reorder). */
  tripOpen: boolean
  /** The driver hid the turn-by-turn card; a small chip with the next turn stays. */
  guideHidden: boolean

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
  /** The driving history sheet (opened from the account). */
  historyOpen: boolean
  /** A place sent from the driver's phone, waiting to be shown (see nav/inbox.ts). */
  inbox: { place: Place; sentAt: string } | null
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
  /** Loads the charger feed (cached for 10 minutes). */
  loadChargers: () => Promise<void>
  /** Shows or hides chargers on the map. */
  toggleChargers: () => void
  /** Saves the car locally and, when signed in, to the account. `sync: false` when it came from the account. */
  setVehicle: (v: Vehicle | null, sync?: boolean) => void
  /** The driver set the battery level by hand. */
  setBattery: (pct: number) => void
  /** Mapic's running estimate while driving (keeps the time it was last set). */
  drainBattery: (deltaPct: number) => void
  setGuideHidden: (hidden: boolean) => void
  /** The Tesla link changed or the car sent a reading: the battery follows the car. */
  applyTesla: (link: TeslaLink, note?: TeslaNote) => void
  /** Replace saved places (after sign-in / loading the account). */
  setPlaces: (p: SavedPlaces) => void
  /** Remove personal places from this device (sign-out). */
  clearPlaces: () => void
}

export const samePlace = (a: Place, b: Place) =>
  a.id === b.id || (Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5)

export const NO_TESLA: TeslaLink = { enabled: false, connected: false, cars: [], vin: null, reading: null }

let toastSeq = 0
let chargersLoadedAt = 0

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
  googleChargers: [],
  chargersState: 'idle',
  chargerFilter: load<ChargerFilter>('chargerFilter', 'all'),

  vehicle: load<Vehicle | null>('vehicle', null),
  battery: load<Battery | null>('battery', null),
  carSheetOpen: false,
  tesla: NO_TESLA,
  teslaNote: null,
  teslaBusy: false,
  carPrompt: false,
  toolsVisible: false,
  mapBearing: 0,
  satellite: load('satellite', false),
  showTraffic: load('showTraffic', false),
  trafficAllRoads: false,
  routeTraffic: null,
  speedLimits: null,
  themeSetting: load<ThemeSetting>('themeSetting', 'auto'),
  mapDetail: load<MapDetail>('mapDetail', 'auto'),
  autoLite: load('autoLite', false),
  mapProvider: load<MapProvider>('mapProvider', 'standard'),
  theme: 'dark',
  settingsOpen: false,

  panelOpen: false,
  searchMode: 'navigate',
  query: '',
  tab: 'favorites',

  selectedPlace: null,
  nav: null,
  turnListOpen: false,
  tripOpen: false,
  guideHidden: load('guideHidden', false),

  // Places saved before addresses were written number first get the new order on load.
  home: withNumberFirst(load<Place | null>('home', null)),
  work: withNumberFirst(load<Place | null>('work', null)),
  favorites: load<Place[]>('favorites', []).map(withNumberFirst),
  recents: load<Place[]>('recents', []).map(withNumberFirst),

  voiceOn: load('voiceOn', true),
  lang: load<Lang>('lang', 'en-US'),
  areaLabel: '',
  toast: null,

  user: null,
  authReady: false,
  authMethods: null,
  accountOpen: false,
  historyOpen: false,
  inbox: null,

  set: (patch) => {
    set(patch)
    for (const key of ['northUp', 'threeD', 'showPois', 'satellite', 'showTraffic', 'themeSetting', 'mapDetail', 'autoLite', 'chargerFilter', 'mapProvider'] as const) {
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
  loadChargers: async () => {
    const s = get()
    if (s.chargersState === 'loading' || (s.chargersState === 'ready' && Date.now() - chargersLoadedAt < 600_000)) return
    set({ chargersState: 'loading' })
    try {
      const feed = await api.chargers()
      chargersLoadedAt = Date.now()
      set({ chargers: feed.chargers, chargersState: 'ready' })
    } catch {
      set({ chargersState: get().chargers.length ? 'ready' : 'error' })
    }
  },
  toggleChargers: () => {
    const on = !get().showChargers
    set({ showChargers: on })
    if (!on) return
    get()
      .loadChargers()
      .then(() => {
        const st = get()
        if (st.chargersState === 'error') {
          set({ showChargers: false })
          st.showToast('Couldn’t load charging stations')
        }
      })
  },
  setVehicle: (v, sync = true) => {
    save('vehicle', v)
    set({ vehicle: v })
    if (sync) cloud(get, () => api.setVehicle(v))
  },
  setBattery: (pct) => {
    const battery: Battery = { pct: clampPct(Math.round(pct)), at: Date.now(), source: 'manual' }
    save('battery', battery)
    set({ battery })
  },
  drainBattery: (deltaPct) => {
    const b = get().battery
    if (!b || deltaPct <= 0) return
    const battery = { ...b, pct: clampPct(b.pct - deltaPct) }
    save('battery', battery)
    set({ battery })
  },
  setGuideHidden: (hidden) => {
    save('guideHidden', hidden || null)
    set({ guideHidden: hidden, turnListOpen: false, tripOpen: false })
  },
  applyTesla: (link, note = null) => {
    const prev = get().battery
    let battery = prev
    if (link.connected && link.reading) {
      const at = Date.parse(link.reading.at)
      // A reading that was already applied keeps Mapic's estimate, lowered while driving since then.
      if (!(prev?.source === 'tesla' && prev.at >= at)) battery = { pct: link.reading.pct, at, source: 'tesla' }
    } else if (prev?.source === 'tesla') {
      // No longer read from the car: the level stays, and is the driver's to correct.
      battery = { ...prev, source: 'manual' }
    }
    if (battery !== prev) save('battery', battery)
    set({ tesla: link, teslaNote: note, battery })
  },
  setPlaces: (saved) => {
    const home = withNumberFirst(saved.home)
    const work = withNumberFirst(saved.work)
    const favorites = saved.favorites.map(withNumberFirst)
    const recents = saved.recents.map(withNumberFirst)
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

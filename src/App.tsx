import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrivalCard } from './components/ArrivalCard'
import { ChargerBar } from './components/ChargerBar'
import { CommuteCard } from './components/CommuteCard'
import { InboxCard } from './components/InboxCard'
import { GuidanceCard } from './components/GuidanceCard'
import { LocationSheet } from './components/Location'
import { SpeedSign } from './components/SpeedSign'
import { MapControls } from './components/MapControls'
import { PlaceCard } from './components/PlaceCard'
import { SearchBox } from './components/SearchBox'
import { MapView } from './map/MapView'
import { googleMapId, usingGoogle } from './services/googleMaps'
import { initLocation, resumeTrip, toggleSimulation } from './nav/controller'
import { rememberTrips, resumeIfInterrupted } from './nav/resume'
import { startInbox } from './nav/inbox'
import { startSpeedLimits } from './nav/speedSync'
import { startRouteTraffic } from './nav/trafficSync'
import { initSession } from './state/session'
import { useStore } from './state/store'

// Loaded on demand: sign-in screens and the phone link page aren't needed to show the map.
const AccountSheet = lazy(() => import('./components/AccountSheet').then((m) => ({ default: m.AccountSheet })))
const HistorySheet = lazy(() => import('./components/HistorySheet').then((m) => ({ default: m.HistorySheet })))
const CarSheet = lazy(() => import('./components/CarSheet').then((m) => ({ default: m.CarSheet })))
// The Google map (a test) is loaded only when switched on.
const GoogleMapView = lazy(() => import('./map/GoogleMapView').then((m) => ({ default: m.GoogleMapView })))
const LinkPage = lazy(() => import('./components/LinkPage').then((m) => ({ default: m.LinkPage })))

const DEV = new URLSearchParams(location.search).has('dev')

export default function App() {
  useEffect(() => {
    initSession()
  }, [])
  // Phone page opened from the car's sign-in QR code.
  if (location.pathname === '/link') {
    return (
      <>
        <Suspense fallback={null}>
          <LinkPage />
        </Suspense>
        <Toast />
      </>
    )
  }
  return <MapApp />
}

function MapApp() {
  const nav = useStore((s) => s.nav)
  const panelOpen = useStore((s) => s.panelOpen)
  const selectedPlace = useStore((s) => s.selectedPlace)
  const areaLabel = useStore((s) => s.areaLabel)
  const closePanel = useStore((s) => s.closePanel)
  const accountOpen = useStore((s) => s.accountOpen)
  const historyOpen = useStore((s) => s.historyOpen)
  const inbox = useStore((s) => !!s.inbox)
  const carSheetOpen = useStore((s) => s.carSheetOpen)
  const chargerBar = useStore((s) => s.showChargers && !s.nav)
  const google = useStore((s) => usingGoogle(s))
  // Google's dark or light map, and its Map ID (with or without places), are chosen when
  // the map is made, so changing either makes a new map.
  const theme = useStore((s) => s.theme)
  const googleId = useStore((s) => googleMapId(s.showPois))
  // Adding a stop to a trip: the search takes the place of the trip card until a place is picked.
  const addingStop = useStore((s) => s.panelOpen && s.searchMode === 'add-stop')

  useEffect(() => {
    initLocation()
    startRouteTraffic()
    // A trip cut short by a crash or reload carries on by itself.
    rememberTrips()
    resumeIfInterrupted(resumeTrip)
    startSpeedLimits()
    startInbox()
  }, [])

  return (
    <div className="app" data-charger-bar={chargerBar}>
      {google ? (
        <Suspense fallback={null}>
          <GoogleMapView key={`${theme}-${googleId}`} />
        </Suspense>
      ) : (
        <MapView />
      )}
      <div className="scrim" data-visible={panelOpen} onClick={closePanel} aria-hidden />
      <div className="left-column">
        {nav && !addingStop ? <GuidanceCard /> : <SearchBox />}
        {nav && !addingStop && <ArrivalCard />}
        {!nav && !panelOpen && selectedPlace && <PlaceCard />}
        {!nav && !panelOpen && <InboxCard />}
        {!nav && !panelOpen && !selectedPlace && !inbox && <CommuteCard />}
      </div>
      <MapControls />
      {areaLabel && <div className="area-label">{areaLabel}</div>}
      <SpeedSign />
      {accountOpen && (
        <Suspense fallback={null}>
          <AccountSheet />
        </Suspense>
      )}
      {historyOpen && (
        <Suspense fallback={null}>
          <HistorySheet />
        </Suspense>
      )}
      {/* One sheet at a time: the location explainer waits behind the account, history and car sheets. */}
      {!accountOpen && !carSheetOpen && !historyOpen && <LocationSheet />}
      {carSheetOpen && (
        <Suspense fallback={null}>
          <CarSheet />
        </Suspense>
      )}
      <ChargerBar />
      <Toast />
      {DEV && <DevBar />}
    </div>
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const t = window.setTimeout(() => setVisible(false), 2600)
    return () => window.clearTimeout(t)
  }, [toast])
  return (
    <div className="toast" role="status" aria-live="polite" data-visible={visible}>
      {toast?.text}
    </div>
  )
}

/** Testing aids, shown with ?dev in the URL. */
function DevBar() {
  const lang = useStore((s) => s.lang)
  const source = useStore((s) => s.positionSource)
  const [sim, setSim] = useState(false)
  return (
    <div className="devbar surface">
      <span>GPS: {source}</span>
      <button className="btn btn--sm" onClick={() => setSim(toggleSimulation())}>
        {sim ? 'Stop drive' : 'Simulate drive'}
      </button>
      <button className="btn btn--sm" onClick={() => useStore.getState().setLang(lang === 'en-US' ? 'ru-RU' : 'en-US')}>
        Voice: {lang === 'en-US' ? 'English' : 'Русский'}
      </button>
    </div>
  )
}

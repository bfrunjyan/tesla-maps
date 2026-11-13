import { useEffect, useState } from 'react'
import { AccountSheet } from './components/AccountSheet'
import { GuidanceCard } from './components/GuidanceCard'
import { LinkPage } from './components/LinkPage'
import { LocationSheet } from './components/Location'
import { MapControls } from './components/MapControls'
import { PlaceCard } from './components/PlaceCard'
import { SearchBox } from './components/SearchBox'
import { MapView } from './map/MapView'
import { initLocation, toggleSimulation } from './nav/controller'
import { initSession } from './state/session'
import { useStore } from './state/store'

const DEV = new URLSearchParams(location.search).has('dev')

export default function App() {
  useEffect(() => {
    initSession()
  }, [])
  // Phone page opened from the car's sign-in QR code.
  if (location.pathname === '/link') {
    return (
      <>
        <LinkPage />
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

  useEffect(() => {
    initLocation()
  }, [])

  return (
    <div className="app">
      <MapView />
      <div className="scrim" data-visible={panelOpen} onClick={closePanel} aria-hidden />
      <div className="left-column">
        {nav ? <GuidanceCard /> : <SearchBox />}
        {!nav && !panelOpen && selectedPlace && <PlaceCard />}
      </div>
      <MapControls />
      {areaLabel && <div className="area-label">{areaLabel}</div>}
      <AccountSheet />
      <LocationSheet />
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

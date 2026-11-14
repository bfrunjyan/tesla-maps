import { useEffect, type ReactNode } from 'react'
import { Car, Cube, GearSix, GlobeHemisphereEast, Lightning, MapPin, NavigationArrow, TrafficSignal, UserCircle } from '@phosphor-icons/react'
import { cardinal } from '../lib/geo'
import { trafficTileUrl } from '../map/style'
import { usingGoogle } from '../services/googleMaps'
import { isLite, useStore } from '../state/store'
import { BatteryIcon } from './BatteryIcon'
import { GpsIndicator } from './Location'
import { SettingsPopover } from './SettingsPopover'

const HIDE_AFTER_MS = 6000
const MAPBOX_TRAFFIC = !!trafficTileUrl()

function Tool({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className="tool" aria-label={label} aria-pressed={active} data-active={active} onClick={onClick}>
      {children}
    </button>
  )
}

export function MapControls() {
  const northUp = useStore((s) => s.northUp)
  const follow = useStore((s) => s.follow)
  const bearing = useStore((s) => s.mapBearing)
  const toolsVisible = useStore((s) => s.toolsVisible)
  const threeD = useStore((s) => s.threeD)
  const showPois = useStore((s) => s.showPois)
  const showChargers = useStore((s) => s.showChargers)
  const satellite = useStore((s) => s.satellite)
  const showTraffic = useStore((s) => s.showTraffic)
  const trafficAllRoads = useStore((s) => s.trafficAllRoads)
  const inRoute = useStore((s) => !!s.nav)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const lite = useStore(isLite)
  const user = useStore((s) => s.user)
  const vehicle = useStore((s) => s.vehicle)
  const battery = useStore((s) => s.battery)
  const charging = useStore((s) => s.battery?.source === 'tesla' && s.tesla.reading?.charging === 'charging')
  const google = useStore((s) => usingGoogle(s))
  // The Google map has its own traffic; the standard map needs the Mapbox token.
  const HAS_TRAFFIC = google || MAPBOX_TRAFFIC
  const s = useStore.getState()

  // Tools hide themselves after a few seconds without interaction, like in the car.
  useEffect(() => {
    if (!toolsVisible || settingsOpen) return
    const t = window.setTimeout(() => useStore.getState().set({ toolsVisible: false }), HIDE_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [toolsVisible, settingsOpen, threeD, showPois, showChargers, northUp, satellite, showTraffic, trafficAllRoads])

  // Settings close together with the tool column.
  useEffect(() => {
    if (!toolsVisible && settingsOpen) useStore.getState().set({ settingsOpen: false })
  }, [toolsVisible, settingsOpen])

  const trafficOn = HAS_TRAFFIC && showTraffic && (!inRoute || trafficAllRoads)
  const toggleTraffic = () => {
    if (!HAS_TRAFFIC) return s.showToast('Traffic needs a Mapbox token (VITE_MAPBOX_TOKEN)')
    // With a route on screen the route itself shows its traffic; this button then
    // adds or removes traffic on the other roads, for this trip only.
    if (!inRoute) return s.set({ showTraffic: !showTraffic })
    if (trafficOn) s.set({ trafficAllRoads: false })
    else s.set({ showTraffic: true, trafficAllRoads: true })
  }

  return (
    <div className="controls">
      <div className="controls__top">
      <GpsIndicator />
      <button
        className="surface battery-chip"
        aria-label={battery ? `Battery ${Math.round(battery.pct)} percent${charging ? ', charging' : ''}. Open car and battery` : vehicle ? 'Set battery level' : 'Choose your car'}
        onClick={() => s.set({ carSheetOpen: true, toolsVisible: false })}
      >
        {battery ? (
          <>
            <BatteryIcon pct={battery.pct} size={21} charging={charging} />
            <span className="battery-chip__pct">{Math.round(battery.pct)}%</span>
          </>
        ) : (
          <Car size={22} />
        )}
      </button>
      <button
        className="surface account-btn"
        aria-label={user ? `Account: ${user.email}` : 'Sign in'}
        onClick={() => s.set({ accountOpen: true, toolsVisible: false })}
      >
        {user ? <span className="avatar" aria-hidden>{(user.name ?? user.email)[0].toUpperCase()}</span> : <UserCircle size={24} />}
      </button>
      <button
        className="surface compass"
        aria-label={northUp ? 'North up. Switch to heading up' : 'Heading up. Switch to north up'}
        onClick={() => s.set({ northUp: !northUp, follow: true })}
      >
        <span className="compass__label">{northUp ? 'N' : cardinal(bearing)}</span>
        <svg className="compass__needle" viewBox="0 0 24 24" width="22" height="22" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden>
          <path d="M12 3 18 19 12 15.5 6 19Z" fill="currentColor" />
        </svg>
      </button>
      </div>

      {!follow && (
        <button className="surface tool-solo" aria-label="Recenter on car" onClick={() => s.set({ follow: true })}>
          <NavigationArrow size={22} />
        </button>
      )}

      <div className="tools-wrap">
        <div className="surface tools" data-visible={toolsVisible} aria-hidden={!toolsVisible}>
          <Tool label="Satellite view" active={satellite} onClick={() => s.set({ satellite: !satellite })}>
            <GlobeHemisphereEast size={24} />
          </Tool>
          <Tool label={inRoute ? 'Traffic on other roads' : 'Traffic'} active={trafficOn} onClick={toggleTraffic}>
            <TrafficSignal size={24} />
          </Tool>
          <Tool label="Show places" active={showPois} onClick={() => s.set({ showPois: !showPois })}>
            <MapPin size={24} />
          </Tool>
          <Tool label="Show charging stations" active={showChargers} onClick={s.toggleChargers}>
            <Lightning size={24} />
          </Tool>
          <Tool
            label="3D buildings"
            active={threeD && !lite}
            onClick={() => (lite ? s.showToast('3D buildings are off on the lite map. Change it in Settings → Map detail.') : s.set({ threeD: !threeD }))}
          >
            <Cube size={24} />
          </Tool>
          <Tool label="Map settings" active={settingsOpen} onClick={() => s.set({ settingsOpen: !settingsOpen })}>
            <GearSix size={24} />
          </Tool>
        </div>
        {settingsOpen && toolsVisible && <SettingsPopover />}
      </div>
    </div>
  )
}

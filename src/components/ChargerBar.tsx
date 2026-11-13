import { Lightning } from '@phosphor-icons/react'
import { filterChargers } from '../lib/chargers'
import { useStore } from '../state/store'

/** All / Fast switch. One bolt = every station, three bolts = fast (50 kW+), like the car's charger filter. */
export function ChargerFilterControl({ counts = false }: { counts?: boolean }) {
  const filter = useStore((s) => s.chargerFilter)
  const chargers = useStore((s) => s.chargers)
  const set = useStore((s) => s.set)
  const fastCount = counts ? filterChargers(chargers, 'fast').length : 0
  return (
    <div className="segmented charger-filter" role="radiogroup" aria-label="Charger speed">
      <button role="radio" aria-checked={filter === 'all'} className="segmented__opt" onClick={() => set({ chargerFilter: 'all' })}>
        <Lightning size={16} aria-hidden />
        All{counts && <span className="charger-filter__count">{chargers.length}</span>}
      </button>
      <button role="radio" aria-checked={filter === 'fast'} className="segmented__opt" onClick={() => set({ chargerFilter: 'fast' })}>
        <span className="bolts" aria-hidden>
          <Lightning size={16} />
          <Lightning size={16} />
          <Lightning size={16} />
        </span>
        Fast{counts && <span className="charger-filter__count">{fastCount}</span>}
      </button>
    </div>
  )
}

/** Shown at the bottom of the map while chargers are displayed. */
export function ChargerBar() {
  const show = useStore((s) => s.showChargers)
  const state = useStore((s) => s.chargersState)
  const nav = useStore((s) => s.nav)
  if (!show || nav) return null
  return (
    <div className="surface charger-bar" role="region" aria-label="Charging stations">
      {state === 'loading' ? <span className="charger-bar__status" role="status">Loading chargers…</span> : <ChargerFilterControl counts />}
    </div>
  )
}

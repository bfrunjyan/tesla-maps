import { CircleHalf, Moon, Sun } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { googleKey } from '../services/googleMaps'
import { isLite, useStore, type Lang, type MapDetail, type MapProvider, type ThemeSetting } from '../state/store'

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="setting">
      <span className="setting__label" id={`setting-${label}`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`setting-${label}`}>
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={value === o.value} className="segmented__opt" onClick={() => onChange(o.value)}>
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Map settings: appearance (like the car’s Auto / Light / Dark), map detail and voice language. */
export function SettingsPopover() {
  const themeSetting = useStore((s) => s.themeSetting)
  const theme = useStore((s) => s.theme)
  const lang = useStore((s) => s.lang)
  const mapDetail = useStore((s) => s.mapDetail)
  const lite = useStore(isLite)
  const provider = useStore((s) => s.mapProvider)
  const s = useStore.getState()

  return (
    <div className="surface popover" role="dialog" aria-label="Map settings">
      <Segmented<ThemeSetting>
        label="Appearance"
        value={themeSetting}
        onChange={(v) => s.set({ themeSetting: v })}
        options={[
          { value: 'auto', label: 'Auto', icon: <CircleHalf size={18} /> },
          { value: 'light', label: 'Light', icon: <Sun size={18} /> },
          { value: 'dark', label: 'Dark', icon: <Moon size={18} /> },
        ]}
      />
      {themeSetting === 'auto' && (
        <p className="setting__hint">
          Now {theme}. Follows your display’s dark mode, otherwise sunrise and sunset where you are.
        </p>
      )}
      <Segmented<MapDetail>
        label="Map detail"
        value={mapDetail}
        onChange={(v) => s.set({ mapDetail: v })}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'full', label: 'Full' },
          { value: 'lite', label: 'Lite' },
        ]}
      />
      {mapDetail === 'auto' && (
        <p className="setting__hint">
          {lite ? 'Lite on this car, for smoother driving: flat buildings, lighter graphics.' : 'Full detail. Switches to lite if this car draws the map slowly.'}
        </p>
      )}
      {googleKey() && (
        <>
          <Segmented<MapProvider>
            label="Map"
            value={provider}
            onChange={(v) => s.set({ mapProvider: v })}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'google', label: 'Google (test)' },
            ]}
          />
          {provider === 'google' && (
            <p className="setting__hint">Google’s map, routes and traffic. Routes planned from now on use Google. Charger pins aren’t on this map yet.</p>
          )}
        </>
      )}
      <Segmented<Lang>
        label="Voice"
        value={lang}
        onChange={(v) => s.setLang(v)}
        options={[
          { value: 'en-US', label: 'English' },
          { value: 'ru-RU', label: 'Русский' },
        ]}
      />
    </div>
  )
}

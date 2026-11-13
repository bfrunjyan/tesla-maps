import { CircleHalf, Moon, Sun } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { useStore, type Lang, type ThemeSetting } from '../state/store'

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

/** Map settings: appearance (like the car's Auto / Light / Dark) and voice language. */
export function SettingsPopover() {
  const themeSetting = useStore((s) => s.themeSetting)
  const theme = useStore((s) => s.theme)
  const lang = useStore((s) => s.lang)
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

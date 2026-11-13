import { FALLBACK_CENTER } from '../nav/controller'
import { useStore, type Theme } from '../state/store'

/**
 * Sunrise/sunset for a date and place (the suncalc algorithm).
 * Returns null near the poles, where the sun may not rise or set.
 */
export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } | null {
  const rad = Math.PI / 180
  const dayMs = 86400000
  const J1970 = 2440588
  const J2000 = 2451545
  const toDays = (d: Date) => d.valueOf() / dayMs - 0.5 + J1970 - J2000
  const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * dayMs)

  const lw = rad * -lon
  const phi = rad * lat
  const n = Math.round(toDays(date) - 0.0009 - lw / (2 * Math.PI))
  const ds = 0.0009 + lw / (2 * Math.PI) + n
  const M = rad * (357.5291 + 0.98560028 * ds)
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + rad * 102.9372 + Math.PI
  const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L))
  const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
  const cosW = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
  if (cosW < -1 || cosW > 1) return null
  const w = Math.acos(cosW)
  const jSet = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
  const jRise = jNoon - (jSet - jNoon)
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) }
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined

/**
 * Auto mode, like the car's: dark if the browser says the display is dark,
 * otherwise dark between sunset and sunrise at the car's location.
 * (A browser that never reports dark is the common case, so "light" from
 * the browser is not trusted on its own.)
 */
function resolveAuto(): Theme {
  if (darkQuery?.matches) return 'dark'
  const pos = useStore.getState().position ?? FALLBACK_CENTER
  const now = new Date()
  const t = sunTimes(now, pos.lat, pos.lon)
  if (!t) return now.getHours() >= 7 && now.getHours() < 19 ? 'light' : 'dark'
  return now > t.sunrise && now < t.sunset ? 'light' : 'dark'
}

function update() {
  const s = useStore.getState()
  const theme: Theme = s.themeSetting === 'auto' ? resolveAuto() : s.themeSetting
  if (theme !== s.theme) s.set({ theme })
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1c1b1c' : '#f4f4f4')
}

export function startThemeWatcher() {
  update()
  darkQuery?.addEventListener?.('change', update)
  const timer = window.setInterval(update, 60_000)
  const unsub = useStore.subscribe((s, prev) => {
    if (s.themeSetting !== prev.themeSetting || (!prev.position && s.position)) update()
  })
  return () => {
    darkQuery?.removeEventListener?.('change', update)
    window.clearInterval(timer)
    unsub()
  }
}

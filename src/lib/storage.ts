/**
 * Per-device persistence for Home/Work, favorites, recents and settings.
 * Storage can be unavailable (private mode, blocked site data), so every
 * access is guarded and the app works without it.
 */
const PREFIX = 'carnav:'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

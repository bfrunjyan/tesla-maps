/**
 * Google Maps (test): the key, the map script, and whether the driver has switched
 * to it. Google's terms allow its routes and traffic only on a Google map, so the
 * Google map and Google routing are switched on together (Settings → Map).
 */
import { useStore } from '../state/store'

export function googleKey(): string | null {
  return (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) || null
}

/**
 * The Google map's look: the "Mapic ID" Map ID in the Google Cloud console, a vector
 * JavaScript map with Google's Monochrome style for light mode and Google's Dark style
 * for dark mode. A Map ID is not a secret; VITE_GOOGLE_MAP_ID can point at another one.
 */
const MAPIC_MAP_ID = '2fe7d8736e3feaf45574c39f'

export function googleMapId(): string {
  return (import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined) || MAPIC_MAP_ID
}

/** Whether Mapic is using the Google map and Google routing now. */
export function usingGoogle(s: { mapProvider: 'standard' | 'google' } = useStore.getState()) {
  return s.mapProvider === 'google' && !!googleKey()
}

let loading: Promise<void> | null = null

/**
 * Loads Google's map script once. Rejects when it can't load, or when Google refuses
 * the key (wrong key, Maps JavaScript API not enabled, or this site not allowed).
 */
export function loadGoogleMaps(language: string): Promise<void> {
  const key = googleKey()
  if (!key) return Promise.reject(new Error('No Google Maps key'))
  if (loading) return loading
  loading = new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>
    w.__mapicGoogleReady = () => resolve()
    // Google calls this when it refuses the key, after the script has loaded.
    w.gm_authFailure = () => {
      loading = null
      useStore.getState().set({ mapProvider: 'standard' })
      useStore.getState().showToast('Google refused the map key. Back on the standard map.')
      reject(new Error('Google refused the key'))
    }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=${language}&callback=__mapicGoogleReady`
    s.async = true
    s.onerror = () => {
      loading = null
      s.remove()
      reject(new Error('Google Maps failed to load'))
    }
    document.head.appendChild(s)
  })
  return loading
}

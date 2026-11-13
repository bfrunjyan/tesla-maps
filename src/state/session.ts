import { load, save } from '../lib/storage'
import { api, type User } from '../services/api'
import { useStore } from './store'

/**
 * Whose places are cached on this device: a user id, or null for guest data.
 * Guest data is merged into the account on sign-in; another account's cache is discarded.
 */
const OWNER_KEY = 'placesOwner'
const get = () => useStore.getState()

async function loadAccount(user: User, { fresh }: { fresh: boolean }) {
  const owner = load<string | null>(OWNER_KEY, null)
  const s = get()
  if (owner && owner !== user.id) s.clearPlaces()
  const hasGuestData = !owner && (s.home || s.work || s.favorites.length || s.recents.length)
  const places = hasGuestData
    ? await api.importPlaces({ home: s.home, work: s.work, favorites: s.favorites, recents: s.recents })
    : await api.places()
  save(OWNER_KEY, user.id)
  get().setPlaces(places)
  if (fresh && hasGuestData) get().showToast('Places from this car were added to your account')
}

/** Called once at startup: restores the session cookie's account, if any. */
export async function initSession() {
  const params = new URLSearchParams(location.search)
  const authError = params.get('auth_error')
  if (authError) {
    params.delete('auth_error')
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`)
    get().showToast(authError)
  }
  try {
    const [{ methods }, { user }] = await Promise.all([api.config(), api.me()])
    get().set({ authMethods: methods, user })
    if (user) await loadAccount(user, { fresh: false })
    else if (load<string | null>(OWNER_KEY, null)) {
      // Session ended elsewhere (signed out, expired): don't leave someone's places on screen.
      get().clearPlaces()
      save(OWNER_KEY, null)
    }
  } catch {
    /* offline or API down: keep cached places, try again next load */
  } finally {
    get().set({ authReady: true })
  }
}

export async function completeSignIn(user: User) {
  get().set({ user, accountOpen: false })
  try {
    await loadAccount(user, { fresh: true })
    get().showToast(`Signed in as ${user.email}`)
  } catch {
    get().showToast('Signed in, but your places couldn’t load. They’ll sync next time.')
  }
}

function forgetDevice() {
  get().clearPlaces()
  save(OWNER_KEY, null)
  get().set({ user: null, accountOpen: false })
}

export async function signOut() {
  try {
    await api.logout()
  } finally {
    forgetDevice()
    get().showToast('Signed out. Your places were removed from this car.')
  }
}

export async function deleteAccount() {
  await api.deleteAccount()
  forgetDevice()
  get().showToast('Your account and saved places were deleted.')
}

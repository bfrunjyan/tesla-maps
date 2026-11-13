import { load, save } from '../lib/storage'
import { api, ApiError, type User } from '../services/api'
import { forgetTesla, loadTesla, readTesla, showTeslaOutcome, startTeslaSync } from '../vehicle/tesla'
import { useStore } from './store'

/**
 * Whose places are cached on this device: a user id, or null for guest data.
 * Guest data is merged into the account on sign-in; another account's cache is discarded.
 */
const OWNER_KEY = 'placesOwner'
/** "Remember this car": survives if the car's browser wipes cookies but keeps local storage. */
const REMEMBER_KEY = 'remember'
const get = () => useStore.getState()

/** Keep a fresh remember token on this device (replacing the previous one). */
async function refreshRememberToken() {
  try {
    const { token } = await api.remember(load<string | null>(REMEMBER_KEY, null))
    save(REMEMBER_KEY, token)
  } catch {
    /* not critical: the session cookie still works */
  }
}

/** Cookie gone? Trade the remember token for a new session, silently. */
async function resumeFromToken() {
  const token = load<string | null>(REMEMBER_KEY, null)
  if (!token) return null
  try {
    const r = await api.resume(token)
    save(REMEMBER_KEY, r.token)
    return r.user
  } catch (err) {
    // Expired, revoked or already used: forget it. (Network errors keep it for next time.)
    if (err instanceof ApiError && err.status === 401) save(REMEMBER_KEY, null)
    return null
  }
}

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
  // The car: the account's choice wins; a car picked before signing in is saved to the account.
  try {
    const { vehicle } = await api.vehicle()
    if (vehicle) get().setVehicle(vehicle, false)
    else if (get().vehicle) await api.setVehicle(get().vehicle)
  } catch {
    /* keep the local choice; it syncs on the next change */
  }
  if (fresh && hasGuestData) get().showToast('Places from this car were added to your account')
}

/** Called once at startup: restores the session cookie's account, if any. */
export async function initSession() {
  const params = new URLSearchParams(location.search)
  const authError = params.get('auth_error')
  const teslaOutcome = params.get('tesla')
  if (authError || teslaOutcome) {
    params.delete('auth_error')
    params.delete('tesla')
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}`)
    if (authError) get().showToast(authError)
  }
  try {
    const [{ methods }, me] = await Promise.all([api.config(), api.me()])
    let user = me.user
    if (user) {
      if (!load<string | null>(REMEMBER_KEY, null)) refreshRememberToken()
    } else {
      user = await resumeFromToken()
    }
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
  // Connect Tesla: the linked car's level, then keep it current while the app is open.
  await loadTesla()
  showTeslaOutcome(teslaOutcome)
  startTeslaSync()
  readTesla('open')
}

export async function completeSignIn(user: User) {
  get().set({ user, accountOpen: false })
  refreshRememberToken()
  try {
    await loadAccount(user, { fresh: true })
    get().showToast(`Signed in as ${user.email}`)
    loadTesla().then(() => readTesla('open'))
  } catch {
    get().showToast('Signed in, but your places couldn’t load. They’ll sync next time.')
  }
}

function forgetDevice() {
  get().clearPlaces()
  save(OWNER_KEY, null)
  save(REMEMBER_KEY, null)
  get().set({ user: null, accountOpen: false })
  forgetTesla()
}

export async function signOut() {
  try {
    await api.logout(load<string | null>(REMEMBER_KEY, null))
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

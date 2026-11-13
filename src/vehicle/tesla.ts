import { api } from '../services/api'
import { NO_TESLA, useStore } from '../state/store'
import { findModel } from './catalog'
import { shouldRead, type ReadEvent } from './liveBattery'

/**
 * Connect Tesla on this device: loads the link, and asks the car for its battery
 * when it matters (see liveBattery.ts for when).
 */
const get = () => useStore.getState()
let lastAsked = 0
let asking: Promise<void> | null = null

/** Loads whether Connect Tesla is offered and, when signed in, the linked car and its last reading. */
export async function loadTesla() {
  try {
    get().applyTesla(await api.teslaStatus())
  } catch {
    /* offline: keep what is on screen */
  }
}

/** Asks the car for its battery if this is a good moment. Resolves when done (or skipped). */
export function readTesla(event: ReadEvent): Promise<void> {
  const s = get()
  const moving = s.positionSource !== 'fallback' && (s.position?.speed ?? 0) > 1.5
  const ok = shouldRead({
    event,
    connected: s.tesla.connected && !!s.user,
    visible: document.visibilityState === 'visible',
    sinceLastMs: lastAsked ? Date.now() - lastAsked : Infinity,
    moving,
    charging: s.tesla.reading?.charging === 'charging',
    navigating: s.nav?.status === 'active' || s.nav?.status === 'rerouting',
  })
  if (!ok) return Promise.resolve()
  if (asking) return asking
  lastAsked = Date.now()
  s.set({ teslaBusy: true })
  asking = api
    .teslaRead()
    .then(({ note, ...link }) => get().applyTesla(link, note))
    .catch(() => get().set({ teslaNote: 'unavailable' }))
    .finally(() => {
      asking = null
      get().set({ teslaBusy: false })
    })
  return asking
}

/**
 * The car Mapic reads says (through its VIN) which model and year it is. When that
 * differs from the car chosen for estimates, the car sheet offers to match it.
 */
function checkChosenCar() {
  const s = get()
  const car = s.tesla.cars.find((c) => c.vin === s.tesla.vin)
  if (!s.tesla.connected || !s.vehicle || !car?.model || !findModel(car.model)) return
  const differs = s.vehicle.model !== car.model || (car.year != null && s.vehicle.year !== car.year)
  s.set({ carPrompt: differs })
}

let started = false
/** Keeps the level current while the app is open. Safe to call more than once. */
export function startTeslaSync() {
  if (started) return
  started = true
  window.setInterval(() => readTesla('tick'), 30_000)
  document.addEventListener('visibilitychange', () => readTesla('visible'))
  // A route was just planned: charge at arrival should start from the real level.
  useStore.subscribe((s, prev) => {
    if (s.nav?.status === 'choosing' && prev.nav?.status !== 'choosing') readTesla('route')
  })
}

export function connectTesla() {
  const s = get()
  if (!s.user) {
    s.set({ carSheetOpen: false, accountOpen: true })
    s.showToast('Sign in to Mapic first, then connect your Tesla')
    return
  }
  location.assign(api.teslaStartUrl)
}

export async function disconnectTesla() {
  const s = get()
  try {
    await api.teslaDisconnect()
    s.applyTesla({ ...NO_TESLA, enabled: s.tesla.enabled })
    s.showToast('Tesla disconnected. Set the battery level by hand from now on.')
  } catch {
    s.showToast('Couldn’t disconnect. Check the connection and try again.')
  }
}

export async function chooseTeslaCar(vin: string) {
  try {
    get().applyTesla(await api.teslaCar(vin))
    checkChosenCar()
    lastAsked = 0
    await readTesla('manual')
  } catch {
    get().showToast('Couldn’t switch cars. Try again.')
  }
}

/** Sign-out: nothing of the account's car stays on this device. */
export function forgetTesla() {
  lastAsked = 0
  get().set({ carPrompt: false })
  get().applyTesla({ ...NO_TESLA, enabled: get().tesla.enabled })
}

const OUTCOMES: Record<string, string> = {
  connected: 'Your Tesla is connected',
  cancelled: 'Tesla sign-in was cancelled',
  nocar: 'No car was shared with Mapic. Try again and tick your car.',
  failed: 'Couldn’t connect your Tesla. Try again.',
  signin: 'Sign in to Mapic first, then connect your Tesla',
}

/** Back from Tesla's sign-in (/?tesla=…): say how it went. */
export function showTeslaOutcome(outcome: string | null) {
  if (!outcome || !OUTCOMES[outcome]) return
  const s = get()
  s.showToast(OUTCOMES[outcome])
  if (outcome === 'signin') return s.set({ accountOpen: true })
  if (outcome === 'connected') checkChosenCar()
  s.set({ carSheetOpen: true })
}

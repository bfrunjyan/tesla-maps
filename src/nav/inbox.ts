/**
 * "Send to car": a place picked on the phone shows up in the car.
 *
 * Every device has an id of its own. Sending stores the place in the account with the
 * sender's id; every other signed-in device (the car) checks every 15 seconds while the
 * screen is on and shows it once.
 */
import { load, save } from '../lib/storage'
import { api } from '../services/api'
import { useStore } from '../state/store'
import type { Place } from '../types'

const CHECK_EVERY_MS = 15_000

/** This device's id, made once and kept. */
export function deviceId(): string {
  let id = load<string | null>('deviceId', null)
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    save('deviceId', id)
  }
  return id
}

/** Phones send places; the car (and other large screens) receive them. */
export function isPhone(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPod|Android.+Mobile|Mobile Safari/i.test(navigator.userAgent)
}

export async function sendToCar(place: Place): Promise<void> {
  await api.sendToCar({ id: place.id, name: place.name, address: place.address, lon: place.lon, lat: place.lat, ...(place.category ? { category: place.category } : {}) }, deviceId())
}

/** The last place this device acknowledged: a check already on its way can't bring it back. */
let lastSeen: string | null = null

/** The car showed the place (or the driver dismissed it): don't show it again. */
export function inboxDone() {
  const item = useStore.getState().inbox
  useStore.getState().set({ inbox: null })
  if (!item) return
  lastSeen = item.sentAt
  void api.inboxSeen(item.sentAt).catch(() => {})
}

let started = false
export function startInbox() {
  if (started || isPhone()) return
  started = true
  const check = async () => {
    const s = useStore.getState()
    if (!s.user || s.inbox || document.visibilityState !== 'visible') return
    try {
      const r = await api.inbox(deviceId())
      if (r.place && r.sentAt && r.sentAt !== lastSeen && !useStore.getState().inbox) useStore.getState().set({ inbox: { place: r.place, sentAt: r.sentAt } })
    } catch {
      /* offline: next time */
    }
  }
  window.setInterval(check, CHECK_EVERY_MS)
  document.addEventListener('visibilitychange', check)
  useStore.subscribe((s, prev) => {
    if (s.user && !prev.user) void check()
  })
  void check()
}

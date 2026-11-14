import type { Charger, Place, TeslaLink, TeslaNote, Vehicle } from '../types'

export interface User {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  hasPassword: boolean
}

export interface AuthMethods {
  qr: boolean
  emailCode: boolean
  password: boolean
  google: boolean
}

export interface SavedPlaces {
  home: Place | null
  work: Place | null
  favorites: Place[]
  recents: Place[]
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('No connection. Check the internet and try again.', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data?.error ?? 'Something went wrong. Please try again.', res.status)
  return data as T
}

export const api = {
  config: () => request<{ methods: AuthMethods }>('GET', '/auth/config'),
  me: () => request<{ user: User | null }>('GET', '/auth/me'),
  register: (email: string, password: string) => request<{ user: User }>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  emailStart: (email: string) => request<{ ok: true }>('POST', '/auth/email/start', { email }),
  emailVerify: (email: string, code: string) => request<{ user: User }>('POST', '/auth/email/verify', { email, code }),
  logout: (rememberToken?: string | null) => request<{ ok: true }>('POST', '/auth/logout', rememberToken ? { rememberToken } : {}),
  remember: (previous?: string | null) => request<{ token: string }>('POST', '/auth/remember', previous ? { previous } : {}),
  resume: (token: string) => request<{ user: User; token: string }>('POST', '/auth/resume', { token }),
  deleteAccount: () => request<{ ok: true }>('DELETE', '/auth/me'),
  googleUrl: (returnTo: string) => `/api/auth/google/start?return=${encodeURIComponent(returnTo)}`,

  qrStart: () => request<{ code: string; pollToken: string; path: string; expiresAt: string }>('POST', '/auth/qr/start', {}),
  qrPoll: (pollToken: string) =>
    request<{ status: 'pending' | 'approved' | 'expired' | 'claimed' | 'invalid'; user?: User }>('POST', '/auth/qr/poll', { pollToken }),
  qrCheck: (code: string) => request<{ status: 'pending' }>('GET', `/auth/qr/${encodeURIComponent(code)}`),
  qrApprove: (code: string) => request<{ ok: true }>('POST', '/auth/qr/approve', { code }),

  chargers: () => request<{ chargers: Charger[]; updatedAt: string; sources: string[] }>('GET', '/chargers'),
  vehicle: () => request<{ vehicle: Vehicle | null }>('GET', '/vehicle'),
  setVehicle: (vehicle: Vehicle | null) => request<{ ok: true }>('PUT', '/vehicle', { vehicle }),

  /** Driving history between two days (YYYY-MM-DD), all the account's devices added up. */
  drives: (from: string, to: string) =>
    request<{ days: { day: string; metres: number; wh: number; seconds: number }[] }>('GET', `/drives?from=${from}&to=${to}`),
  /** This device's running totals for the days given. */
  saveDrives: (logId: string, days: { day: string; metres: number; wh: number; seconds: number }[]) =>
    request<{ ok: true }>('PUT', '/drives', { logId, days }),

  /** "Send to car": the place goes to the account's inbox; `device` is this device's id. */
  sendToCar: (place: Place, device: string) => request<{ ok: true }>('POST', '/inbox', { place, device }),
  /** The place waiting for this device from another one, if any. */
  inbox: (device: string) => request<{ place: Place | null; sentAt?: string }>('GET', `/inbox?device=${encodeURIComponent(device)}`),
  inboxSeen: (sentAt: string) => request<{ ok: true }>('POST', '/inbox/seen', { sentAt }),

  teslaStatus: () => request<TeslaLink>('GET', '/tesla/status'),
  /** Asks the car for its battery now (the server spaces these out; Tesla bills each one). */
  teslaRead: () => request<TeslaLink & { note: TeslaNote }>('POST', '/tesla/read', {}),
  teslaCar: (vin: string) => request<TeslaLink>('PUT', '/tesla/car', { vin }),
  teslaDisconnect: () => request<{ ok: true }>('DELETE', '/tesla'),
  /** Opened as a page: it leads to Tesla's sign-in and back. */
  teslaStartUrl: '/api/tesla/start',

  places: () => request<SavedPlaces>('GET', '/places'),
  importPlaces: (local: SavedPlaces) => request<SavedPlaces>('POST', '/places/import', local),
  setHomeWork: (kind: 'home' | 'work', place: Place | null) => request<{ ok: true }>('PUT', `/places/${kind}`, { place }),
  addFavorite: (place: Place) => request<{ ok: true }>('POST', '/places/favorites', place),
  removeFavorite: (placeId: string) => request<{ ok: true }>('DELETE', `/places/favorites/${encodeURIComponent(placeId)}`),
  addRecent: (place: Place) => request<{ ok: true }>('POST', '/places/recents', place),
}

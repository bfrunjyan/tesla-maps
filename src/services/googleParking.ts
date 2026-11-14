/**
 * Car parks near a destination from Google (with the Google map only, as Google's terms
 * require). Google lists far more of them than OpenStreetMap: five within 260 m of
 * Republic Square, where OpenStreetMap had none named within 800 m. One billed request
 * (Nearby Search Pro) per destination.
 */
import type { Place } from '../types'
import { googleKey } from './googleMaps'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby'

export interface GoogleParkingPlace {
  id: string
  displayName?: { text?: string }
  location?: { latitude: number; longitude: number }
  shortFormattedAddress?: string
}

export function parkingToPlace(p: GoogleParkingPlace): Place | null {
  if (!p.id || !p.location) return null
  return {
    id: `google-${p.id}`,
    name: p.displayName?.text?.trim() || 'Parking',
    address: p.shortFormattedAddress ?? '',
    lon: p.location.longitude,
    lat: p.location.latitude,
    category: 'poi',
  }
}

export async function googleParking(near: { lon: number; lat: number }, radiusM = 800, signal?: AbortSignal): Promise<Place[]> {
  const key = googleKey()
  if (!key) return []
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.shortFormattedAddress' },
    body: JSON.stringify({
      includedTypes: ['parking'],
      maxResultCount: 5,
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: radiusM } },
    }),
    signal,
  })
  if (!res.ok) throw new Error(`Google parking ${res.status}`)
  const data = (await res.json()) as { places?: GoogleParkingPlace[] }
  return (data.places ?? []).map(parkingToPlace).filter((p): p is Place => !!p)
}

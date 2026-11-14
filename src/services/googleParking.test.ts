import { describe, expect, it } from 'vitest'
import { parkingToPlace } from './googleParking'

describe('Google car parks as places', () => {
  it('keeps the name, short address and position', () => {
    expect(parkingToPlace({ id: 'abc', displayName: { text: 'City Valet' }, location: { latitude: 40.178, longitude: 44.51 }, shortFormattedAddress: 'Pap Tagavor Street, 4/7, Yerevan' })).toEqual({
      id: 'google-abc',
      name: 'City Valet',
      address: 'Pap Tagavor Street, 4/7, Yerevan',
      lon: 44.51,
      lat: 40.178,
      category: 'poi',
    })
  })

  it('calls an unnamed one Parking, and drops one without a position', () => {
    expect(parkingToPlace({ id: 'x', location: { latitude: 40.1, longitude: 44.5 } })?.name).toBe('Parking')
    expect(parkingToPlace({ id: 'y' })).toBeNull()
  })
})

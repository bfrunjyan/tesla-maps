import { describe, expect, it } from 'vitest'
import { commuteFrom } from './commute'

const home = { id: 'h', name: '12 Aghbyur Serob street', address: '', lon: 44.4947, lat: 40.2085, category: 'home' as const }
const work = { id: 'w', name: '25 Khnko Aper street', address: '', lon: 44.5126, lat: 40.1777, category: 'work' as const }

describe('the commute card', () => {
  it('offers Work when the car is at Home, and Home when it is at Work', () => {
    expect(commuteFrom({ lon: 44.4950, lat: 40.2083 }, home, work)).toEqual({ at: 'home', to: work })
    expect(commuteFrom({ lon: 44.5128, lat: 40.1779 }, home, work)).toEqual({ at: 'work', to: home })
  })

  it('offers nothing elsewhere, without both places, or with no position', () => {
    expect(commuteFrom({ lon: 44.53, lat: 40.19 }, home, work)).toBeNull()
    expect(commuteFrom({ lon: 44.4950, lat: 40.2083 }, home, null)).toBeNull()
    expect(commuteFrom(null, home, work)).toBeNull()
  })

  it('offers nothing when Home and Work are next door to each other', () => {
    const nextDoor = { ...work, lon: 44.4952, lat: 40.2087 }
    expect(commuteFrom({ lon: 44.4950, lat: 40.2083 }, home, nextDoor)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { numberFirst, streetLine, withNumberFirst } from './address'

describe('addresses, number first', () => {
  it('builds a street line with the number first', () => {
    expect(streetLine('Vagharsh Vagharshyan street', '3')).toBe('3 Vagharsh Vagharshyan street')
    expect(streetLine('Getari street', undefined)).toBe('Getari street')
    expect(streetLine(undefined, '12')).toBe('12')
  })

  it('moves a house number from the end to the front', () => {
    expect(numberFirst('Getari street 4/2')).toBe('4/2 Getari street')
    expect(numberFirst('Khnko Aper street 12A')).toBe('12A Khnko Aper street')
    expect(numberFirst('Վաղարշ Վաղարշյան փողոց 3')).toBe('3 Վաղարշ Վաղարշյան փողոց')
    expect(numberFirst('Mashtots Avenue 10-12')).toBe('10-12 Mashtots Avenue')
  })

  it('leaves names without a number at the end alone', () => {
    expect(numberFirst('Byurakan')).toBe('Byurakan')
    expect(numberFirst('3 Vagharsh Vagharshyan street')).toBe('3 Vagharsh Vagharshyan street')
    expect(numberFirst('2026')).toBe('2026')
  })

  it('reorders saved addresses, never the names of businesses', () => {
    const base = { id: 'x', address: '', lon: 44.5, lat: 40.2 }
    expect(withNumberFirst({ ...base, name: 'Getari street 4/2', category: 'address' as const }).name).toBe('4/2 Getari street')
    expect(withNumberFirst({ ...base, name: 'Aghbyur Serob street 7', category: 'home' as const }).name).toBe('7 Aghbyur Serob street')
    expect(withNumberFirst({ ...base, name: 'Cafe 21', category: 'food' as const }).name).toBe('Cafe 21')
    expect(withNumberFirst({ ...base, name: 'School 55' }).name).toBe('School 55')
    expect(withNumberFirst(null)).toBeNull()
  })
})

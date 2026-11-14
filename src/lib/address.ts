/**
 * Addresses written the way drivers here read them: house number first,
 * "3 Vagharsh Vagharshyan street" rather than "Vagharsh Vagharshyan street 3".
 */
import type { Place, PlaceCategory } from '../types'

/** A street line from its parts, number first. */
export function streetLine(street?: string, number?: string): string {
  return [number?.trim(), street?.trim()].filter(Boolean).join(' ')
}

/** A house number at the end of a name: 3, 12A, 4/2, 10-12, 5Ա. */
const NUMBER_LAST = /^(.*\p{L}.*?)\s+(\d+\p{L}?(?:[/-]\d+\p{L}?)?)$/u

/** "Getari street 4/2" → "4/2 Getari street". Names without a number at the end stay as they are. */
export function numberFirst(name: string): string {
  const m = NUMBER_LAST.exec(name.trim())
  return m ? `${m[2]} ${m[1]}` : name
}

/** Places whose name is an address (not a business or a name the driver chose). */
const ADDRESS_LIKE: PlaceCategory[] = ['address', 'home', 'work', 'pin']

/** A saved place with its address written number first (places saved before the change). */
export function withNumberFirst<T extends Place | null>(p: T): T {
  if (!p || !p.category || !ADDRESS_LIKE.includes(p.category)) return p
  const name = numberFirst(p.name)
  return name === p.name ? p : { ...p, name }
}

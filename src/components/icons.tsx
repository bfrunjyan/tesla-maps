import type { SVGProps } from 'react'

type Kind =
  | 'straight' | 'slight-right' | 'right' | 'sharp-right' | 'uturn-right'
  | 'slight-left' | 'left' | 'sharp-left' | 'uturn-left'
  | 'roundabout' | 'destination' | 'merge'

/** Valhalla maneuver type → glyph. */
export function maneuverKind(type: number): Kind {
  switch (type) {
    case 9: case 18: case 20: case 23: case 37: return 'slight-right'
    case 16: case 19: case 21: case 24: case 38: return 'slight-left'
    case 10: case 2: return 'right'
    case 15: case 3: return 'left'
    case 11: return 'sharp-right'
    case 14: return 'sharp-left'
    case 12: return 'uturn-right'
    case 13: return 'uturn-left'
    case 26: case 27: return 'roundabout'
    case 4: case 5: case 6: return 'destination'
    case 25: return 'merge'
    default: return 'straight'
  }
}

/** Solid turn arrows: a thick shaft plus a filled head. Left turns mirror the right-hand glyphs. */
const GLYPHS: Record<string, { shaft: string[]; head: string; ring?: boolean }> = {
  straight: { shaft: ['M12 22V9.5'], head: '12,2 19.5,10.5 4.5,10.5' },
  'slight-right': { shaft: ['M8.5 22v-6.5c0-1.6.6-3.1 1.8-4.2l3.6-3.6'], head: '20,3 10.4,4.6 18.4,12.6' },
  right: { shaft: ['M7 22v-8a5 5 0 0 1 5-5h3.5'], head: '22,9 14.5,2 14.5,16' },
  'sharp-right': { shaft: ['M7 2v6.5c0 1.6.6 3.1 1.8 4.2l4.6 4.6'], head: '20,20.5 10.4,18.9 18.4,10.9' },
  'uturn-right': { shaft: ['M6 22V10a5.5 5.5 0 0 1 11 0v3'], head: '17,21.5 10.5,13 23.5,13' },
  roundabout: { shaft: ['M12 22v-6.5', 'M15.3 7.7l1.8-1.8'], head: '21.5,2 12.6,3.6 19.9,10.9', ring: true },
  merge: { shaft: ['M12 22V9.5', 'M19 22c0-4-7-5.5-7-9.5'], head: '12,2 19.5,10.5 4.5,10.5' },
}

export function ManeuverIcon({ type, size = 40, ...rest }: { type: number; size?: number } & Omit<SVGProps<SVGSVGElement>, 'type'>) {
  const kind = maneuverKind(type)
  if (kind === 'destination') {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
        <path d="M6 22V3" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
        <path d="M6 3h13l-3 4.5 3 4.5H6z" fill="currentColor" />
      </svg>
    )
  }
  const mirrored = kind === 'left' || kind.endsWith('-left')
  const g = GLYPHS[kind === 'left' ? 'right' : kind.replace('-left', '-right')] ?? GLYPHS.straight
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" {...rest}>
      <g transform={mirrored ? 'translate(24 0) scale(-1 1)' : undefined}>
        {g.ring && <circle cx="12" cy="11" r="4.6" fill="none" stroke="currentColor" strokeWidth={2.6} />}
        {g.shaft.map((d) => (
          <path key={d} d={d} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        <polygon points={g.head} fill="currentColor" strokeLinejoin="round" />
      </g>
    </svg>
  )
}

import { describe, expect, it } from 'vitest'
import { armenianFaces } from './armenianLabels'

// Shortened from Google Fonts' answer for Noto Sans Armenian (Nov 2026).
const CSS = `/* armenian */
@font-face {
  font-family: 'Noto Sans Armenian';
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/notosansarmenian/v47/arm.woff2) format('woff2');
  unicode-range: U+0308, U+0530-058F, U+2010, U+2024, U+25CC, U+FB13-FB17;
}
/* latin */
@font-face {
  font-family: 'Noto Sans Armenian';
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/notosansarmenian/v47/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153;
}
/* armenian */
@font-face {
  font-family: 'Noto Sans Armenian';
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/notosansarmenian/v47/arm.woff2) format('woff2');
  unicode-range: U+0308, U+0530-058F, U+2010, U+2024, U+25CC, U+FB13-FB17;
}`

describe('Armenian fonts from the Google Fonts stylesheet', () => {
  it('keeps only the Armenian subset, one per weight', () => {
    const faces = armenianFaces(CSS)
    expect(faces.map((f) => f.weight)).toEqual(['400', '700'])
    expect(faces.every((f) => f.url.endsWith('/arm.woff2'))).toBe(true)
  })

  it('finds nothing in an answer without it', () => {
    expect(armenianFaces('')).toEqual([])
    expect(armenianFaces(CSS.split('/* latin */')[1].split('/* armenian */')[0])).toEqual([])
  })
})

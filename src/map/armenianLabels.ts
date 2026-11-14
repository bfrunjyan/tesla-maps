/**
 * Armenian letters for the Google map's labels.
 *
 * Google draws its labels with the browser's own fonts ("roboto, arial, sans-serif").
 * The car's browser has no font with Armenian letters, so Armenian names came out as
 * empty boxes. Here Noto Sans Armenian (from Google Fonts) is registered under the
 * name "roboto" for the Armenian characters only, so Google's labels pick it up while
 * every other character is drawn as before. A Roboto installed on the device is kept
 * for the rest.
 */

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Armenian:wght@400;500;700&display=block'
/** The Armenian alphabet and ligatures: the only characters the added font is used for. */
export const ARMENIAN_RANGE = 'U+0530-058F, U+FB13-FB17'
/** Picks Google Fonts' Armenian subset out of its stylesheet. */
const ARMENIAN = /U\+05[3-8]/i
/** How long the map waits for the letters before showing; later labels still get them. */
const WAIT_MS = 1500

/** The Armenian @font-face blocks of a Google Fonts stylesheet: file, weight and characters. */
export function armenianFaces(css: string): { url: string; weight: string; range: string }[] {
  const out: { url: string; weight: string; range: string }[] = []
  for (const [, body] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim()
    const url = /src:\s*url\(([^)]+)\)/.exec(body)?.[1]?.replace(/['"]/g, '')
    const weight = /font-weight:\s*(\d+)/.exec(body)?.[1] ?? '400'
    if (range && url && ARMENIAN.test(range)) out.push({ url, weight, range })
  }
  return out
}

let loading: Promise<void> | null = null

/** Adds the Armenian letters for Google's labels; resolves when loaded, or after a short wait. */
export function loadArmenianLabels(): Promise<void> {
  loading ??= (async () => {
    if (typeof FontFace === 'undefined' || !document.fonts) return
    // A real Roboto on the device stays in use for everything that isn't Armenian.
    for (const [name, weight] of [['Roboto', '400'], ['Roboto Medium', '500'], ['Roboto Bold', '700']]) {
      const local = new FontFace('roboto', `local("${name}")`, { weight })
      document.fonts.add(local)
      local.load().catch(() => document.fonts.delete(local))
    }
    const css = await (await fetch(CSS_URL)).text()
    await Promise.all(
      armenianFaces(css).map((f) => {
        // Only the alphabet: the subset also lists hyphens and dots, which stay in the usual font.
        const face = new FontFace('roboto', `url(${f.url})`, { weight: f.weight, unicodeRange: ARMENIAN_RANGE })
        document.fonts.add(face)
        return face.load()
      }),
    )
  })().catch((err) => console.warn('[armenian labels]', err))
  return Promise.race([loading, new Promise<void>((r) => setTimeout(r, WAIT_MS))])
}

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', globalThis)
const { useStore } = await import('../state/store')
const { resetTapOutside, tapOutsideSearch, typingInSearch, watchTaps } = await import('./tapOutside')

/** A stand-in page: the search field, which can have the focus, and finger-downs. */
function page() {
  const blur = vi.fn(() => (doc.activeElement = null))
  const field = { tagName: 'INPUT', closest: (s: string) => (s === '.search' ? field : null), blur }
  const doc: { activeElement: unknown } = { activeElement: null }
  let down: () => void = () => {}
  const target = { addEventListener: (_t: string, fn: () => void) => (down = fn) }
  resetTapOutside()
  watchTaps(target as never, doc as never)
  return {
    doc: doc as never as Document,
    blur,
    type: () => (doc.activeElement = field),
    /** A tap outside: finger down (the field still has the focus), the browser takes the focus, then the click. */
    tapOutside: () => {
      down()
      doc.activeElement = null
      tapOutsideSearch(doc as never)
    },
  }
}

beforeEach(() => useStore.setState({ panelOpen: true, query: 'Vagharsh', searchMode: 'navigate' }))

describe('tapping outside the search', () => {
  it('only puts the keyboard away while typing: the text and suggestions stay', () => {
    const p = page()
    p.type()
    p.tapOutside()
    expect(useStore.getState()).toMatchObject({ panelOpen: true, query: 'Vagharsh' })
  })

  it('closes the search when the keyboard is already down', () => {
    const p = page()
    p.type()
    p.tapOutside() // keyboard away
    p.tapOutside() // then close
    expect(useStore.getState()).toMatchObject({ panelOpen: false, query: '' })
  })

  it('puts the keyboard away when the browser keeps the focus on the field', () => {
    const p = page()
    p.type()
    tapOutsideSearch(p.doc)
    expect(p.blur).toHaveBeenCalled()
    expect(useStore.getState().panelOpen).toBe(true)
  })

  it('knows the search field from other fields', () => {
    expect(typingInSearch({ activeElement: null })).toBe(false)
    const other = { tagName: 'INPUT', closest: () => null }
    expect(typingInSearch({ activeElement: other as never })).toBe(false)
  })
})

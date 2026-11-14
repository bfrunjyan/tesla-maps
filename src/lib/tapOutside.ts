/**
 * A tap outside the open search. While the driver is typing, that tap only puts the
 * on-screen keyboard away: what they typed and the suggestions stay, so they can read
 * the list with the whole screen. With the keyboard already down, the tap closes the
 * search as before.
 *
 * Whether they were typing has to be read when the finger goes down: by the time the
 * tap's click arrives the browser has already taken the focus off the search field.
 */
import { useStore } from '../state/store'

let typingAtTap = false
let watching = false

/** True while the search field has the focus (the on-screen keyboard is up). */
export function typingInSearch(doc: Pick<Document, 'activeElement'> = document): boolean {
  const el = doc.activeElement as (Element & { closest?: (s: string) => Element | null }) | null
  return !!el && el.tagName === 'INPUT' && !!el.closest?.('.search')
}

/** Notes, at every finger-down, whether the driver was typing in the search. */
export function watchTaps(target: Pick<Window, 'addEventListener'> = window, doc: Pick<Document, 'activeElement'> = document) {
  if (watching) return
  watching = true
  target.addEventListener('pointerdown', () => (typingAtTap = typingInSearch(doc)), { capture: true })
}

/** The tap landed outside the open search: put the keyboard away, or close the search. */
export function tapOutsideSearch(doc: Pick<Document, 'activeElement'> = document) {
  const s = useStore.getState()
  if (!s.panelOpen) return
  if (typingAtTap || typingInSearch(doc)) {
    typingAtTap = false
    ;(doc.activeElement as HTMLElement | null)?.blur?.()
    return
  }
  s.closePanel()
}

/** For tests. */
export function resetTapOutside() {
  typingAtTap = false
  watching = false
}

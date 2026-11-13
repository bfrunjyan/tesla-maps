import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'

const s = () => useStore.getState()

beforeEach(() => useStore.setState({ guideHidden: false, turnListOpen: false }))

describe('hiding the directions card', () => {
  it('hides and shows on request', () => {
    s().setGuideHidden(true)
    expect(s().guideHidden).toBe(true)
    s().setGuideHidden(false)
    expect(s().guideHidden).toBe(false)
  })

  it('closes the turn list, so the card comes back compact', () => {
    s().set({ turnListOpen: true })
    s().setGuideHidden(true)
    s().setGuideHidden(false)
    expect(s().turnListOpen).toBe(false)
  })
})

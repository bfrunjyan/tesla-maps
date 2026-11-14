import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, type NavState } from '../state/store'
import { RECENTER_AFTER_MS, resetAutoRecenter, startAutoRecenter } from './autoRecenter'

const dest = { id: 'd', name: 'Opera', address: '', lon: 44.5149, lat: 40.1858 }
const trip = (status: NavState['status']): NavState => ({ destination: dest, route: null, progress: null, status })

describe('back to the car after the driver moves the map', () => {
  const screen = new EventTarget()
  const touch = () => screen.dispatchEvent(new Event('pointerdown'))

  beforeEach(() => {
    vi.useFakeTimers()
    resetAutoRecenter()
    useStore.setState({ nav: trip('active'), follow: true })
    startAutoRecenter(screen as unknown as Window)
  })
  afterEach(() => {
    resetAutoRecenter()
    vi.useRealTimers()
    useStore.setState({ nav: null, follow: true })
  })

  it('follows the car again 5 seconds after the map was moved', () => {
    useStore.getState().set({ follow: false })
    vi.advanceTimersByTime(RECENTER_AFTER_MS - 100)
    expect(useStore.getState().follow).toBe(false)
    vi.advanceTimersByTime(100)
    expect(useStore.getState().follow).toBe(true)
  })

  it('waits while the driver keeps touching the map', () => {
    useStore.getState().set({ follow: false })
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(3000)
      touch()
    }
    expect(useStore.getState().follow).toBe(false)
    vi.advanceTimersByTime(RECENTER_AFTER_MS)
    expect(useStore.getState().follow).toBe(true)
  })

  it('leaves the map alone without a trip, or in the route preview', () => {
    useStore.setState({ nav: null })
    useStore.getState().set({ follow: false })
    vi.advanceTimersByTime(RECENTER_AFTER_MS * 2)
    expect(useStore.getState().follow).toBe(false)

    useStore.setState({ nav: trip('choosing') })
    vi.advanceTimersByTime(RECENTER_AFTER_MS * 2)
    expect(useStore.getState().follow).toBe(false)
  })

  it('stops counting when the trip ends', () => {
    useStore.getState().set({ follow: false })
    vi.advanceTimersByTime(2000)
    useStore.getState().set({ nav: null })
    vi.advanceTimersByTime(RECENTER_AFTER_MS)
    expect(useStore.getState().follow).toBe(false)
  })
})

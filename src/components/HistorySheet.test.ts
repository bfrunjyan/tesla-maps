import { describe, expect, it } from 'vitest'
import { axisTicks, busiestBucket, costLabel, duration } from './HistorySheet'

const bucket = (label: string, metres: number) => ({ label, metres, wh: metres / 7, seconds: 1, from: '', to: '', full: label, current: false, future: false })

describe('driving history numbers', () => {
  it('prices the energy at the driver’s electricity price', () => {
    expect(costLabel(15_500, 48)).toBe('≈ 744 ֏')
    expect(costLabel(1_279_000, 48.5)).toBe('≈ 62,032 ֏')
    expect(costLabel(15_500, null)).toBeNull()
    expect(costLabel(15_500, 0)).toBeNull()
  })

  it('names the busiest day, week or month when there is more than one to compare', () => {
    expect(busiestBucket([bucket('Mon', 22_000), bucket('Tue', 34_000), bucket('Wed', 0)])?.label).toBe('Tue')
    expect(busiestBucket([bucket('Mon', 22_000), bucket('Tue', 0)])).toBeNull()
  })

  it('writes driving time the short way', () => {
    expect(duration(46 * 60)).toEqual({ value: '46', unit: 'min' })
    expect(duration(133 * 60)).toEqual({ value: '2 h 13', unit: 'min' })
    expect(duration(12_518 * 60)).toEqual({ value: '209', unit: 'h' })
  })

  it('picks round axis steps', () => {
    expect(axisTicks(34)).toEqual([0, 20, 40])
    expect(axisTicks(165)).toEqual([0, 100, 200])
    expect(axisTicks(0)).toEqual([0])
  })
})

import { BatteryEmpty, BatteryFull, BatteryHigh, BatteryLow, BatteryMedium } from '@phosphor-icons/react'
import { batteryLevel } from '../nav/battery'

/** Battery glyph that fills with the level; amber under 20 %, red under 10 %. */
export function BatteryIcon({ pct, size = 20 }: { pct: number; size?: number }) {
  const Icon = pct >= 88 ? BatteryFull : pct >= 62 ? BatteryHigh : pct >= 37 ? BatteryMedium : pct >= 12 ? BatteryLow : BatteryEmpty
  return <Icon size={size} className="battery-icon" data-level={batteryLevel(pct)} aria-hidden />
}

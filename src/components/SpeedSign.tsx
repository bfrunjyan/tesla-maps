import { useStore } from '../state/store'
import { isOver, limitAt } from '../nav/speedLimits'

/**
 * During guidance, where the road's limit is known: the speed-limit sign (as on Armenian
 * roads: a red ring around the number) with the car's speed beside it, red when over.
 * Nothing is shown where the map data has no limit for the road.
 */
export function SpeedSign() {
  const limits = useStore((s) => s.speedLimits)
  const nav = useStore((s) => s.nav)
  const speedMps = useStore((s) => s.position?.speed ?? 0)
  const guiding = nav?.status === 'active' || nav?.status === 'rerouting'
  const limit = guiding && limits && limits.route === nav?.route ? limitAt(limits.spans, nav?.progress) : null
  if (limit == null) return null
  const kmh = Math.round(Math.max(0, speedMps) * 3.6)
  const over = isOver(kmh, limit)
  return (
    <div className="speed" data-over={over} role="status" aria-label={`Speed limit ${limit}. Your speed ${kmh} km/h${over ? ', over the limit' : ''}`}>
      <span className="speed__limit" aria-hidden>
        {limit}
      </span>
      <span className="speed__now" aria-hidden>
        <span className="speed__value">{kmh}</span>
        <span className="speed__unit">km/h</span>
      </span>
    </div>
  )
}

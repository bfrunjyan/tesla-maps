/**
 * Rough EV energy estimate per route, used to label the "Economy" option.
 * A ~1.9 t EV (Model 3/Y class): rolling + air drag grow with speed; climbing
 * costs potential energy; descending gets part of it back through regeneration.
 * It's an estimate for comparing routes, not a range prediction.
 */
const MASS_KG = 1900
const G = 9.81
const DRIVETRAIN_EFFICIENCY = 0.9
const REGEN_RECOVERY = 0.6
const WH_PER_JOULE = 1 / 3600

/** Wh to lift the car one metre, after drivetrain losses (~5.8 Wh). */
export const CLIMB_WH_PER_M = (MASS_KG * G * WH_PER_JOULE) / DRIVETRAIN_EFFICIENCY
/** Wh recovered per metre of descent (~3.1 Wh). */
export const DESCENT_WH_PER_M = MASS_KG * G * WH_PER_JOULE * REGEN_RECOVERY

/** Flat-road consumption at an average speed: ~140 Wh/km in town, ~230 at 90 km/h. */
export function baseWhPerKm(avgKmh: number) {
  return 130 + 0.012 * avgKmh * avgKmh
}

export function estimateKWh(o: { lengthKm: number; timeS: number; climbM: number; descentM: number }) {
  const avgKmh = o.timeS > 0 ? o.lengthKm / (o.timeS / 3600) : 50
  const wh = baseWhPerKm(avgKmh) * o.lengthKm + CLIMB_WH_PER_M * o.climbM - DESCENT_WH_PER_M * o.descentM
  return Math.max(0, wh / 1000)
}

/** Total climb and descent from a list of heights (metres), ignoring missing samples. */
export function climbStats(heights: (number | null)[]) {
  const h = heights.filter((x): x is number => typeof x === 'number')
  let climbM = 0
  let descentM = 0
  for (let i = 1; i < h.length; i++) {
    const d = h[i] - h[i - 1]
    if (d > 0) climbM += d
    else descentM -= d
  }
  return { climbM, descentM }
}

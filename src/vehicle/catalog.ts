import type { Vehicle } from '../types'

/**
 * The cars drivers can choose. Battery sizes are approximate usable capacity and
 * `factor` scales Mapic's energy model (tuned for a Model Y) to each model; both
 * feed the charge-at-arrival estimate, which is shown as an estimate.
 */
export interface Trim {
  id: string
  name: string
  /** Approximate usable battery, kWh. */
  kWh: number
  from?: number
  to?: number
}

export interface CarModel {
  id: string
  name: string
  from: number
  to?: number
  factor: number
  image: string
  /** Photo credit (Wikimedia Commons). All photos are cropped. */
  credit: { author: string; license: string; url: string }
  trims: Trim[]
}

export const LATEST_YEAR = 2026

export const MODELS: CarModel[] = [
  {
    id: 'model3',
    name: 'Model 3',
    from: 2017,
    factor: 0.92,
    image: '/cars/model3.jpg',
    credit: { author: 'Carlquinn', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_3_parked,_front_driver_side.jpg' },
    trims: [
      { id: 'rwd', name: 'Rear-Wheel Drive', kWh: 57, from: 2019 },
      { id: 'mr', name: 'Mid Range', kWh: 62, from: 2018, to: 2019 },
      { id: 'lr', name: 'Long Range', kWh: 75 },
      { id: 'perf', name: 'Performance', kWh: 75, from: 2018 },
    ],
  },
  {
    id: 'modely',
    name: 'Model Y',
    from: 2020,
    factor: 1,
    image: '/cars/modely.jpg',
    credit: { author: 'Kevauto', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:2023_Tesla_Model_Y,_front_11.11.23.jpg' },
    trims: [
      { id: 'rwd', name: 'Rear-Wheel Drive', kWh: 57, from: 2021 },
      { id: 'lr', name: 'Long Range', kWh: 75 },
      { id: 'perf', name: 'Performance', kWh: 75 },
    ],
  },
  {
    id: 'models',
    name: 'Model S',
    from: 2012,
    factor: 1.05,
    image: '/cars/models.jpg',
    credit: { author: 'HJUdall', license: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:21_Tesla_Model_S_Plaid.jpg' },
    trims: [
      { id: 'sr', name: 'Standard Range (60–75)', kWh: 68, to: 2019 },
      { id: 'lr', name: 'Long Range (85–100)', kWh: 92 },
      { id: 'plaid', name: 'Plaid', kWh: 95, from: 2021 },
    ],
  },
  {
    id: 'modelx',
    name: 'Model X',
    from: 2015,
    factor: 1.2,
    image: '/cars/modelx.jpg',
    credit: { author: 'Alexander Migl', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_X_100D_1X7A6736.jpg' },
    trims: [
      { id: 'sr', name: 'Standard Range (60–75)', kWh: 70, from: 2016, to: 2019 },
      { id: 'lr', name: 'Long Range (90–100)', kWh: 93 },
      { id: 'plaid', name: 'Plaid', kWh: 95, from: 2021 },
    ],
  },
  {
    id: 'cybertruck',
    name: 'Cybertruck',
    from: 2023,
    factor: 1.6,
    image: '/cars/cybertruck.jpg',
    credit: { author: 'Mpelas199', license: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Cybertruck_-_Side_-_Tesla_Store_Athens_2024.jpg' },
    trims: [
      { id: 'awd', name: 'All-Wheel Drive', kWh: 120 },
      { id: 'beast', name: 'Cyberbeast', kWh: 120 },
    ],
  },
]

export const findModel = (id: string) => MODELS.find((m) => m.id === id)

/** Model years, newest first. */
export function yearsFor(model: CarModel): number[] {
  const out: number[] = []
  for (let y = model.to ?? LATEST_YEAR; y >= model.from; y--) out.push(y)
  return out
}

export function trimsFor(model: CarModel, year: number): Trim[] {
  return model.trims.filter((t) => year >= (t.from ?? model.from) && year <= (t.to ?? model.to ?? LATEST_YEAR))
}

export interface VehicleSpec {
  model: CarModel
  trim: Trim
  year: number
  /** "2023 Model Y" */
  title: string
  capacityKWh: number
  factor: number
}

/** Resolves a saved choice; null if it doesn't match the catalog (e.g. after a catalog change). */
export function vehicleSpec(v: Vehicle | null | undefined): VehicleSpec | null {
  if (!v) return null
  const model = findModel(v.model)
  const trim = model?.trims.find((t) => t.id === v.trim)
  if (!model || !trim) return null
  return { model, trim, year: v.year, title: `${v.year} ${model.name}`, capacityKWh: trim.kWh, factor: model.factor }
}

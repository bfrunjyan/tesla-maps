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

/** A photo of one generation of a model, used for the model years it covers. */
export interface CarPhoto {
  /** First model year this photo stands for (defaults to the model's first year). */
  from?: number
  /** Last model year (defaults to the latest). */
  to?: number
  /** Name of the generation, e.g. "2024 refresh". */
  label: string
  image: string
  /** Photo credit (Wikimedia Commons). All photos are cropped; number plates are blurred. */
  credit: { author: string; license: string; url: string }
}

export interface CarModel {
  id: string
  name: string
  from: number
  to?: number
  factor: number
  /** One photo per generation, oldest first; together they cover every model year. */
  photos: CarPhoto[]
  trims: Trim[]
}

export const LATEST_YEAR = 2026

export const MODELS: CarModel[] = [
  {
    id: 'model3',
    name: 'Model 3',
    from: 2017,
    factor: 0.92,
    photos: [
      { to: 2023, label: 'Original', image: '/cars/model3-2017.jpg', credit: { author: 'Carlquinn', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_3_parked,_front_driver_side.jpg' } },
      { from: 2024, label: '2024 refresh', image: '/cars/model3-2024.jpg', credit: { author: 'Chanokchon', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:2023_Tesla_Model_3_Highland_Long_Range_AWD.jpg' } },
    ],
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
    photos: [
      { to: 2024, label: 'Original', image: '/cars/modely-2020.jpg', credit: { author: 'Kevauto', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:2023_Tesla_Model_Y,_front_11.11.23.jpg' } },
      { from: 2025, label: '2025 refresh', image: '/cars/modely-2025.jpg', credit: { author: 'Dllu', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_Y_2025_at_Santana_Row_dllu_01.jpg' } },
    ],
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
    photos: [
      { to: 2015, label: 'Original', image: '/cars/models-2012.jpg', credit: { author: 'free photos & art', license: 'CC BY 2.0', url: 'https://commons.wikimedia.org/wiki/File:2014_Tesla_Motors_Model_S_(front_view)_Netherlands.jpg' } },
      { from: 2016, to: 2020, label: '2016 refresh', image: '/cars/models-2016.jpg', credit: { author: 'Calreyn88', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:2018_Tesla_Model_S_100D.jpg' } },
      { from: 2021, label: '2021 refresh', image: '/cars/models-2021.jpg', credit: { author: 'HJUdall', license: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:21_Tesla_Model_S_Plaid.jpg' } },
    ],
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
    photos: [
      { to: 2020, label: 'Original', image: '/cars/modelx-2015.jpg', credit: { author: 'Alexander Migl', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_X_100D_1X7A6736.jpg' } },
      { from: 2021, label: '2021 refresh', image: '/cars/modelx-2021.jpg', credit: { author: 'Ethan Llamas', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Model_X_Plaid_Shadow_Grey_01.jpg' } },
    ],
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
    photos: [{ label: 'Cybertruck', image: '/cars/cybertruck.jpg', credit: { author: 'Mpelas199', license: 'CC0', url: 'https://commons.wikimedia.org/wiki/File:Tesla_Cybertruck_-_Side_-_Tesla_Store_Athens_2024.jpg' } }],
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

/** The photo for a model year: the generation that year belongs to. */
export function photoFor(model: CarModel, year: number): CarPhoto {
  return model.photos.find((p) => year >= (p.from ?? model.from) && year <= (p.to ?? model.to ?? LATEST_YEAR)) ?? latestPhoto(model)
}

/** The newest generation's photo, for the model list. */
export const latestPhoto = (model: CarModel) => model.photos[model.photos.length - 1]

export interface VehicleSpec {
  model: CarModel
  trim: Trim
  year: number
  /** The photo of this car's generation. */
  photo: CarPhoto
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
  return { model, trim, year: v.year, photo: photoFor(model, v.year), title: `${v.year} ${model.name}`, capacityKWh: trim.kWh, factor: model.factor }
}

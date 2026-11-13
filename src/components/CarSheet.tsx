import { useEffect, useRef, useState } from 'react'
import { ArrowsClockwise, CaretLeft, Minus, Plus, X } from '@phosphor-icons/react'
import { useStore } from '../state/store'
import type { TeslaCar } from '../types'
import { MODELS, findModel, trimsFor, vehicleSpec, yearsFor, type CarModel } from '../vehicle/catalog'
import { ago, readingLine } from '../vehicle/liveBattery'
import { chooseTeslaCar, connectTesla, disconnectTesla, readTesla } from '../vehicle/tesla'
import { BatteryIcon } from './BatteryIcon'

/** Your car and its battery level. Opens from the battery chip on the map. */
export function CarSheet() {
  const vehicle = useStore((s) => s.vehicle)
  const set = useStore((s) => s.set)
  const [picking, setPicking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => set({ carSheetOpen: false })
  const spec = vehicleSpec(vehicle)
  const prompt = useStore((s) => s.carPrompt)
  // A connected Tesla tells its model and year: only the version is left to pick.
  const teslaCar = useStore((s) => (s.tesla.connected ? s.tesla.cars.find((c) => c.vin === s.tesla.vin) : undefined))
  const detected = detectedStep(teslaCar)
  const matching = prompt && !!detected
  const showPicker = picking || !spec || matching
  const donePicking = () => {
    setPicking(false)
    set({ carPrompt: false })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="surface sheet car-sheet" role="dialog" aria-modal="true" aria-labelledby="car-title" tabIndex={-1} data-wide={showPicker}>
        <header className="sheet__head">
          <h2 id="car-title" className="sheet__title">{showPicker ? 'Choose your car' : 'Your car'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <X size={22} weight="bold" />
          </button>
        </header>
        {showPicker ? <CarPicker onDone={donePicking} canCancel={!!spec} start={!spec || matching ? detected : undefined} /> : <CarSummary onChange={() => setPicking(true)} />}
      </div>
    </div>
  )
}

function CarSummary({ onChange }: { onChange: () => void }) {
  const spec = vehicleSpec(useStore((s) => s.vehicle))!
  const battery = useStore((s) => s.battery)
  const setBattery = useStore((s) => s.setBattery)
  const tesla = useStore((s) => s.tesla)
  const note = useStore((s) => s.teslaNote)
  const busy = useStore((s) => s.teslaBusy)
  const pct = battery ? Math.round(battery.pct) : null
  // Read from the car: the level is the car's, so the manual controls step aside.
  const reading = tesla.connected && battery?.source === 'tesla' ? tesla.reading : null
  const live = reading != null

  return (
    <div className="car">
      <div className="car__hero">
        <img className="car__photo" src={spec.model.image} width={640} height={400} alt={`Tesla ${spec.model.name}`} />
        <div className="car__id">
          <span className="car__name">{spec.title}</span>
          <span className="car__trim">{spec.trim.name} · ≈{spec.capacityKWh} kWh battery</span>
          <button className="btn btn--sm car__change" onClick={onChange}>Change car</button>
        </div>
      </div>

      <section className="battery" aria-labelledby="battery-label">
        <div className="battery__head">
          <span id="battery-label" className="setting__label">Battery now</span>
          {pct != null && <BatteryIcon pct={pct} size={22} charging={live && reading.charging === 'charging'} />}
        </div>
        {live ? (
          <>
            <div className="battery__row">
              <output className="battery__value" aria-live="polite">{pct}%</output>
              <button className="icon-btn battery__step" aria-label="Read from the car again" disabled={busy} onClick={() => readTesla('manual')}>
                <ArrowsClockwise size={22} weight="bold" className="battery__refresh" data-busy={busy} />
              </button>
            </div>
            {readingLine(reading) && <p className="battery__live">{readingLine(reading)}</p>}
            <p className="setting__hint">{liveHint(note, reading.live, ago(Date.now() - Date.parse(reading.at)))}</p>
          </>
        ) : (
          <>
            <div className="battery__row">
              <button className="icon-btn battery__step" aria-label="Lower by 5 percent" onClick={() => setBattery((pct ?? 80) - 5)}>
                <Minus size={22} weight="bold" />
              </button>
              <output className="battery__value" aria-live="polite">{pct != null ? `${pct}%` : 'Not set'}</output>
              <button className="icon-btn battery__step" aria-label="Raise by 5 percent" onClick={() => setBattery((pct ?? 75) + 5)}>
                <Plus size={22} weight="bold" />
              </button>
            </div>
            <input
              className="battery__slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct ?? 80}
              aria-label="Battery level"
              onChange={(e) => setBattery(Number(e.target.value))}
            />
            <p className="setting__hint">
              Set it to what the car shows. Mapic uses it for charge at arrival and lowers it as you drive; correct it any time.
            </p>
          </>
        )}
      </section>

      {tesla.enabled && <TeslaSection />}
    </div>
  )
}

function liveHint(note: string | null, live: boolean, when: string) {
  if (note === 'asleep' || (!note && !live)) return `Your car is asleep. This is what it reported ${when}.`
  if (note === 'limit') return `Mapic has read your car as often as it can today. This is from ${when}.`
  if (note === 'unavailable') return `Couldn’t reach your car. This is from ${when}.`
  return `Read from your car ${when}. Mapic lowers it as you drive and checks again every 10 minutes.`
}

const carLabel = (c: TeslaCar) => c.name || findModel(c.model ?? '')?.name || `Car ending ${c.vin.slice(-4)}`

/** Connect Tesla: link the Tesla account so the level comes from the car itself. */
function TeslaSection() {
  const tesla = useStore((s) => s.tesla)
  const busy = useStore((s) => s.teslaBusy)
  const user = useStore((s) => s.user)
  const car = tesla.cars.find((c) => c.vin === tesla.vin)

  if (!tesla.connected) {
    return (
      <section className="tesla" aria-labelledby="tesla-label">
        <div className="tesla__text">
          <span id="tesla-label" className="setting__label">Read it from the car</span>
          <p className="setting__hint">
            Connect your Tesla account and Mapic shows the real charge level, range and charging state.
            {user ? ' Easiest on your phone: the car picks it up.' : ' You sign in to Mapic first.'}
          </p>
        </div>
        <button className="btn btn--primary btn--sm tesla__action" onClick={connectTesla}>Connect Tesla</button>
      </section>
    )
  }

  return (
    <section className="tesla" aria-labelledby="tesla-label">
      <div className="tesla__text">
        <span id="tesla-label" className="setting__label">Tesla account</span>
        <span className="tesla__state">Connected{car ? ` · ${carLabel(car)}` : ''}</span>
        {!tesla.reading && (
          <p className="setting__hint">{busy ? 'Reading your car…' : 'No reading from the car yet. Set the level above, or try again.'}</p>
        )}
      </div>
      <div className="tesla__actions">
        {!tesla.reading && (
          <button className="btn btn--sm" disabled={busy} onClick={() => readTesla('manual')}>Try again</button>
        )}
        <button className="btn btn--sm" onClick={disconnectTesla}>Disconnect</button>
      </div>
      {tesla.cars.length > 1 && (
        <div className="tesla__cars" role="radiogroup" aria-label="Car to read">
          {tesla.cars.map((c) => (
            <button key={c.vin} className="tesla__car" role="radio" aria-checked={c.vin === tesla.vin} disabled={busy} onClick={() => c.vin !== tesla.vin && chooseTeslaCar(c.vin)}>
              {carLabel(c)}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

type Step = { name: 'model' } | { name: 'year'; model: CarModel } | { name: 'trim'; model: CarModel; year: number }

/** Where the picker starts for a connected Tesla whose VIN gives a model and year Mapic knows. */
function detectedStep(car: TeslaCar | undefined): Step | undefined {
  const model = car?.model ? findModel(car.model) : undefined
  return model && car?.year && yearsFor(model).includes(car.year) ? { name: 'trim', model, year: car.year } : undefined
}

function CarPicker({ onDone, canCancel, start }: { onDone: () => void; canCancel: boolean; start?: Step }) {
  const [step, setStep] = useState<Step>(start ?? { name: 'model' })
  // Opened on the connected Tesla's own model and year: one tap back keeps the current car.
  const [fromCar, setFromCar] = useState(!!start && canCancel)
  const setVehicle = useStore((s) => s.setVehicle)

  const back = () => {
    if (fromCar) return onDone()
    if (step.name === 'trim') setStep({ name: 'year', model: step.model })
    else if (step.name === 'year') setStep({ name: 'model' })
    else onDone()
  }

  return (
    <div className="picker">
      {(step.name !== 'model' || canCancel) && (
        <button className="auth-back" onClick={back}>
          <CaretLeft size={18} weight="bold" aria-hidden />
          {fromCar || step.name === 'model' ? 'Keep my car' : step.name === 'year' ? 'Models' : `${step.model.name} years`}
        </button>
      )}
      {fromCar && step.name === 'trim' && (
        <p className="setting__hint picker__note">
          Your Tesla is a {step.year} {step.model.name}. Pick its version so charge at arrival fits this car.{' '}
          <button className="picker__link" onClick={() => { setFromCar(false); setStep({ name: 'model' }) }}>Not right? Choose another</button>
        </p>
      )}

      {step.name === 'model' && (
        <>
          <ul className="models">
            {MODELS.map((m) => (
              <li key={m.id}>
                <button className="model" onClick={() => setStep({ name: 'year', model: m })}>
                  <img className="model__photo" src={m.image} width={640} height={400} alt="" loading="lazy" />
                  <span className="model__name">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <details className="credits">
            <summary>Photo credits</summary>
            <ul>
              {MODELS.map((m) => (
                <li key={m.id}>
                  {m.name}:{' '}
                  <a href={m.credit.url} target="_blank" rel="noreferrer">
                    {m.credit.author}
                  </a>
                  , {m.credit.license}, cropped (Wikimedia Commons)
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      {step.name === 'year' && (
        <>
          <p className="picker__q">Which year is your {step.model.name}?</p>
          <ul className="years">
            {yearsFor(step.model).map((y) => (
              <li key={y}>
                <button className="year" onClick={() => setStep({ name: 'trim', model: step.model, year: y })}>{y}</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {step.name === 'trim' && (
        <>
          <p className="picker__q">Which {step.year} {step.model.name}?</p>
          <ul className="trims">
            {trimsFor(step.model, step.year).map((t) => (
              <li key={t.id}>
                <button
                  className="trim"
                  onClick={() => {
                    setVehicle({ model: step.model.id, year: step.year, trim: t.id })
                    onDone()
                  }}
                >
                  <span className="trim__name">{t.name}</span>
                  <span className="trim__meta">≈{t.kWh} kWh</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="setting__hint">Not sure? Pick the closest one. It only affects the charge-at-arrival estimate.</p>
        </>
      )}
    </div>
  )
}

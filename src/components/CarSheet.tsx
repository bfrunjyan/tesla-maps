import { useEffect, useRef, useState } from 'react'
import { CaretLeft, Minus, Plus, X } from '@phosphor-icons/react'
import { useStore } from '../state/store'
import { MODELS, trimsFor, vehicleSpec, yearsFor, type CarModel } from '../vehicle/catalog'
import { BatteryIcon } from './BatteryIcon'

/** Your car and its battery level. Opens from the battery chip on the map. */
export function CarSheet() {
  const vehicle = useStore((s) => s.vehicle)
  const set = useStore((s) => s.set)
  const [picking, setPicking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = () => set({ carSheetOpen: false })
  const spec = vehicleSpec(vehicle)
  const showPicker = picking || !spec

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
        {showPicker ? <CarPicker onDone={() => setPicking(false)} canCancel={!!spec} /> : <CarSummary onChange={() => setPicking(true)} />}
      </div>
    </div>
  )
}

function CarSummary({ onChange }: { onChange: () => void }) {
  const spec = vehicleSpec(useStore((s) => s.vehicle))!
  const battery = useStore((s) => s.battery)
  const setBattery = useStore((s) => s.setBattery)
  const pct = battery ? Math.round(battery.pct) : null

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
          {pct != null && <BatteryIcon pct={pct} size={22} />}
        </div>
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
      </section>
    </div>
  )
}

type Step = { name: 'model' } | { name: 'year'; model: CarModel } | { name: 'trim'; model: CarModel; year: number }

function CarPicker({ onDone, canCancel }: { onDone: () => void; canCancel: boolean }) {
  const [step, setStep] = useState<Step>({ name: 'model' })
  const setVehicle = useStore((s) => s.setVehicle)

  const back = () => {
    if (step.name === 'trim') setStep({ name: 'year', model: step.model })
    else if (step.name === 'year') setStep({ name: 'model' })
    else onDone()
  }

  return (
    <div className="picker">
      {(step.name !== 'model' || canCancel) && (
        <button className="auth-back" onClick={back}>
          <CaretLeft size={18} weight="bold" aria-hidden />
          {step.name === 'model' ? 'Keep my car' : step.name === 'year' ? 'Models' : `${step.model.name} years`}
        </button>
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

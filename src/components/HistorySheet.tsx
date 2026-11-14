import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import { fillPeriod, localDay, periodFor, shiftAnchor, sumTotals, whPerKm, type Bucket, type DayTotal, type Granularity, type Totals } from '../history/driveLog'
import { fetchDays, recordedToday } from '../history/recorder'
import { useStore } from '../state/store'
import { vehicleSpec } from '../vehicle/catalog'

type Metric = 'distance' | 'energy'

/** How often an open history refreshes. */
const REFRESH_MS = 20_000

/** Kilometres this device recorded today, kept current while the sheet is open. */
function useRecordedToday(): number {
  const [m, setM] = useState(recordedToday)
  useEffect(() => {
    const t = window.setInterval(() => setM(recordedToday()), 5_000)
    return () => window.clearInterval(t)
  }, [])
  return m / 1000
}

const GRANULARITIES: { value: Granularity; label: string; per: string; whole: string; current: string }[] = [
  { value: 'day', label: 'Days', per: 'per day', whole: 'Whole week', current: 'This week' },
  { value: 'week', label: 'Weeks', per: 'per week', whole: 'All 12 weeks', current: 'Last 12 weeks' },
  { value: 'month', label: 'Months', per: 'per month', whole: 'Whole year', current: 'This year' },
]

/* ------------------------------------------------------------ formatting */

const km = (metres: number) => {
  const v = metres / 1000
  return v === 0 ? '0' : v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-GB')
}
const kWh = (wh: number) => {
  const v = wh / 1000
  return v === 0 ? '0' : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('en-GB')
}
/** "46 min", "2 h 13 min", and whole hours once minutes stop mattering ("209 h"). */
export function duration(seconds: number): { value: string; unit: string } {
  const m = Math.round(seconds / 60)
  if (m < 60) return { value: String(m), unit: 'min' }
  if (m < 600) return { value: `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`, unit: 'min' }
  return { value: Math.round(m / 60).toLocaleString('en-GB'), unit: 'h' }
}
const metricValue = (t: Totals, metric: Metric) => (metric === 'distance' ? t.metres / 1000 : t.wh / 1000)
const metricLabel = (t: Totals, metric: Metric) => (metric === 'distance' ? `${km(t.metres)} km` : `${kWh(t.wh)} kWh`)

/** Round axis steps: 1, 2 or 5 times a power of ten, so the top line sits just above the tallest bar. */
export function axisTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  const top = Math.ceil(max / step) * step
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6))
}

/* ------------------------------------------------------------ sheet */

/** Driving history: distance and energy by day, week or month, from the account. */
export function HistorySheet() {
  const open = useStore((s) => s.historyOpen)
  const signedIn = useStore((s) => !!s.user)
  const set = useStore((s) => s.set)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ historyOpen: false })
    window.addEventListener('keydown', onKey)
    sheetRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, set])

  if (!open) return null
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && set({ historyOpen: false })}>
      <div ref={sheetRef} className="surface sheet hist" role="dialog" aria-modal="true" aria-labelledby="hist-title" tabIndex={-1} data-wide="true">
        <header className="sheet__head hist__head">
          {signedIn && (
            <button className="icon-btn" aria-label="Back to your account" onClick={() => set({ historyOpen: false, accountOpen: true })}>
              <ArrowLeft size={22} weight="bold" />
            </button>
          )}
          <h2 id="hist-title" className="sheet__title">Driving history</h2>
          <button className="icon-btn hist__close" aria-label="Close" onClick={() => set({ historyOpen: false })}>
            <X size={22} weight="bold" />
          </button>
        </header>
        <History signedIn={signedIn} />
      </div>
    </div>
  )
}

function History({ signedIn }: { signedIn: boolean }) {
  const today = localDay(Date.now())
  const vehicle = useStore((s) => s.vehicle)
  const [g, setG] = useState<Granularity>('day')
  const [anchor, setAnchor] = useState(today)
  const [metric, setMetric] = useState<Metric>('distance')
  const [selected, setSelected] = useState<number | null>(null)
  const [days, setDays] = useState<DayTotal[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  const blank = useMemo(() => periodFor(g, anchor, today), [g, anchor, today])
  useEffect(() => {
    let stale = false
    const load = (quiet: boolean) => {
      if (!quiet) setState('loading')
      fetchDays(blank.from, blank.to, signedIn)
        .then((d) => {
          if (stale) return
          setDays(d)
          setState('ready')
        })
        .catch(() => !stale && !quiet && setState('error'))
    }
    load(false)
    // Live while open: today's driving shows up as it happens, without a flicker.
    const timer = window.setInterval(() => load(true), REFRESH_MS)
    return () => {
      stale = true
      window.clearInterval(timer)
    }
  }, [blank, signedIn, attempt])
  const todayKm = useRecordedToday()

  const period = fillPeriod(blank, days ?? [])
  const meta = GRANULARITIES.find((x) => x.value === g)!
  const pick = selected != null ? period.buckets[selected] : null
  const totals = pick ?? sumTotals(period.buckets)
  const busiest = busiestBucket(period.buckets)
  const isCurrent = period.buckets.some((b) => b.current)
  const nextAnchor = shiftAnchor(g, anchor, 1)
  const canGoForward = periodFor(g, nextAnchor, today).from <= today
  const spec = vehicleSpec(vehicle)

  const go = (next: { g?: Granularity; anchor?: string }) => {
    setSelected(null)
    if (next.g) setG(next.g)
    if (next.anchor) setAnchor(next.anchor)
  }

  return (
    <div className="hist__body">
      <div className="hist__filters">
        <div className="segmented hist__granularity" role="radiogroup" aria-label="Show">
          {GRANULARITIES.map((o) => (
            <button key={o.value} className="segmented__opt" role="radio" aria-checked={g === o.value} onClick={() => go({ g: o.value, anchor: today })}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="hist__period">
          <button className="icon-btn" aria-label="Earlier" onClick={() => go({ anchor: shiftAnchor(g, anchor, -1) })}>
            <CaretLeft size={22} weight="bold" />
          </button>
          <span className="hist__period-title" aria-live="polite">{period.title}</span>
          <button className="icon-btn" aria-label="Later" disabled={!canGoForward} onClick={() => go({ anchor: nextAnchor })}>
            <CaretRight size={22} weight="bold" />
          </button>
        </div>
      </div>

      <section className="hist__summary" aria-label="Totals" data-loading={state === 'loading' && days != null}>
        <div className="hist__scope">
          <span className="hist__scope-name">{pick ? pick.full : isCurrent ? meta.current : period.title}</span>
          {pick ? (
            <button className="hist__link" onClick={() => setSelected(null)}>
              {meta.whole}
            </button>
          ) : (
            busiest && <span className="hist__busiest">Most driving: {busiest.label}, {km(busiest.metres)} km</span>
          )}
        </div>
        <Totals totals={totals} />
      </section>

      <section className="hist__chart-block" aria-labelledby="hist-chart-title">
        <div className="hist__chart-head">
          <h3 id="hist-chart-title" className="hist__chart-title">
            {metric === 'distance' ? 'Distance' : 'Energy'} {meta.per}
          </h3>
          <div className="segmented hist__metric" role="radiogroup" aria-label="Chart shows">
            {(['distance', 'energy'] as const).map((m) => (
              <button key={m} className="segmented__opt" role="radio" aria-checked={metric === m} onClick={() => setMetric(m)}>
                {m === 'distance' ? 'km' : 'kWh'}
              </button>
            ))}
          </div>
        </div>
        {state === 'error' && days == null ? (
          <div className="hist__message" role="alert">
            <p>Couldn’t load your history. Check the connection.</p>
            <button className="btn btn--sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <Chart
            buckets={period.buckets}
            metric={metric}
            selected={selected}
            onSelect={(i) => setSelected(i === selected ? null : i)}
            loading={state === 'loading'}
            empty={state !== 'loading' && totals.metres === 0 && !pick}
            emptyText={g === 'day' ? 'No drives this week' : g === 'week' ? 'No drives in these 12 weeks' : 'No drives this year'}
          />
        )}
      </section>

      <PriceSetting />

      <p className="hist__note">
        {todayKm > 0 ? `Recorded on this screen today: ${km(todayKm * 1000)} km. ` : ''}Mapic records drives while it’s open on the car screen. Energy is an estimate {spec ? `for your ${spec.title}` : 'for a Model Y-class car'}, from
        distance, speed and hills.
      </p>
    </div>
  )
}

/** The bucket with the most driving, when at least two have some (one alone isn't a highlight). */
export function busiestBucket(buckets: Bucket[]): Bucket | null {
  const driven = buckets.filter((b) => b.metres > 0)
  if (driven.length < 2) return null
  return driven.reduce((a, b) => (b.metres > a.metres ? b : a))
}

/** "≈ 1,240 ֏" for the energy at the driver's price, or null without a price. */
export function costLabel(wh: number, price: number | null): string | null {
  if (price == null || !(price > 0)) return null
  return `≈ ${Math.round((wh / 1000) * price).toLocaleString('en-GB')} ֏`
}

function Totals({ totals }: { totals: Totals }) {
  const price = useStore((s) => s.kwhPrice)
  const time = duration(totals.seconds)
  const avg = whPerKm(totals)
  const items: { label: string; value: string; unit: string; extra?: string | null }[] = [
    { label: 'Distance', value: km(totals.metres), unit: 'km' },
    { label: 'Energy used', value: kWh(totals.wh), unit: 'kWh', extra: costLabel(totals.wh, price) },
    { label: 'Driving time', value: time.value, unit: time.unit },
    { label: 'Average', value: avg != null ? String(Math.round(avg)) : '–', unit: avg != null ? 'Wh/km' : '' },
  ]
  return (
    <dl className="hist__totals">
      {items.map((it) => (
        <div key={it.label} className="hist__total">
          <dt>{it.label}</dt>
          <dd>
            <span className="hist__total-value">{it.value}</span>
            {it.unit && <span className="hist__total-unit">{it.unit}</span>}
          </dd>
          {it.extra && <dd className="hist__total-extra">{it.extra}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** The electricity price, for the cost of the energy used. Kept on this device. */
function PriceSetting() {
  const price = useStore((s) => s.kwhPrice)
  const [text, setText] = useState(price != null ? String(price) : '')
  const commit = () => {
    const v = Number(text.replace(',', '.'))
    useStore.getState().set({ kwhPrice: text.trim() && v > 0 && v < 10_000 ? Math.round(v * 100) / 100 : null })
  }
  return (
    <label className="hist__price">
      <span className="hist__price-label">Electricity price</span>
      <input
        className="hist__price-input"
        inputMode="decimal"
        placeholder="e.g. 48"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        aria-describedby="hist-price-unit"
      />
      <span id="hist-price-unit" className="hist__price-unit">֏ per kWh{price == null ? ' · shows the cost of each period' : ''}</span>
    </label>
  )
}

/* ------------------------------------------------------------ chart */

function Chart({
  buckets,
  metric,
  selected,
  onSelect,
  loading,
  empty,
  emptyText,
}: {
  buckets: Bucket[]
  metric: Metric
  selected: number | null
  onSelect: (i: number) => void
  loading: boolean
  empty: boolean
  emptyText: string
}) {
  const values = buckets.map((b) => metricValue(b, metric))
  const ticks = axisTicks(Math.max(...values))
  const top = ticks[ticks.length - 1] || 1
  const unit = metric === 'distance' ? 'km' : 'kWh'
  // One value is printed on the chart: the chosen bar's, or else the tallest.
  const labelled = selected ?? (values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : null)

  return (
    <div className="chart" data-loading={loading} data-has-selection={selected != null}>
      <div className="chart__plot">
        <div className="chart__grid" aria-hidden>
          {ticks.map((t) => (
            <div key={t} className="chart__gridline" style={{ bottom: `${(t / top) * 100}%` }}>
              <span className="chart__tick">{t.toLocaleString('en-GB')}</span>
            </div>
          ))}
          <span className="chart__unit">{unit}</span>
        </div>
        <div className="chart__cols" style={{ gridTemplateColumns: `repeat(${buckets.length}, 1fr)` }}>
          {buckets.map((b, i) => {
            const v = values[i]
            const h = (v / top) * 100
            return (
              <button
                key={b.from}
                className="chart__col"
                aria-pressed={selected === i}
                aria-label={b.future ? `${b.full}: not yet` : `${b.full}: ${metricLabel(b, 'distance')}, ${metricLabel(b, 'energy')}`}
                disabled={b.future}
                data-current={b.current}
                onClick={() => onSelect(i)}
              >
                <span className="chart__slot">
                  {v > 0 && (
                    <span className="chart__bar" style={{ height: `${h}%` }}>
                      {labelled === i && <span className="chart__value">{metric === 'distance' ? km(b.metres) : kWh(b.wh)}</span>}
                    </span>
                  )}
                </span>
                <span className="chart__label">{b.label}</span>
              </button>
            )
          })}
        </div>
        {empty && (
          <p className="chart__empty">
            {emptyText}
          </p>
        )}
      </div>
      {/* The same numbers as a table, for screen readers. */}
      <table className="visually-hidden">
        <caption>Driving history</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Distance</th>
            <th scope="col">Energy</th>
            <th scope="col">Driving time</th>
          </tr>
        </thead>
        <tbody>
          {buckets
            .filter((b) => !b.future)
            .map((b) => (
              <tr key={b.from}>
                <th scope="row">{b.full}</th>
                <td>{km(b.metres)} km</td>
                <td>{kWh(b.wh)} kWh</td>
                <td>{Math.round(b.seconds / 60)} min</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

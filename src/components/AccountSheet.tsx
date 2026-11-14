import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowClockwise, CaretRight, ChartBar, CircleNotch, SignOut, Trash, X } from '@phosphor-icons/react'
import { localDay, sumTotals, weekStart } from '../history/driveLog'
import { fetchDays } from '../history/recorder'
import { api, ApiError } from '../services/api'
import { completeSignIn, deleteAccount, signOut } from '../state/session'
import { useStore } from '../state/store'
import { AuthForms } from './AuthForms'

/** Account sheet in the car: QR sign-in (scan with phone) or sign in on screen. */
export function AccountSheet() {
  const open = useStore((s) => s.accountOpen)
  const user = useStore((s) => s.user)
  const set = useStore((s) => s.set)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && set({ accountOpen: false })
    window.addEventListener('keydown', onKey)
    sheetRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, set])

  if (!open) return null
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && set({ accountOpen: false })}>
      <div
        ref={sheetRef}
        className="surface sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        tabIndex={-1}
        data-wide={!user}
      >
        <header className="sheet__head">
          <h2 id="account-title" className="sheet__title">{user ? 'Your account' : 'Sign in'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={() => set({ accountOpen: false })}>
            <X size={22} weight="bold" />
          </button>
        </header>
        {user ? <SignedIn /> : <SignedOut />}
      </div>
    </div>
  )
}

function SignedOut() {
  return (
    <div className="sheet__cols">
      <section className="sheet__col">
        <h3 className="sheet__subtitle">Scan with your phone</h3>
        <p className="sheet__text">Sign in on your phone and this car signs in too. No typing here.</p>
        <QrPairing />
      </section>
      <section className="sheet__col">
        <h3 className="sheet__subtitle">Or sign in here</h3>
        <p className="sheet__text">Keep Home, Work, favorites and history on every car and device.</p>
        <AuthForms onSignedIn={completeSignIn} returnTo={location.pathname} />
      </section>
    </div>
  )
}

type Pairing = { code: string; pollToken: string; url: string; expiresAt: number; qr: string }

function QrPairing() {
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading')
  const [now, setNow] = useState(Date.now())
  const theme = useStore((s) => s.theme)

  const start = async () => {
    setState('loading')
    try {
      const p = await api.qrStart()
      const url = `${location.origin}${p.path}`
      const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#171a20', light: '#ffffff' } })
      setPairing({ code: p.code, pollToken: p.pollToken, url, expiresAt: new Date(p.expiresAt).getTime(), qr })
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => {
    start()
  }, [])

  // Poll until the phone approves, the code expires, or the sheet closes.
  useEffect(() => {
    if (state !== 'ready' || !pairing) return
    let stopped = false
    const tick = async () => {
      if (stopped) return
      setNow(Date.now())
      if (Date.now() > pairing.expiresAt) return setState('expired')
      try {
        const r = await api.qrPoll(pairing.pollToken)
        if (stopped) return
        if (r.status === 'approved' && r.user) return completeSignIn(r.user)
        if (r.status === 'expired' || r.status === 'claimed' || r.status === 'invalid') return setState('expired')
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return setState('expired')
      }
      timer = window.setTimeout(tick, 2000)
    }
    let timer = window.setTimeout(tick, 2000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [state, pairing])

  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0

  return (
    <div className="qr" data-theme={theme}>
      <div className="qr__frame" aria-live="polite">
        {state === 'ready' && pairing ? (
          <img className="qr__img" src={pairing.qr} width={220} height={220} alt={`QR code to sign in. Or open ${pairing.url}`} />
        ) : state === 'loading' ? (
          <CircleNotch weight="bold" className="spin" size={28} aria-label="Creating code" />
        ) : (
          <div className="qr__expired">
            <p>{state === 'error' ? 'Couldn’t create a code.' : 'This code expired.'}</p>
            <button className="btn" onClick={start}>
              <ArrowClockwise size={18} weight="bold" aria-hidden /> New code
            </button>
          </div>
        )}
      </div>
      {state === 'ready' && pairing && (
        <p className="qr__code">
          Code <strong>{pairing.code}</strong>
          <span className="qr__timer">
            {' '}· {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </span>
        </p>
      )}
    </div>
  )
}

/** The way into driving history, with this week's distance so far. */
function HistoryEntry() {
  const set = useStore((s) => s.set)
  const [week, setWeek] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    const today = localDay(Date.now())
    const from = weekStart(today)
    fetchDays(from, today, true)
      .then((days) => {
        if (stale) return
        const km = sumTotals(days).metres / 1000
        setWeek(`${km < 10 ? km.toFixed(1) : Math.round(km)} km this week`)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])
  return (
    <button className="account__entry" onClick={() => set({ accountOpen: false, historyOpen: true })}>
      <span className="account__entry-icon" aria-hidden>
        <ChartBar size={22} weight="bold" />
      </span>
      <span className="account__entry-text">
        <span className="account__entry-title">Driving history</span>
        <span className="account__entry-sub">{week ?? 'Distance and energy by day, week and month'}</span>
      </span>
      <CaretRight size={20} weight="bold" aria-hidden className="account__entry-caret" />
    </button>
  )
}

function SignedIn() {
  const user = useStore((s) => s.user)!
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  return (
    <div className="account">
      <div className="account__who">
        <span className="avatar avatar--lg" aria-hidden>{(user.name ?? user.email)[0].toUpperCase()}</span>
        <div className="account__names">
          {user.name && <span className="account__name">{user.name}</span>}
          <span className="account__email">{user.email}</span>
        </div>
      </div>
      <HistoryEntry />
      <p className="sheet__text">Home, Work, favorites, recent destinations and driving history are saved to your account and sync to any car you sign in to.</p>
      {error && <p className="field__error" role="alert">{error}</p>}
      {confirmDelete ? (
        <div className="account__confirm">
          <p className="sheet__text"><strong>Delete your account?</strong> Your saved places are permanently deleted. This can’t be undone.</p>
          <div className="account__actions">
            <button className="btn" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep account</button>
            <button
              className="btn btn--danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await deleteAccount()
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Couldn’t delete the account.')
                  setBusy(false)
                }
              }}
            >
              {busy && <CircleNotch weight="bold" className="spin" size={18} aria-hidden />}
              Delete permanently
            </button>
          </div>
        </div>
      ) : (
        <div className="account__actions">
          <button className="btn" onClick={() => signOut()}>
            <SignOut size={20} aria-hidden /> Sign out
          </button>
          <button className="btn btn--ghost-danger" onClick={() => setConfirmDelete(true)}>
            <Trash size={20} aria-hidden /> Delete account
          </button>
        </div>
      )}
    </div>
  )
}

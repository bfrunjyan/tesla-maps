import { useEffect, useState } from 'react'
import { CheckCircle, CircleNotch, WarningCircle } from '@phosphor-icons/react'
import { api, ApiError, type User } from '../services/api'
import { useStore } from '../state/store'
import { AuthForms } from './AuthForms'

/**
 * Phone page opened from the car's QR code (/link?c=CODE): sign in here,
 * confirm the code matches the car, and the car signs in.
 */
export function LinkPage() {
  const code = (new URLSearchParams(location.search).get('c') ?? '').toUpperCase()
  const authReady = useStore((s) => s.authReady)
  const user = useStore((s) => s.user)
  const set = useStore((s) => s.set)
  const [codeState, setCodeState] = useState<'checking' | 'valid' | 'expired'>('checking')
  const [step, setStep] = useState<'idle' | 'linking' | 'done'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!code) return setCodeState('expired')
    api.qrCheck(code).then(() => setCodeState('valid'), () => setCodeState('expired'))
  }, [code])

  const link = async () => {
    setStep('linking')
    setError('')
    try {
      await api.qrApprove(code)
      setStep('done')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t sign in the car. Try again.')
      setStep('idle')
    }
  }

  const onSignedIn = (u: User) => set({ user: u })

  let content
  if (!authReady || codeState === 'checking') {
    content = <CircleNotch weight="bold" className="spin" size={28} aria-label="Loading" />
  } else if (step === 'done') {
    content = (
      <>
        <CheckCircle size={56} className="link__icon link__icon--ok" aria-hidden />
        <h1 className="link__title">Your car is signed in</h1>
        <p className="link__text">Your places are on the car screen now. You can close this page.</p>
      </>
    )
  } else if (codeState === 'expired') {
    content = (
      <>
        <WarningCircle size={56} className="link__icon" aria-hidden />
        <h1 className="link__title">This code has expired</h1>
        <p className="link__text">Tap “New code” on the car screen and scan it again.</p>
      </>
    )
  } else if (!user) {
    content = (
      <>
        <h1 className="link__title">Sign in to your car</h1>
        <p className="link__text">
          Check the car shows <strong className="link__code">{code}</strong>, then sign in.
        </p>
        <AuthForms onSignedIn={onSignedIn} returnTo={`/link?c=${encodeURIComponent(code)}`} />
      </>
    )
  } else {
    content = (
      <>
        <h1 className="link__title">Sign in the car?</h1>
        <p className="link__text">
          The car showing <strong className="link__code">{code}</strong> will be signed in as <strong>{user.email}</strong>.
        </p>
        {error && <p className="field__error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" onClick={link} disabled={step === 'linking'}>
          {step === 'linking' && <CircleNotch weight="bold" className="spin" size={18} aria-hidden />}
          Sign in the car
        </button>
        <button
          className="link-btn"
          onClick={async () => {
            await api.logout().catch(() => {})
            set({ user: null })
          }}
        >
          Not you? Use another account
        </button>
      </>
    )
  }

  return (
    <main className="link">
      <div className="surface link__card">{content}</div>
    </main>
  )
}

import { useState, type FormEvent } from 'react'
import { ArrowLeft, CircleNotch, EnvelopeSimple, GoogleLogo, Key } from '@phosphor-icons/react'
import { api, ApiError, type User } from '../services/api'
import { useStore } from '../state/store'

type Mode = 'choose' | 'code' | 'password'

/**
 * Email code, email + password and Google sign-in. Shared by the car's
 * account sheet and the phone's QR link page.
 */
export function AuthForms({ onSignedIn, returnTo }: { onSignedIn: (user: User) => void; returnTo: string }) {
  const methods = useStore((s) => s.authMethods)
  const [mode, setMode] = useState<Mode>('choose')

  if (mode === 'code') return <EmailCodeForm onBack={() => setMode('choose')} onSignedIn={onSignedIn} />
  if (mode === 'password') return <PasswordForm onBack={() => setMode('choose')} onSignedIn={onSignedIn} />

  return (
    <div className="auth-choices">
      {methods?.google && (
        <a className="btn btn--block auth-google" href={api.googleUrl(returnTo)}>
          <GoogleLogo size={20} weight="bold" aria-hidden /> Continue with Google
        </a>
      )}
      {methods?.emailCode !== false && (
        <button className="btn btn--block" onClick={() => setMode('code')}>
          <EnvelopeSimple size={20} aria-hidden /> Email me a sign-in code
        </button>
      )}
      <button className="btn btn--block" onClick={() => setMode('password')}>
        <Key size={20} aria-hidden /> Use email and password
      </button>
    </div>
  )
}

function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="auth-back" onClick={onBack}>
      <ArrowLeft size={18} weight="bold" aria-hidden /> Other ways to sign in
    </button>
  )
}

function Submit({ busy, children }: { busy: boolean; children: string }) {
  return (
    <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
      {busy && <CircleNotch weight="bold" className="spin" size={18} aria-hidden />}
      {children}
    </button>
  )
}

function EmailCodeForm({ onBack, onSignedIn }: { onBack: () => void; onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { busy, error, run } = useSubmit()

  const send = (e?: FormEvent) => {
    e?.preventDefault()
    run(async () => {
      await api.emailStart(email)
      setSentTo(email.trim())
      setCode('')
    })
  }
  const verify = (e: FormEvent) => {
    e.preventDefault()
    run(async () => onSignedIn((await api.emailVerify(sentTo!, code)).user))
  }

  if (!sentTo) {
    return (
      <form className="auth-form" onSubmit={send} noValidate>
        <Back onBack={onBack} />
        <label className="field">
          <span className="field__label">Email</span>
          <input className="field__input" type="email" inputMode="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {error && <p className="field__error" role="alert">{error}</p>}
        <Submit busy={busy}>Send code</Submit>
      </form>
    )
  }
  return (
    <form className="auth-form" onSubmit={verify} noValidate>
      <Back onBack={onBack} />
      <p className="auth-note">We sent a 6-digit code to <strong>{sentTo}</strong>.</p>
      <label className="field">
        <span className="field__label">Code</span>
        <input
          className="field__input field__input--code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </label>
      {error && <p className="field__error" role="alert">{error}</p>}
      <Submit busy={busy}>Sign in</Submit>
      <button type="button" className="link-btn" disabled={busy} onClick={() => send()}>
        Send a new code
      </button>
    </form>
  )
}

function PasswordForm({ onBack, onSignedIn }: { onBack: () => void; onSignedIn: (u: User) => void }) {
  const [creating, setCreating] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, setError, run } = useSubmit()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (creating && password.length < 8) return setError('Use at least 8 characters for the password.')
    run(async () => onSignedIn((creating ? await api.register(email, password) : await api.login(email, password)).user))
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <Back onBack={onBack} />
      <div className="segmented" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={!creating} className="segmented__opt" onClick={() => setCreating(false)}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={creating} className="segmented__opt" onClick={() => setCreating(true)}>
          Create account
        </button>
      </div>
      <label className="field">
        <span className="field__label">Email</span>
        <input className="field__input" type="email" inputMode="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Password{creating && <span className="field__hint"> · at least 8 characters</span>}</span>
        <input
          className="field__input"
          type="password"
          autoComplete={creating ? 'new-password' : 'current-password'}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="field__error" role="alert">{error}</p>}
      <Submit busy={busy}>{creating ? 'Create account' : 'Sign in'}</Submit>
    </form>
  )
}

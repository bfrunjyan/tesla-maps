import { describe, expect, it } from 'vitest'
import { signInCodeEmail } from '../lib/emailTemplates.ts'

describe('sign-in code email', () => {
  const email = signInCodeEmail('482917')

  it('puts the code first in the subject (readable from the notification)', () => {
    expect(email.subject).toBe('482917 is your Mapic sign-in code')
  })

  it('shows the code as one string, protected from auto-translation', () => {
    expect(email.html).toMatch(/translate="no"[^>]*>482917</)
  })

  it('has a plain-text part with the code, expiry and a safety note', () => {
    expect(email.text).toContain('Your Mapic sign-in code is 482917')
    expect(email.text).toContain('expires in 10 minutes')
    expect(email.text).toContain("Didn't ask for this?")
  })

  it('declares dark mode support and sizes the logo', () => {
    expect(email.html).toContain('name="color-scheme" content="light dark"')
    expect(email.html).toMatch(/<img[^>]+width="32"[^>]+height="32"/)
  })
})

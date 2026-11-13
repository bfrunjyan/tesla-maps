import { config } from '../config.ts'

/**
 * Sends the sign-in code. Uses Resend when RESEND_API_KEY and EMAIL_FROM are set;
 * otherwise (local development only) prints the code to the server log.
 */
export async function sendSignInCode(to: string, code: string) {
  if (!config.email.resendApiKey || !config.email.from) {
    if (config.production) throw new Error('Email is not configured')
    console.log(`[email:dev] sign-in code for ${to}: ${code}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.email.from,
      to: [to],
      subject: `${code} is your Mapic sign-in code`,
      text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    }),
  })
  if (!res.ok) {
    // Resend explains the problem (unverified domain, bad key, invalid "from") in the body.
    const detail = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`)
  }
}

import { config } from '../config.ts'

/**
 * Transactional email layout. Email clients ignore most modern CSS, so this is
 * table-based with inline styles; the <style> block only adds dark mode and
 * small-screen tweaks for clients that support it (Apple Mail, iOS, Outlook.com).
 * Gmail apps apply their own dark mode to the inline colours.
 */

const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`
const MONO = `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`

const C = {
  page: '#f2f2f0',
  card: '#ffffff',
  border: '#e6e5e3',
  ink: '#171a20',
  muted: '#5c5e62',
  faint: '#8e8e8e',
  codeBg: '#f4f4f3',
}

function layout({ title, preheader, body }: { title: string; preheader: string; body: string }) {
  const site = config.appUrl
  const host = new URL(site).host
  // Pads the inbox preview so it doesn't pull in the body text after the preheader.
  const previewPad = '&#8199;&#65279;&#847;'.repeat(60)
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .m-page { background-color: #0f1012 !important; }
    .m-card { background-color: #1c1d20 !important; border-color: #2b2c30 !important; }
    .m-ink { color: #f1eff0 !important; }
    .m-muted { color: #a7a3a5 !important; }
    .m-faint { color: #807c7e !important; }
    .m-code-box { background-color: #26272b !important; border-color: #34353a !important; }
    .m-code { color: #ffffff !important; }
    .m-rule { border-color: #2b2c30 !important; }
    .m-link { color: #c9c6c8 !important; }
  }
  @media (max-width: 520px) {
    .m-card-pad { padding: 28px 22px !important; }
    .m-code { font-size: 34px !important; letter-spacing: 7px !important; padding-left: 7px !important; }
  }
</style>
</head>
<body class="m-page" style="margin:0; padding:0; background-color:${C.page}; -webkit-text-size-adjust:100%;">
<div style="display:none; max-height:0; max-width:0; overflow:hidden; opacity:0; mso-hide:all;">${preheader}${previewPad}</div>
<table role="presentation" class="m-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background-color:${C.page};">
  <tr>
    <td align="center" style="padding:40px 16px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 4px 18px;">
            <a href="${site}" style="text-decoration:none;">
              <img src="${site}/email/mapic-mark.png" width="32" height="32" alt="" style="display:inline-block; width:32px; height:32px; border:0; border-radius:8px; vertical-align:middle;">
              <span class="m-ink" translate="no" style="display:inline-block; margin-left:10px; vertical-align:middle; font-family:${FONT}; font-size:19px; font-weight:700; letter-spacing:-0.2px; color:${C.ink};">Mapic</span>
            </a>
          </td>
        </tr>
        <tr>
          <td class="m-card m-card-pad" style="background-color:${C.card}; border:1px solid ${C.border}; border-radius:16px; padding:36px 32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 8px 0; font-family:${FONT}; font-size:12px; line-height:18px; color:${C.faint};" class="m-faint">
            Mapic · navigation for your car’s screen<br>
            <a class="m-link" href="${site}" style="color:${C.muted}; text-decoration:underline;">${host}</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

export function signInCodeEmail(code: string) {
  const minutes = 10
  const subject = `${code} is your Mapic sign-in code`
  const html = layout({
    title: 'Your Mapic sign-in code',
    preheader: `Enter it on the screen where you’re signing in. It expires in ${minutes} minutes.`,
    body: `
            <h1 class="m-ink" style="margin:0 0 8px; font-family:${FONT}; font-size:22px; line-height:28px; font-weight:700; color:${C.ink};">Your sign-in code</h1>
            <p class="m-muted" style="margin:0 0 24px; font-family:${FONT}; font-size:15px; line-height:23px; color:${C.muted};">Enter this code on the car screen or phone where you’re signing in to Mapic.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="m-code-box" align="center" style="background-color:${C.codeBg}; border:1px solid ${C.border}; border-radius:12px; padding:20px 12px;">
                  <span class="m-code" translate="no" style="display:inline-block; padding-left:10px; font-family:${MONO}; font-size:40px; line-height:48px; font-weight:700; letter-spacing:10px; color:${C.ink}; font-variant-numeric:tabular-nums;">${code}</span>
                </td>
              </tr>
            </table>
            <p class="m-muted" style="margin:14px 0 0; font-family:${FONT}; font-size:13px; line-height:20px; color:${C.muted}; text-align:center;">Expires in ${minutes}&nbsp;minutes · works once</p>
            <hr class="m-rule" style="margin:28px 0 20px; border:0; border-top:1px solid ${C.border};">
            <p class="m-muted" style="margin:0; font-family:${FONT}; font-size:13px; line-height:20px; color:${C.muted};"><strong class="m-ink" style="color:${C.ink};">Didn’t ask for this?</strong> You can ignore this email. No one can sign in without the code, and it stops working in ${minutes}&nbsp;minutes.</p>`,
  })
  const text = [
    `Your Mapic sign-in code is ${code}`,
    '',
    `Enter it on the car screen or phone where you're signing in. It expires in ${minutes} minutes and works once.`,
    '',
    `Didn't ask for this? You can ignore this email. No one can sign in without the code.`,
    '',
    `Mapic · ${config.appUrl}`,
  ].join('\n')
  return { subject, html, text }
}

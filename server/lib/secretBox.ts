import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/**
 * Encrypts small secrets (Tesla tokens) before they go into the database, so a
 * database leak alone doesn't expose them. AES-256-GCM; the key is derived from
 * a server secret that lives only in the environment.
 */
const keys = new Map<string, Buffer>()
function keyFor(secret: string) {
  let key = keys.get(secret)
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', secret, 'mapic', 'stored-tokens', 32))
    keys.set(secret, key)
  }
  return key
}

export function seal(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

/** Returns null when the value was sealed with another secret or was tampered with. */
export function open(sealed: string, secret: string): string | null {
  const [version, iv, tag, body] = sealed.split('.')
  if (version !== 'v1' || !iv || !tag || body === undefined) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

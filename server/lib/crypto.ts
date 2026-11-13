import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))))

// scrypt parameters (OWASP: N=2^17, r=8, p=1). Encoded with the hash so they can be raised later.
const N = 2 ** 17
const R = 8
const P = 1
const KEYLEN = 32
const MAXMEM = 256 * 1024 * 1024

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$')
  if (algo !== 'scrypt') return false
  const expected = Buffer.from(keyB64, 'base64')
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Hash used to verify a password for a non-existent user, so timing doesn't reveal which emails exist. */
let dummyHash: Promise<string> | null = null
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  return dummyHash
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** 6-digit numeric code for email sign-in. */
export function numericCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Short pairing code shown under the QR: unambiguous letters/digits, e.g. "K7QF-M2XP". */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function pairingCode() {
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(0, ALPHABET.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

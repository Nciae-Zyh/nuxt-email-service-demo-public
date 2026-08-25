const encoder = new TextEncoder()

// Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
export const DEFAULT_PASSWORD_ITERATIONS = 100_000

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export function randomSalt(): string {
  return randomToken(16)
}

async function derivePassword(
  password: string,
  salt: string,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64UrlToBytes(salt).buffer as ArrayBuffer,
      iterations
    },
    key,
    256
  )
  return new Uint8Array(bits)
}

export async function hashPassword(
  password: string,
  salt = randomSalt(),
  iterations = DEFAULT_PASSWORD_ITERATIONS
): Promise<{ hash: string, salt: string, iterations: number }> {
  const derived = await derivePassword(password, salt, iterations)
  return { hash: bytesToBase64Url(derived), salt, iterations }
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
  iterations: number
): Promise<boolean> {
  const actual = await derivePassword(password, salt, iterations)
  const expected = base64UrlToBytes(expectedHash)

  if (actual.byteLength !== expected.byteLength) return false

  let difference = 0
  for (let index = 0; index < actual.byteLength; index += 1) {
    difference |= actual[index]! ^ expected[index]!
  }
  return difference === 0
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return bytesToBase64Url(new Uint8Array(digest))
}

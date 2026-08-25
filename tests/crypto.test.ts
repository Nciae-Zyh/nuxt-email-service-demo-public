import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  hashToken,
  randomToken,
  verifyPassword
} from '../server/utils/crypto'

describe('password hashing', () => {
  it('verifies the correct password and rejects an incorrect password', async () => {
    const password = 'correct horse battery staple'
    const result = await hashPassword(password, undefined, 100_000)

    await expect(
      verifyPassword(password, result.hash, result.salt, result.iterations)
    ).resolves.toBe(true)
    await expect(
      verifyPassword('wrong password', result.hash, result.salt, result.iterations)
    ).resolves.toBe(false)
  })

  it('creates opaque random session tokens and stable token digests', async () => {
    const first = randomToken()
    const second = randomToken()

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[\w-]+$/u)
    await expect(hashToken(first)).resolves.toBe(await hashToken(first))
  })
})

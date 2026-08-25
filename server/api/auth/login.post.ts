import { z } from 'zod'
import type { AuthSessionResponse } from '#shared/types'
import { verifyPassword } from '../../utils/crypto'
import { useCloudflareEnv } from '../../utils/bindings'
import { createUserSession } from '../../utils/session'
import { assertSameOrigin } from '../../utils/security'
import {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure
} from '../../utils/login-rate-limit'

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256)
})

interface UserRow {
  id: number
  email: string
  password_hash: string
  password_salt: string
  password_iterations: number
  role: 'admin'
}

export default defineEventHandler(async (event): Promise<AuthSessionResponse> => {
  assertSameOrigin(event)
  const parsed = loginSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid login payload' })
  }

  const email = parsed.data.email.toLowerCase()
  await assertLoginAllowed(event, email)
  const env = useCloudflareEnv(event)
  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, password_salt, password_iterations, role
     FROM users WHERE email = ?`
  ).bind(email).first<UserRow>()

  const validPassword = user
    ? await verifyPassword(
        parsed.data.password,
        user.password_hash,
        user.password_salt,
        user.password_iterations
      )
    : false

  if (!user || !validPassword) {
    await recordLoginFailure(event, email)
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid credentials',
      message: '用户名或密码不正确。'
    })
  }

  await clearLoginFailures(event, email)
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .bind(Math.floor(Date.now() / 1000))
    .run()
  await createUserSession(event, user.id)

  return { user: { id: user.id, email: user.email, role: user.role } }
})

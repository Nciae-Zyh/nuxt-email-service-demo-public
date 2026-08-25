import type { H3Event } from 'h3'
import type { AuthUser } from '#shared/types'
import { hashToken, randomToken } from './crypto'
import { useCloudflareEnv } from './bindings'

const SESSION_COOKIE = 'cf_email_session'
const DEFAULT_SESSION_TTL = 8 * 60 * 60

interface SessionUserRow {
  id: number
  email: string
  role: 'admin'
  expires_at: number
}

function getSessionTtl(env: CloudflareEnv): number {
  const configured = Number.parseInt(env.SESSION_TTL_SECONDS, 10)
  if (!Number.isFinite(configured)) return DEFAULT_SESSION_TTL
  return Math.min(Math.max(configured, 15 * 60), 7 * 24 * 60 * 60)
}

function cookieOptions(event: H3Event, maxAge: number) {
  return {
    httpOnly: true,
    secure: getRequestURL(event).protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/',
    maxAge
  }
}

export async function createUserSession(event: H3Event, userId: number): Promise<void> {
  const env = useCloudflareEnv(event)
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const now = Math.floor(Date.now() / 1000)
  const ttl = getSessionTtl(env)

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(tokenHash, userId, now + ttl, now, now).run()

  setCookie(event, SESSION_COOKIE, token, cookieOptions(event, ttl))
}

export async function getSessionUser(event: H3Event): Promise<AuthUser | null> {
  const token = getCookie(event, SESSION_COOKIE)
  if (!token) return null

  const env = useCloudflareEnv(event)
  const tokenHash = await hashToken(token)
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, users.role, sessions.expires_at
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
  ).bind(tokenHash, now).first<SessionUserRow>()

  if (!row) {
    deleteCookie(event, SESSION_COOKIE, cookieOptions(event, 0))
    return null
  }

  if (now % 300 < 5) {
    await env.DB.prepare(
      'UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'
    ).bind(now, tokenHash).run()
  }

  return { id: row.id, email: row.email, role: row.role }
}

export async function requireSessionUser(event: H3Event): Promise<AuthUser> {
  const user = await getSessionUser(event)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return user
}

export async function revokeUserSession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) {
    const env = useCloudflareEnv(event)
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await hashToken(token))
      .run()
  }
  deleteCookie(event, SESSION_COOKIE, cookieOptions(event, 0))
}

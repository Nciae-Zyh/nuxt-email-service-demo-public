import type { H3Event } from 'h3'
import { hashToken } from './crypto'
import { getClientIdentifier } from './security'
import { useCloudflareEnv } from './bindings'

const WINDOW_SECONDS = 15 * 60
const MAX_FAILURES = 5

interface AttemptRow {
  failed_count: number
  window_started_at: number
}

async function identifierHash(event: H3Event, email: string): Promise<string> {
  return hashToken(getClientIdentifier(event, email))
}

export async function assertLoginAllowed(event: H3Event, email: string): Promise<void> {
  const env = useCloudflareEnv(event)
  const key = await identifierHash(event, email)
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    'SELECT failed_count, window_started_at FROM login_attempts WHERE identifier_hash = ?'
  ).bind(key).first<AttemptRow>()

  if (!row) return
  if (now - row.window_started_at >= WINDOW_SECONDS) {
    await env.DB.prepare('DELETE FROM login_attempts WHERE identifier_hash = ?').bind(key).run()
    return
  }
  if (row.failed_count >= MAX_FAILURES) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many login attempts',
      message: '登录尝试次数过多，请 15 分钟后再试。'
    })
  }
}

export async function recordLoginFailure(event: H3Event, email: string): Promise<void> {
  const env = useCloudflareEnv(event)
  const key = await identifierHash(event, email)
  const now = Math.floor(Date.now() / 1000)

  await env.DB.prepare(
    `INSERT INTO login_attempts (identifier_hash, failed_count, window_started_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(identifier_hash) DO UPDATE SET
       failed_count = CASE
         WHEN excluded.updated_at - login_attempts.window_started_at >= ? THEN 1
         ELSE login_attempts.failed_count + 1
       END,
       window_started_at = CASE
         WHEN excluded.updated_at - login_attempts.window_started_at >= ? THEN excluded.updated_at
         ELSE login_attempts.window_started_at
       END,
       updated_at = excluded.updated_at`
  ).bind(key, now, now, WINDOW_SECONDS, WINDOW_SECONDS).run()
}

export async function clearLoginFailures(event: H3Event, email: string): Promise<void> {
  const env = useCloudflareEnv(event)
  await env.DB.prepare('DELETE FROM login_attempts WHERE identifier_hash = ?')
    .bind(await identifierHash(event, email))
    .run()
}

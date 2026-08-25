import type { H3Event } from 'h3'

export function assertSameOrigin(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  if (!origin) return

  const requestUrl = getRequestURL(event)
  if (new URL(origin).origin !== requestUrl.origin) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })
  }
}

export function getClientIdentifier(event: H3Event, email: string): string {
  const ip = getHeader(event, 'cf-connecting-ip')
    ?? getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'local'
  return `${email.toLowerCase()}|${ip}`
}

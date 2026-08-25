import type {
  EmailPriority,
  EmailSensitivity
} from '../../shared/email'

export {
  escapeHtml,
  htmlToPlainText,
  renderEmailHtml,
  renderEmailText
} from '../../shared/email'

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

interface HeaderOptions {
  priority: EmailPriority
  sensitivity: EmailSensitivity
  contentLanguage?: string
  organization?: string
  inReplyTo?: string
  references?: string
  trackingId?: string
}

export function buildEmailHeaders(options: HeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Mailer': 'Nuxt Cloudflare Email Console'
  }

  if (options.priority === 'high') {
    headers.Importance = 'high'
    headers['X-Priority'] = '1'
  } else if (options.priority === 'low') {
    headers.Importance = 'low'
    headers['X-Priority'] = '5'
  }
  if (options.sensitivity !== 'normal') headers.Sensitivity = options.sensitivity
  if (options.contentLanguage) headers['Content-Language'] = options.contentLanguage
  if (options.organization) headers.Organization = options.organization
  if (options.inReplyTo) headers['In-Reply-To'] = options.inReplyTo
  if (options.references) headers.References = options.references
  if (options.trackingId) headers['X-Tracking-ID'] = options.trackingId

  return headers
}

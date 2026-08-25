import { marked } from 'marked'

export const EMAIL_LIMITS = {
  maxRecipients: 50,
  maxAttachments: 32,
  maxAttachmentBytes: 3 * 1024 * 1024,
  maxMessageBytes: 5 * 1024 * 1024,
  maxHtmlUploadBytes: 1024 * 1024,
  maxContentCharacters: 1_000_000
} as const

export type EmailContentMode = 'text' | 'markdown' | 'html'
export type EmailPriority = 'normal' | 'high' | 'low'
export type EmailSensitivity = 'normal' | 'personal' | 'private' | 'company-confidential'

export interface EmailAttachmentPayload {
  filename: string
  type: string
  size: number
  contentBase64: string
}

export interface SendEmailRequest {
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo?: string
  fromName?: string
  subject: string
  contentMode: EmailContentMode
  content: string
  textFallback?: string
  preheader?: string
  priority: EmailPriority
  sensitivity: EmailSensitivity
  contentLanguage?: string
  organization?: string
  inReplyTo?: string
  references?: string
  trackingId?: string
  attachments: EmailAttachmentPayload[]
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderMarkdownFragment(markdown: string): string {
  return marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true
  }) as string
}

function wrapEmailFragment(fragment: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;background:#f8fafc;font-family:Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}
    .email-shell{max-width:680px;margin:0 auto;padding:32px 20px}
    .email-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:30px;line-height:1.7;overflow-wrap:anywhere}
    .email-card h1,.email-card h2,.email-card h3{line-height:1.3;color:#020617}
    .email-card img{max-width:100%;height:auto}
    .email-card pre{overflow:auto;border-radius:10px;background:#0f172a;color:#e2e8f0;padding:16px}
    .email-card code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .email-card blockquote{margin-left:0;border-left:4px solid #8b5cf6;padding-left:16px;color:#475569}
    .email-card table{width:100%;border-collapse:collapse}
    .email-card th,.email-card td{border:1px solid #cbd5e1;padding:8px;text-align:left}
    .email-footer{margin:16px 4px 0;color:#64748b;font-size:12px}
  </style>
</head>
<body>
  <div class="email-shell">
    <div class="email-card">${fragment}</div>
    <p class="email-footer">Sent with Cloudflare Email Service</p>
  </div>
</body>
</html>`
}

function addPreheader(html: string, preheader?: string): string {
  const normalized = preheader?.trim()
  if (!normalized) return html

  const hidden = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(normalized)}</div>`
  if (/<body(?:\s[^>]*)?>/iu.test(html)) {
    return html.replace(/<body(?:\s[^>]*)?>/iu, match => `${match}${hidden}`)
  }
  return `${hidden}${html}`
}

export function renderEmailHtml(
  mode: EmailContentMode,
  content: string,
  preheader?: string
): string {
  let html: string

  if (mode === 'html') {
    html = /<(?:!doctype\s+html|html)(?:\s|>)/iu.test(content)
      ? content
      : wrapEmailFragment(content)
  } else if (mode === 'markdown') {
    html = wrapEmailFragment(renderMarkdownFragment(content))
  } else {
    const fragment = escapeHtml(content).replaceAll('\n', '<br>')
    html = wrapEmailFragment(fragment)
  }

  return addPreheader(html, preheader)
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }

  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu, (match, decimal, hex, name) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10))
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
    return named[String(name).toLowerCase()] ?? match
  })
}

export function htmlToPlainText(html: string): string {
  const text = html
    .replace(/<(script|style|head|svg|template)\b[^>]*>[\s\S]*?<\/\1>/giu, '')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<li\b[^>]*>/giu, '\n• ')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|table|blockquote)>/giu, '\n')
    .replace(/<[^>]+>/gu, '')

  return decodeHtmlEntities(text)
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function renderEmailText(
  mode: EmailContentMode,
  content: string,
  explicitFallback?: string
): string {
  const fallback = explicitFallback?.trim()
  if (fallback) return fallback
  if (mode === 'text') return content.trim()
  return htmlToPlainText(renderEmailHtml(mode, content))
}

export function createSafePreviewDocument(html: string): string {
  const policy = "default-src 'none'; img-src data: cid:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"
  const securityHead = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`

  if (/<head(?:\s[^>]*)?>/iu.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/iu, match => `${match}${securityHead}`)
  }
  if (/<html(?:\s[^>]*)?>/iu.test(html)) {
    return html.replace(/<html(?:\s[^>]*)?>/iu, match => `${match}<head>${securityHead}</head>`)
  }
  return `<!doctype html><html><head>${securityHead}</head><body>${html}</body></html>`
}

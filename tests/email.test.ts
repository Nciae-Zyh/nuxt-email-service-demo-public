import { describe, expect, it } from 'vitest'
import {
  createSafePreviewDocument,
  escapeHtml,
  htmlToPlainText,
  renderEmailHtml,
  renderEmailText
} from '../shared/email'
import { buildEmailHeaders, decodeBase64 } from '../server/utils/email'

describe('email rendering', () => {
  it('escapes unsafe HTML characters in plain text mode', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    )
    const rendered = renderEmailHtml('text', 'Hello\n<img src=x>')
    expect(rendered).toContain('Hello<br>&lt;img src=x&gt;')
    expect(rendered).not.toContain('<img src=x>')
  })

  it('converts GitHub-flavored Markdown into styled HTML and plain text', () => {
    const markdown = '# Hello\n\n- **one**\n- two'
    const html = renderEmailHtml('markdown', markdown, 'Inbox preview')

    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<strong>one</strong>')
    expect(html).toContain('display:none')
    expect(renderEmailText('markdown', markdown)).toContain('• one')
  })

  it('preserves uploaded HTML while producing a readable fallback', () => {
    const source = '<!doctype html><html><body><h1>Invoice</h1><p>Total: &yen;20</p></body></html>'
    const rendered = renderEmailHtml('html', source)

    expect(rendered).toBe(source)
    expect(htmlToPlainText(rendered)).toContain('Invoice')
    expect(htmlToPlainText(rendered)).toContain('Total: &yen;20')
  })

  it('locks preview documents to local inline resources', () => {
    const preview = createSafePreviewDocument('<html><head></head><body><img src="https://example.com/a.png"></body></html>')

    expect(preview).toContain('Content-Security-Policy')
    expect(preview).toContain("default-src 'none'")
    expect(preview).toContain('form-action')
  })

  it('builds only supported Cloudflare headers', () => {
    expect(buildEmailHeaders({
      priority: 'high',
      sensitivity: 'private',
      contentLanguage: 'zh-CN',
      trackingId: 'order-1'
    })).toEqual({
      'X-Mailer': 'Nuxt Cloudflare Email Console',
      Importance: 'high',
      'X-Priority': '1',
      Sensitivity: 'private',
      'Content-Language': 'zh-CN',
      'X-Tracking-ID': 'order-1'
    })
  })

  it('decodes attachment Base64 into binary bytes', () => {
    expect(Array.from(decodeBase64('SGVsbG8='))).toEqual([72, 101, 108, 108, 111])
  })
})

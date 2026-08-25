import { z } from 'zod'
import type { SendEmailResponse } from '#shared/types'
import {
  EMAIL_LIMITS,
  type EmailAttachmentPayload,
  type EmailContentMode,
  type EmailPriority
} from '#shared/email'
import {
  buildEmailHeaders,
  decodeBase64,
  renderEmailHtml,
  renderEmailText
} from '../../utils/email'
import { assertSameOrigin } from '../../utils/security'
import { requireSessionUser } from '../../utils/session'
import { useCloudflareEnv } from '../../utils/bindings'

const emailAddressSchema = z.string().trim().email().max(254)
const safeHeaderValue = (maxLength: number) => z.string()
  .trim()
  .max(maxLength)
  .refine(value => !/[\r\n]/u.test(value), 'Header values cannot contain new lines')

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255)
    .refine(value => !/[\u0000-\u001f/\\]/u.test(value), 'Invalid attachment filename'),
  type: z.string().trim().min(1).max(127)
    .regex(/^[\w.+-]+\/[\w.+-]+$/u),
  size: z.number().int().positive().max(EMAIL_LIMITS.maxAttachmentBytes),
  contentBase64: z.string().min(1).max(Math.ceil(EMAIL_LIMITS.maxAttachmentBytes * 4 / 3) + 4)
    .regex(/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u)
})

const emailSchema = z.object({
  to: z.array(emailAddressSchema).min(1).max(EMAIL_LIMITS.maxRecipients),
  cc: z.array(emailAddressSchema).max(EMAIL_LIMITS.maxRecipients).default([]),
  bcc: z.array(emailAddressSchema).max(EMAIL_LIMITS.maxRecipients).default([]),
  replyTo: z.union([z.literal(''), emailAddressSchema]).optional().default(''),
  fromName: safeHeaderValue(100).optional().default(''),
  subject: safeHeaderValue(200).pipe(z.string().min(1)),
  contentMode: z.enum(['text', 'markdown', 'html']),
  content: z.string().max(EMAIL_LIMITS.maxContentCharacters)
    .refine(value => value.trim().length > 0, 'Email content is required'),
  textFallback: z.string().max(EMAIL_LIMITS.maxContentCharacters).optional().default(''),
  preheader: safeHeaderValue(200).optional().default(''),
  priority: z.enum(['normal', 'high', 'low']).default('normal'),
  sensitivity: z.enum(['normal', 'personal', 'private', 'company-confidential']).default('normal'),
  contentLanguage: safeHeaderValue(35)
    .refine(value => value === '' || /^[A-Za-z]{2,8}(?:-[A-Za-z\d]{1,8})*$/u.test(value), 'Invalid language tag')
    .optional()
    .default(''),
  organization: safeHeaderValue(200).optional().default(''),
  inReplyTo: safeHeaderValue(998)
    .refine(value => value === '' || /^<[^<>\s]+>$/u.test(value), 'Invalid message ID')
    .optional()
    .default(''),
  references: safeHeaderValue(2048).optional().default(''),
  trackingId: safeHeaderValue(200).optional().default(''),
  attachments: z.array(attachmentSchema).max(EMAIL_LIMITS.maxAttachments).default([])
}).superRefine((data, context) => {
  const recipients = [...data.to, ...data.cc, ...data.bcc]
  if (recipients.length > EMAIL_LIMITS.maxRecipients) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Combined recipients cannot exceed ${EMAIL_LIMITS.maxRecipients}`
    })
  }

  const normalized = recipients.map(address => address.toLowerCase())
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'Duplicate recipients are not allowed'
    })
  }

  const attachmentBytes = data.attachments.reduce((total, attachment) => total + attachment.size, 0)
  if (attachmentBytes > EMAIL_LIMITS.maxAttachmentBytes) {
    context.addIssue({
      code: 'custom',
      path: ['attachments'],
      message: 'Attachments exceed the configured size limit'
    })
  }
})

interface LogEmailOptions {
  userId: number
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string
  fromName: string
  subject: string
  contentMode: EmailContentMode
  priority: EmailPriority
  attachmentCount: number
  messageId: string | null
  status: 'sent' | 'failed'
  errorCode: string | null
  createdAt: number
}

async function logEmail(env: CloudflareEnv, options: LogEmailOptions): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_logs
     (user_id, recipient, cc, bcc, reply_to, from_name, subject, content_mode,
      priority, attachment_count, recipient_count, message_id, status, error_code, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    options.userId,
    JSON.stringify(options.to),
    JSON.stringify(options.cc),
    JSON.stringify(options.bcc),
    options.replyTo || null,
    options.fromName || null,
    options.subject,
    options.contentMode,
    options.priority,
    options.attachmentCount,
    options.to.length + options.cc.length + options.bcc.length,
    options.messageId,
    options.status,
    options.errorCode,
    options.createdAt
  ).run()
}

function decodeAttachments(payloads: EmailAttachmentPayload[]): EmailAttachment[] {
  return payloads.map((attachment) => {
    const content = decodeBase64(attachment.contentBase64)
    if (content.byteLength !== attachment.size) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid attachment payload',
        message: `附件 ${attachment.filename} 的大小校验失败。`
      })
    }
    return {
      content,
      filename: attachment.filename,
      type: attachment.type,
      disposition: 'attachment' as const
    }
  })
}

function estimateMessageBytes(
  subject: string,
  html: string,
  text: string,
  attachments: EmailAttachmentPayload[]
): number {
  const encoder = new TextEncoder()
  const bodyBytes = encoder.encode(subject).byteLength
    + encoder.encode(html).byteLength
    + encoder.encode(text).byteLength
  const encodedAttachmentBytes = attachments.reduce(
    (total, attachment) => total + Math.ceil(attachment.size * 4 / 3) + attachment.filename.length + attachment.type.length + 256,
    0
  )
  return bodyBytes + encodedAttachmentBytes + 4096
}

function deliveryErrorMessage(errorCode: string): { statusCode: number, message: string } {
  if (errorCode === 'E_TOO_MANY_RECIPIENTS') {
    return { statusCode: 400, message: '收件人总数超过 Cloudflare 每封 50 个的限制。' }
  }
  if (errorCode === 'E_TOO_MANY_ATTACHMENTS' || errorCode === 'E_CONTENT_TOO_LARGE') {
    return { statusCode: 413, message: '邮件正文或附件超过 Cloudflare Email Service 大小限制。' }
  }
  if (errorCode === 'E_RATE_LIMIT_EXCEEDED' || errorCode === 'E_DAILY_LIMIT_EXCEEDED') {
    return { statusCode: 429, message: '邮件发送频率或当日额度已达到限制，请稍后再试。' }
  }
  if (errorCode === 'E_RECIPIENT_SUPPRESSED') {
    return { statusCode: 400, message: '某个收件地址已退信或投诉，Cloudflare 已将其加入抑制列表。' }
  }
  if (errorCode.startsWith('E_HEADER_')) {
    return { statusCode: 400, message: '高级邮件头格式无效，请检查优先级、语言或邮件线程设置。' }
  }
  return {
    statusCode: 502,
    message: `邮件发送失败（${errorCode}）。请检查发件域、收件地址与 Email Service 状态。`
  }
}

export default defineEventHandler(async (event): Promise<SendEmailResponse> => {
  assertSameOrigin(event)
  const user = await requireSessionUser(event)
  const parsed = emailSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid email payload',
      message: '邮件参数校验失败，请检查收件人、正文和附件限制。',
      data: parsed.error.flatten()
    })
  }

  const data = parsed.data
  const env = useCloudflareEnv(event)
  const createdAt = Math.floor(Date.now() / 1000)
  const html = renderEmailHtml(data.contentMode, data.content, data.preheader)
  const text = renderEmailText(data.contentMode, data.content, data.textFallback)
  const estimatedBytes = estimateMessageBytes(data.subject, html, text, data.attachments)
  if (estimatedBytes > EMAIL_LIMITS.maxMessageBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Email content too large',
      message: '邮件编码后的预计总大小超过 Cloudflare 5 MiB 限制。'
    })
  }

  let attachments: EmailAttachment[]
  try {
    attachments = decodeAttachments(data.attachments)
  } catch (error: unknown) {
    if (isError(error)) throw error
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid attachment payload',
      message: '附件内容不是有效的 Base64 数据。'
    })
  }

  let result: EmailSendResult
  try {
    result = await env.EMAIL.send({
      from: data.fromName
        ? { email: env.EMAIL_FROM, name: data.fromName }
        : env.EMAIL_FROM,
      to: data.to,
      ...(data.cc.length ? { cc: data.cc } : {}),
      ...(data.bcc.length ? { bcc: data.bcc } : {}),
      ...(data.replyTo ? { replyTo: data.replyTo } : {}),
      subject: data.subject,
      text,
      html,
      headers: buildEmailHeaders(data),
      ...(attachments.length ? { attachments } : {})
    })
  } catch (error: unknown) {
    const details = error as { code?: string, name?: string }
    const errorCode = details.code ?? details.name ?? 'EMAIL_SEND_FAILED'

    await logEmail(env, {
      userId: user.id,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      replyTo: data.replyTo,
      fromName: data.fromName,
      subject: data.subject,
      contentMode: data.contentMode,
      priority: data.priority,
      attachmentCount: attachments.length,
      messageId: null,
      status: 'failed',
      errorCode,
      createdAt
    }).catch(logError => console.error('Failed to persist email error log', logError))

    const deliveryError = deliveryErrorMessage(errorCode)
    throw createError({
      statusCode: deliveryError.statusCode,
      statusMessage: 'Email delivery failed',
      message: deliveryError.message
    })
  }

  await logEmail(env, {
    userId: user.id,
    to: data.to,
    cc: data.cc,
    bcc: data.bcc,
    replyTo: data.replyTo,
    fromName: data.fromName,
    subject: data.subject,
    contentMode: data.contentMode,
    priority: data.priority,
    attachmentCount: attachments.length,
    messageId: result.messageId,
    status: 'sent',
    errorCode: null,
    createdAt
  }).catch(logError => console.error('Failed to persist successful email log', logError))

  return {
    messageId: result.messageId,
    recipientCount: data.to.length + data.cc.length + data.bcc.length
  }
})

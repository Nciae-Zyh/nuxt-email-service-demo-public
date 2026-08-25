import type {
  EmailContentMode,
  EmailPriority
} from '#shared/email'
import type { EmailHistoryResponse, EmailLogItem } from '#shared/types'
import { requireSessionUser } from '../../utils/session'
import { useCloudflareEnv } from '../../utils/bindings'

interface EmailLogRow {
  id: number
  recipient: string
  cc: string
  bcc: string
  reply_to: string | null
  from_name: string | null
  subject: string
  content_mode: string
  priority: string
  attachment_count: number
  status: 'sent' | 'failed'
  message_id: string | null
  error_code: string | null
  created_at: number
}

function parseAddresses(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string')
    }
  } catch {
    // Legacy rows stored a single address as plain text.
  }
  return value ? [value] : []
}

function parseContentMode(value: string): EmailContentMode {
  return value === 'markdown' || value === 'html' ? value : 'text'
}

function parsePriority(value: string): EmailPriority {
  return value === 'high' || value === 'low' ? value : 'normal'
}

export default defineEventHandler(async (event): Promise<EmailHistoryResponse> => {
  const user = await requireSessionUser(event)
  const env = useCloudflareEnv(event)
  const result = await env.DB.prepare(
    `SELECT id, recipient, cc, bcc, reply_to, from_name, subject, content_mode,
            priority, attachment_count, status, message_id, error_code, created_at
     FROM email_logs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`
  ).bind(user.id).all<EmailLogRow>()

  const items: EmailLogItem[] = result.results.map(row => ({
    id: row.id,
    to: parseAddresses(row.recipient),
    cc: parseAddresses(row.cc),
    bcc: parseAddresses(row.bcc),
    replyTo: row.reply_to,
    fromName: row.from_name,
    subject: row.subject,
    contentMode: parseContentMode(row.content_mode),
    priority: parsePriority(row.priority),
    attachmentCount: row.attachment_count,
    status: row.status,
    messageId: row.message_id,
    errorCode: row.error_code,
    createdAt: row.created_at
  }))
  return { items }
})

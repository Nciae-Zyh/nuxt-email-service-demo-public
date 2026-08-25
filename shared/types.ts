import type {
  EmailContentMode,
  EmailPriority
} from './email'

export interface AuthUser {
  id: number
  email: string
  role: 'admin'
}

export interface AuthSessionResponse {
  user: AuthUser | null
}

export interface EmailConfigResponse {
  sender: string
}

export interface EmailLogItem {
  id: number
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string | null
  fromName: string | null
  subject: string
  contentMode: EmailContentMode
  priority: EmailPriority
  attachmentCount: number
  status: 'sent' | 'failed'
  messageId: string | null
  errorCode: string | null
  createdAt: number
}

export interface EmailHistoryResponse {
  items: EmailLogItem[]
}

export interface SendEmailResponse {
  messageId: string
  recipientCount: number
}

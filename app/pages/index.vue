<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import {
  EMAIL_LIMITS,
  createSafePreviewDocument,
  renderEmailHtml,
  type EmailAttachmentPayload,
  type EmailContentMode,
  type EmailPriority,
  type EmailSensitivity,
  type SendEmailRequest
} from '#shared/email'
import type {
  EmailConfigResponse,
  EmailHistoryResponse,
  SendEmailResponse
} from '#shared/types'

definePageMeta({ middleware: 'auth' })
useHead({ title: '邮件发送台' })

const emailValidator = z.string().email()

function parseAddressList(value: string): string[] {
  return value
    .split(/[,;\n]+/u)
    .map(address => address.trim())
    .filter(Boolean)
}

function addressListSchema(required: boolean) {
  return z.string().superRefine((value, context) => {
    const addresses = parseAddressList(value)
    if (required && addresses.length === 0) {
      context.addIssue({ code: 'custom', message: '请至少填写一个收件人' })
      return
    }
    for (const address of addresses) {
      if (!emailValidator.safeParse(address).success) {
        context.addIssue({ code: 'custom', message: `邮箱格式无效：${address}` })
      }
    }
  })
}

const schema = z.object({
  to: addressListSchema(true),
  cc: addressListSchema(false),
  bcc: addressListSchema(false),
  replyTo: z.union([z.literal(''), z.string().email('Reply-To 邮箱格式无效')]),
  fromName: z.string().trim().max(100, '显示名最多 100 个字符'),
  subject: z.string().trim().min(1, '请输入邮件主题').max(200, '主题最多 200 个字符'),
  contentMode: z.enum(['text', 'markdown', 'html']),
  content: z.string().max(EMAIL_LIMITS.maxContentCharacters, '正文内容过大')
    .refine(value => value.trim().length > 0, '请输入邮件正文'),
  textFallback: z.string().max(EMAIL_LIMITS.maxContentCharacters, '纯文本版本过大'),
  preheader: z.string().trim().max(200, '预览摘要最多 200 个字符'),
  priority: z.enum(['normal', 'high', 'low']),
  sensitivity: z.enum(['normal', 'personal', 'private', 'company-confidential']),
  contentLanguage: z.string().trim().refine(
    value => value === '' || /^[A-Za-z]{2,8}(?:-[A-Za-z\d]{1,8})*$/u.test(value),
    '请输入有效语言标签，例如 zh-CN'
  ),
  organization: z.string().trim().max(200, '组织名称最多 200 个字符'),
  inReplyTo: z.string().trim().refine(
    value => value === '' || /^<[^<>\s]+>$/u.test(value),
    'Message-ID 需要使用 <id@example.com> 格式'
  ),
  references: z.string().trim().max(2048, 'References 最多 2048 个字符'),
  trackingId: z.string().trim().max(200, '追踪 ID 最多 200 个字符')
}).superRefine((data, context) => {
  const recipients = [
    ...parseAddressList(data.to),
    ...parseAddressList(data.cc),
    ...parseAddressList(data.bcc)
  ]
  if (recipients.length > EMAIL_LIMITS.maxRecipients) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: `To、Cc、Bcc 合计最多 ${EMAIL_LIMITS.maxRecipients} 个地址`
    })
  }
  const normalized = recipients.map(address => address.toLowerCase())
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: 'To、Cc、Bcc 中不能出现重复地址'
    })
  }
})

type EmailSchema = z.output<typeof schema>

const contentModeItems: Array<{ label: string, value: EmailContentMode, icon: string }> = [
  { label: '纯文本', value: 'text', icon: 'i-lucide-align-left' },
  { label: 'Markdown', value: 'markdown', icon: 'i-lucide-file-code-2' },
  { label: 'HTML', value: 'html', icon: 'i-lucide-code-xml' }
]
const priorityItems: Array<{ label: string, value: EmailPriority }> = [
  { label: '普通', value: 'normal' },
  { label: '高优先级', value: 'high' },
  { label: '低优先级', value: 'low' }
]
const sensitivityItems: Array<{ label: string, value: EmailSensitivity }> = [
  { label: '普通', value: 'normal' },
  { label: '个人', value: 'personal' },
  { label: '私密', value: 'private' },
  { label: '公司机密', value: 'company-confidential' }
]

const auth = useAuth()
const toast = useToast()
const sending = ref(false)
const loggingOut = ref(false)
const showCopies = ref(false)
const customTextFallback = ref(false)
const editorView = ref<'edit' | 'preview'>('edit')
const htmlFilename = ref('')
const attachments = ref<EmailAttachmentPayload[]>([])
const htmlUploadInput = useTemplateRef<HTMLInputElement>('htmlUploadInput')
const attachmentInput = useTemplateRef<HTMLInputElement>('attachmentInput')

const form = ref<EmailSchema>({
  to: '',
  cc: '',
  bcc: '',
  replyTo: '',
  fromName: 'Cloudflare 邮件发送台',
  subject: 'Cloudflare Email Service 测试邮件',
  contentMode: 'markdown',
  content: `# 你好！

这是一封由 **Nuxt 4** 通过 Cloudflare Email Service 发送的 Markdown 邮件。

- Markdown 会转换为 HTML
- 同时自动生成纯文本版本
- 可以在发送前实时预览

> 这是事务型邮件发送演示。`,
  textFallback: '',
  preheader: '来自 Cloudflare Workers 的测试邮件',
  priority: 'normal',
  sensitivity: 'normal',
  contentLanguage: 'zh-CN',
  organization: '',
  inReplyTo: '',
  references: '',
  trackingId: ''
})

const { data: config } = await useFetch<EmailConfigResponse>('/api/email/config')
const { data: history, refresh: refreshHistory } = await useFetch<EmailHistoryResponse>('/api/email/history')

const recipientCount = computed(() => [
  ...parseAddressList(form.value.to),
  ...parseAddressList(form.value.cc),
  ...parseAddressList(form.value.bcc)
].length)

const attachmentBytes = computed(() => attachments.value.reduce((total, file) => total + file.size, 0))

const editorPlaceholder = computed(() => {
  if (form.value.contentMode === 'markdown') return '# 标题\n\n使用 **Markdown** 编写邮件正文…'
  if (form.value.contentMode === 'html') return '<!doctype html>\n<html>…</html>'
  return '请输入纯文本邮件正文…'
})

const previewDocument = computed(() => createSafePreviewDocument(
  renderEmailHtml(form.value.contentMode, form.value.content, form.value.preheader)
))

function getErrorMessage(error: unknown): string {
  const fetchError = error as { data?: { message?: string }, message?: string }
  return fetchError.data?.message ?? '操作失败，请稍后重试。'
}

function selectContentMode(mode: EmailContentMode): void {
  form.value.contentMode = mode
  htmlFilename.value = mode === 'html' ? htmlFilename.value : ''
}

function triggerHtmlUpload(): void {
  htmlUploadInput.value?.click()
}

async function onHtmlUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const isHtml = file.type === 'text/html' || /\.html?$/iu.test(file.name)
  if (!isHtml) {
    toast.add({ title: '文件格式不支持', description: '请选择 .html 或 .htm 文件。', color: 'error' })
    return
  }
  if (file.size > EMAIL_LIMITS.maxHtmlUploadBytes) {
    toast.add({ title: 'HTML 文件过大', description: 'HTML 正文文件最大 1 MiB。', color: 'error' })
    return
  }

  form.value.content = await file.text()
  form.value.contentMode = 'html'
  htmlFilename.value = file.name
  editorView.value = 'preview'
  toast.add({ title: 'HTML 正文已载入', description: `${file.name} 将作为邮件正文发送，不会成为附件。`, color: 'success' })
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const value = String(reader.result)
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

function triggerAttachmentUpload(): void {
  attachmentInput.value?.click()
}

async function onAttachmentUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return

  if (attachments.value.length + files.length > EMAIL_LIMITS.maxAttachments) {
    toast.add({ title: '附件数量过多', description: `每封邮件最多 ${EMAIL_LIMITS.maxAttachments} 个附件。`, color: 'error' })
    return
  }

  const incomingBytes = files.reduce((total, file) => total + file.size, 0)
  if (attachmentBytes.value + incomingBytes > EMAIL_LIMITS.maxAttachmentBytes) {
    toast.add({ title: '附件总大小过大', description: '为预留 MIME 编码空间，附件原始内容合计最多 3 MiB。', color: 'error' })
    return
  }

  try {
    const prepared = await Promise.all(files.map(async file => ({
      filename: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      contentBase64: await fileToBase64(file)
    })))
    attachments.value = [...attachments.value, ...prepared]
  } catch {
    toast.add({ title: '附件读取失败', description: '浏览器无法读取所选文件，请重新选择。', color: 'error' })
  }
}

function removeAttachment(index: number): void {
  attachments.value = attachments.value.filter((_, itemIndex) => itemIndex !== index)
}

async function onSend(event: FormSubmitEvent<EmailSchema>): Promise<void> {
  sending.value = true
  try {
    const data = event.data
    const payload: SendEmailRequest = {
      to: parseAddressList(data.to),
      cc: parseAddressList(data.cc),
      bcc: parseAddressList(data.bcc),
      replyTo: data.replyTo || undefined,
      fromName: data.fromName || undefined,
      subject: data.subject,
      contentMode: data.contentMode,
      content: data.content,
      textFallback: customTextFallback.value ? data.textFallback : undefined,
      preheader: data.preheader || undefined,
      priority: data.priority,
      sensitivity: data.sensitivity,
      contentLanguage: data.contentLanguage || undefined,
      organization: data.organization || undefined,
      inReplyTo: data.inReplyTo || undefined,
      references: data.references || undefined,
      trackingId: data.trackingId || undefined,
      attachments: attachments.value
    }

    const result = await $fetch<SendEmailResponse>('/api/email/send', {
      method: 'POST',
      body: payload
    })
    toast.add({
      title: '邮件已提交发送',
      description: `${result.recipientCount} 个收件人 · Message ID: ${result.messageId}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    await refreshHistory()
  } catch (error: unknown) {
    toast.add({
      title: '邮件发送失败',
      description: getErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    sending.value = false
  }
}

async function logout(): Promise<void> {
  loggingOut.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
    auth.setUser(null)
    await navigateTo('/login')
  } finally {
    loggingOut.value = false
  }
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp * 1000))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

function contentModeLabel(mode: EmailContentMode): string {
  return contentModeItems.find(item => item.value === mode)?.label ?? mode
}
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-default bg-default/80 backdrop-blur-xl">
      <div class="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-md shadow-primary/20">
            <UIcon name="i-lucide-send" class="size-5" />
          </div>
          <div class="min-w-0">
            <p class="truncate font-semibold text-highlighted">Cloudflare 邮件发送台</p>
            <p class="truncate text-xs text-muted">Markdown · HTML · D1 · Email Service</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="hidden text-right sm:block">
            <p class="text-sm font-medium text-highlighted">{{ auth.user.value?.email }}</p>
            <p class="text-xs text-muted">管理员</p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-log-out"
            :loading="loggingOut"
            aria-label="退出登录"
            @click="logout"
          />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p class="text-sm font-medium text-primary">TRANSACTIONAL EMAIL COMPOSER</p>
          <h1 class="mt-2 text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">创建并发送邮件</h1>
          <p class="mt-3 max-w-3xl text-sm leading-6 text-muted">
            支持纯文本、Markdown 转 HTML、上传 HTML 正文、多人收件、邮件头和附件。发送前可在隔离环境中预览。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UBadge color="success" variant="subtle" size="lg" icon="i-lucide-shield-check">已登录</UBadge>
          <UBadge color="neutral" variant="subtle" size="lg">{{ recipientCount }}/{{ EMAIL_LIMITS.maxRecipients }} 收件人</UBadge>
        </div>
      </div>

      <div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <UCard :ui="{ root: 'rounded-2xl', body: 'p-5 sm:p-7' }">
          <template #header>
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="font-semibold text-highlighted">新邮件</h2>
                <p class="mt-1 text-xs text-muted">Cloudflare Email Service 事务型邮件编辑器</p>
              </div>
              <UIcon name="i-lucide-pencil-line" class="size-5 text-primary" />
            </div>
          </template>

          <UForm :schema="schema" :state="form" class="space-y-6" @submit="onSend">
            <div class="grid gap-4 md:grid-cols-2">
              <UFormField label="发件地址" help="由 Worker binding 限制，不能在页面中修改。">
                <UInput
                  :model-value="config?.sender ?? '正在读取…'"
                  disabled
                  icon="i-lucide-at-sign"
                  size="lg"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="发件人显示名" name="fromName">
                <UInput
                  v-model="form.fromName"
                  icon="i-lucide-signature"
                  size="lg"
                  class="w-full"
                  placeholder="例如：产品通知"
                />
              </UFormField>
            </div>

            <UFormField label="收件人 To" name="to" required help="支持逗号、分号或换行分隔多个地址。">
              <UTextarea
                v-model="form.to"
                :rows="2"
                autoresize
                class="w-full"
                placeholder="user@example.com, another@example.com"
              />
            </UFormField>

            <div>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                size="sm"
                :icon="showCopies ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                :label="showCopies ? '收起 Cc / Bcc' : '添加 Cc / Bcc'"
                @click="showCopies = !showCopies"
              />
              <div v-if="showCopies" class="mt-3 grid gap-4 md:grid-cols-2">
                <UFormField label="抄送 Cc" name="cc">
                  <UTextarea v-model="form.cc" :rows="2" autoresize class="w-full" placeholder="cc@example.com" />
                </UFormField>
                <UFormField label="密送 Bcc" name="bcc">
                  <UTextarea v-model="form.bcc" :rows="2" autoresize class="w-full" placeholder="bcc@example.com" />
                </UFormField>
              </div>
            </div>

            <UFormField label="邮件主题" name="subject" required>
              <UInput v-model="form.subject" icon="i-lucide-text" size="lg" class="w-full" placeholder="请输入邮件主题" />
            </UFormField>

            <div class="rounded-2xl border border-default bg-elevated/40 p-4 sm:p-5">
              <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div>
                  <p class="text-sm font-medium text-highlighted">正文格式</p>
                  <p class="mt-1 text-xs text-muted">HTML 上传会读取文件内容作为正文，不会添加为附件。</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="item in contentModeItems"
                    :key="item.value"
                    type="button"
                    size="sm"
                    :color="form.contentMode === item.value ? 'primary' : 'neutral'"
                    :variant="form.contentMode === item.value ? 'solid' : 'outline'"
                    :icon="item.icon"
                    :label="item.label"
                    @click="selectContentMode(item.value)"
                  />
                </div>
              </div>

              <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
                <div class="flex gap-2">
                  <UButton
                    type="button"
                    size="sm"
                    color="neutral"
                    :variant="editorView === 'edit' ? 'solid' : 'ghost'"
                    icon="i-lucide-pencil"
                    label="编辑"
                    @click="editorView = 'edit'"
                  />
                  <UButton
                    type="button"
                    size="sm"
                    color="neutral"
                    :variant="editorView === 'preview' ? 'solid' : 'ghost'"
                    icon="i-lucide-eye"
                    label="预览"
                    @click="editorView = 'preview'"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="htmlFilename" class="max-w-48 truncate text-xs text-muted">{{ htmlFilename }}</span>
                  <input ref="htmlUploadInput" class="hidden" type="file" accept=".html,.htm,text/html" @change="onHtmlUpload">
                  <UButton
                    type="button"
                    size="sm"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-file-up"
                    label="上传 HTML 正文"
                    @click="triggerHtmlUpload"
                  />
                </div>
              </div>

              <UFormField v-if="editorView === 'edit'" class="mt-4" name="content" required>
                <UTextarea
                  v-model="form.content"
                  :rows="18"
                  autoresize
                  class="w-full font-mono text-sm"
                  :placeholder="editorPlaceholder"
                />
              </UFormField>
              <div v-else class="mt-4 overflow-hidden rounded-xl border border-default bg-white">
                <iframe
                  :srcdoc="previewDocument"
                  sandbox
                  referrerpolicy="no-referrer"
                  title="邮件 HTML 预览"
                  class="h-[520px] w-full bg-white"
                />
              </div>

              <div class="mt-4 flex items-start gap-3 rounded-xl bg-default p-3">
                <UCheckbox v-model="customTextFallback" label="自定义纯文本 fallback" />
                <p class="text-xs leading-5 text-muted">未开启时会从 Markdown 或 HTML 自动生成，提升兼容性和送达率。</p>
              </div>
              <UFormField v-if="customTextFallback" class="mt-4" label="纯文本版本" name="textFallback">
                <UTextarea v-model="form.textFallback" :rows="7" autoresize class="w-full" placeholder="不支持 HTML 的邮件客户端将显示这里的内容。" />
              </UFormField>
            </div>

            <div class="rounded-2xl border border-default p-4 sm:p-5">
              <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p class="text-sm font-medium text-highlighted">附件</p>
                  <p class="mt-1 text-xs text-muted">最多 {{ EMAIL_LIMITS.maxAttachments }} 个，原始内容合计最多 3 MiB。</p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="text-xs text-muted">{{ formatBytes(attachmentBytes) }}</span>
                  <input ref="attachmentInput" class="hidden" type="file" multiple @change="onAttachmentUpload">
                  <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-paperclip" label="添加附件" @click="triggerAttachmentUpload" />
                </div>
              </div>
              <div v-if="attachments.length" class="mt-4 grid gap-2 sm:grid-cols-2">
                <div v-for="(file, index) in attachments" :key="`${file.filename}-${index}`" class="flex items-center gap-3 rounded-xl bg-elevated p-3">
                  <UIcon name="i-lucide-file" class="size-4 shrink-0 text-primary" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-highlighted">{{ file.filename }}</p>
                    <p class="text-xs text-muted">{{ formatBytes(file.size) }} · {{ file.type }}</p>
                  </div>
                  <UButton type="button" color="error" variant="ghost" size="xs" icon="i-lucide-x" aria-label="移除附件" @click="removeAttachment(index)" />
                </div>
              </div>
            </div>

            <details class="rounded-2xl border border-default p-4 sm:p-5">
              <summary class="cursor-pointer select-none text-sm font-medium text-highlighted">高级发送选项</summary>
              <div class="mt-5 grid gap-4 md:grid-cols-2">
                <UFormField label="Reply-To" name="replyTo">
                  <UInput v-model="form.replyTo" type="email" class="w-full" placeholder="support@example.com" />
                </UFormField>
                <UFormField label="预览摘要 Preheader" name="preheader">
                  <UInput v-model="form.preheader" class="w-full" placeholder="收件箱中主题后的摘要文字" />
                </UFormField>
                <UFormField label="优先级" name="priority">
                  <USelect v-model="form.priority" :items="priorityItems" class="w-full" />
                </UFormField>
                <UFormField label="敏感级别" name="sensitivity">
                  <USelect v-model="form.sensitivity" :items="sensitivityItems" class="w-full" />
                </UFormField>
                <UFormField label="内容语言" name="contentLanguage" help="RFC 语言标签，例如 zh-CN、en-US。">
                  <UInput v-model="form.contentLanguage" class="w-full" placeholder="zh-CN" />
                </UFormField>
                <UFormField label="组织名称" name="organization">
                  <UInput v-model="form.organization" class="w-full" placeholder="Example Inc." />
                </UFormField>
                <UFormField label="In-Reply-To" name="inReplyTo" help="用于把邮件归入现有会话线程。">
                  <UInput v-model="form.inReplyTo" class="w-full" placeholder="<message-id@example.com>" />
                </UFormField>
                <UFormField label="References" name="references">
                  <UInput v-model="form.references" class="w-full" placeholder="<previous-id@example.com>" />
                </UFormField>
                <UFormField class="md:col-span-2" label="内部追踪 ID" name="trackingId" help="作为 X-Tracking-ID 邮件头发送。">
                  <UInput v-model="form.trackingId" class="w-full" placeholder="order-2026-0001" />
                </UFormField>
              </div>
            </details>

            <div class="flex flex-col justify-between gap-4 border-t border-default pt-5 sm:flex-row sm:items-center">
              <p class="text-xs leading-5 text-muted">
                将发送 HTML 与纯文本双版本；To/Cc/Bcc 合计 {{ recipientCount }} 个收件人。
              </p>
              <UButton type="submit" size="lg" icon="i-lucide-send-horizontal" :loading="sending" label="发送邮件" />
            </div>
          </UForm>
        </UCard>

        <div class="space-y-6">
          <UCard :ui="{ root: 'rounded-2xl', body: 'p-5' }">
            <template #header>
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="font-semibold text-highlighted">最近发送</h2>
                  <p class="mt-1 text-xs text-muted">最近 20 条 D1 记录</p>
                </div>
                <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" aria-label="刷新发送记录" @click="() => refreshHistory()" />
              </div>
            </template>

            <div v-if="history?.items.length" class="divide-y divide-default">
              <div v-for="item in history.items" :key="item.id" class="py-4 first:pt-0 last:pb-0">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-highlighted">{{ item.subject }}</p>
                    <p class="mt-1 truncate text-xs text-muted">{{ item.to.join(', ') }}</p>
                  </div>
                  <UBadge :color="item.status === 'sent' ? 'success' : 'error'" variant="subtle" size="sm">
                    {{ item.status === 'sent' ? '已发送' : '失败' }}
                  </UBadge>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-dimmed">
                  <span>{{ formatTime(item.createdAt) }}</span>
                  <span>·</span>
                  <span>{{ contentModeLabel(item.contentMode) }}</span>
                  <span v-if="item.cc.length || item.bcc.length">· {{ item.to.length + item.cc.length + item.bcc.length }} 人</span>
                  <span v-if="item.attachmentCount">· {{ item.attachmentCount }} 附件</span>
                </div>
                <p v-if="item.errorCode" class="mt-2 truncate text-xs text-error">{{ item.errorCode }}</p>
              </div>
            </div>

            <div v-else class="flex min-h-44 flex-col items-center justify-center text-center">
              <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
                <UIcon name="i-lucide-inbox" class="size-5 text-muted" />
              </div>
              <p class="mt-4 text-sm font-medium text-highlighted">还没有发送记录</p>
              <p class="mt-1 text-xs text-muted">成功或失败的尝试都会显示在这里。</p>
            </div>
          </UCard>

          <UCard :ui="{ root: 'rounded-2xl', body: 'p-5' }">
            <template #header>
              <h2 class="font-semibold text-highlighted">服务限制</h2>
            </template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between gap-4"><dt class="text-muted">收件人</dt><dd class="font-medium text-highlighted">最多 50 / 封</dd></div>
              <div class="flex justify-between gap-4"><dt class="text-muted">附件</dt><dd class="font-medium text-highlighted">最多 32 个</dd></div>
              <div class="flex justify-between gap-4"><dt class="text-muted">整封大小</dt><dd class="font-medium text-highlighted">Cloudflare 5 MiB</dd></div>
              <div class="flex justify-between gap-4"><dt class="text-muted">用途</dt><dd class="font-medium text-highlighted">事务型邮件</dd></div>
            </dl>
          </UCard>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="安全预览"
            description="预览 iframe 禁止脚本、表单提交和远程资源。上传的 HTML 会原样作为邮件正文交给收件方邮件客户端处理。"
          />
        </div>
      </div>
    </main>
  </div>
</template>

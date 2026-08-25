<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'
import type { AuthSessionResponse } from '#shared/types'

definePageMeta({ middleware: 'guest' })
useHead({ title: '登录 · Cloudflare 邮件发送台' })

const schema = z.object({
  email: z.string().email('请输入有效邮箱地址'),
  password: z.string().min(1, '请输入密码')
})
type LoginSchema = z.output<typeof schema>

const state = ref<Partial<LoginSchema>>({
  email: '',
  password: ''
})
const submitting = ref(false)
const errorMessage = ref('')
const auth = useAuth()

async function onSubmit(event: FormSubmitEvent<LoginSchema>): Promise<void> {
  submitting.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<AuthSessionResponse>('/api/auth/login', {
      method: 'POST',
      body: event.data
    })
    state.value.password = ''
    auth.setUser(response.user)
    await navigateTo('/')
  } catch (error: unknown) {
    const fetchError = error as { data?: { message?: string }, message?: string }
    errorMessage.value = fetchError.data?.message ?? '登录失败，请稍后重试。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12 sm:px-6">
    <div class="pointer-events-none absolute inset-0 opacity-60">
      <div class="absolute -left-24 top-1/4 size-72 rounded-full bg-primary/15 blur-3xl" />
      <div class="absolute -right-24 bottom-1/4 size-80 rounded-full bg-info/10 blur-3xl" />
    </div>

    <div class="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-default bg-default/90 shadow-2xl shadow-primary/10 backdrop-blur lg:grid-cols-[1.1fr_0.9fr]">
      <section class="hidden min-h-[620px] flex-col justify-between bg-inverted p-12 text-inverted lg:flex">
        <div class="flex items-center gap-3">
          <div class="flex size-11 items-center justify-center rounded-2xl bg-primary text-white shadow-lg shadow-primary/30">
            <UIcon name="i-lucide-send" class="size-5" />
          </div>
          <span class="text-sm font-semibold tracking-wide">EDGE MAIL CONSOLE</span>
        </div>

        <div>
          <p class="mb-5 text-sm font-medium text-primary">NUXT 4 × CLOUDFLARE</p>
          <h1 class="max-w-md text-5xl font-semibold leading-tight tracking-tight">
            从边缘安全发送你的测试邮件。
          </h1>
          <p class="mt-6 max-w-md text-base leading-7 text-muted">
            D1 保存管理员与会话，Email Service 负责投递，所有服务端能力统一运行在 Cloudflare Worker。
          </p>
        </div>

        <div class="flex gap-6 text-xs text-dimmed">
          <span class="flex items-center gap-2"><UIcon name="i-lucide-database" /> D1 Auth</span>
          <span class="flex items-center gap-2"><UIcon name="i-lucide-shield-check" /> Secure Cookie</span>
          <span class="flex items-center gap-2"><UIcon name="i-lucide-cloud" /> Workers</span>
        </div>
      </section>

      <section class="flex min-h-[620px] items-center p-7 sm:p-12">
        <div class="mx-auto w-full max-w-sm">
          <div class="mb-9 lg:hidden">
            <div class="mb-5 flex size-11 items-center justify-center rounded-2xl bg-primary text-white">
              <UIcon name="i-lucide-send" class="size-5" />
            </div>
          </div>

          <p class="text-sm font-medium text-primary">管理员登录</p>
          <h2 class="mt-2 text-3xl font-semibold tracking-tight text-highlighted">欢迎回来</h2>
          <p class="mt-3 text-sm leading-6 text-muted">使用保存在 D1 中的管理员账户继续。</p>

          <UAlert
            v-if="errorMessage"
            class="mt-6"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="登录失败"
            :description="errorMessage"
          />

          <UForm :schema="schema" :state="state" class="mt-8 space-y-5" @submit="onSubmit">
            <UFormField label="管理员邮箱" name="email" required>
              <UInput
                v-model="state.email"
                type="email"
                autocomplete="username"
                icon="i-lucide-mail"
                size="xl"
                class="w-full"
                placeholder="name@example.com"
              />
            </UFormField>

            <UFormField label="密码" name="password" required>
              <UInput
                v-model="state.password"
                type="password"
                autocomplete="current-password"
                icon="i-lucide-lock-keyhole"
                size="xl"
                class="w-full"
                placeholder="请输入密码"
              />
            </UFormField>

            <UButton
              type="submit"
              size="xl"
              block
              icon="i-lucide-log-in"
              :loading="submitting"
              label="登录邮件发送台"
            />
          </UForm>

          <p class="mt-8 text-center text-xs leading-5 text-dimmed">
            登录会话最长保留 8 小时，连续失败 5 次会临时锁定。
          </p>
        </div>
      </section>
    </div>
  </main>
</template>

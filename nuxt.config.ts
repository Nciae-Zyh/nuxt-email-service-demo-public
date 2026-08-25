export default defineNuxtConfig({
  compatibilityDate: '2026-07-14',
  modules: ['@nuxt/ui'],
  ui: {
    fonts: false
  },
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  nitro: {
    preset: 'cloudflare-module'
  },
  routeRules: {
    '/api/**': {
      cache: false,
      headers: {
        'cache-control': 'no-store'
      }
    }
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'Cloudflare 邮件发送台',
      meta: [
        {
          name: 'description',
          content: '基于 Nuxt 4、Nuxt UI、D1 和 Cloudflare Email Service 的邮件发送 Demo'
        }
      ]
    }
  },
  typescript: {
    strict: true,
    typeCheck: false
  }
})

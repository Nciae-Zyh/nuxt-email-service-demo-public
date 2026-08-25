import type { ExecutionContext } from '@cloudflare/workers-types'

declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      env: CloudflareEnv
      context: ExecutionContext
    }
  }
}

export {}

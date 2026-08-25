import type { EmailConfigResponse } from '#shared/types'
import { requireSessionUser } from '../../utils/session'
import { useCloudflareEnv } from '../../utils/bindings'

export default defineEventHandler(async (event): Promise<EmailConfigResponse> => {
  await requireSessionUser(event)
  return { sender: useCloudflareEnv(event).EMAIL_FROM }
})

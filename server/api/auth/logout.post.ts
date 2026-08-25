import type { AuthSessionResponse } from '#shared/types'
import { assertSameOrigin } from '../../utils/security'
import { revokeUserSession } from '../../utils/session'

export default defineEventHandler(async (event): Promise<AuthSessionResponse> => {
  assertSameOrigin(event)
  await revokeUserSession(event)
  return { user: null }
})

import type { AuthSessionResponse } from '#shared/types'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<AuthSessionResponse> => {
  return { user: await getSessionUser(event) }
})

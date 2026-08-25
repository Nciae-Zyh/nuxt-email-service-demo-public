import type { AuthSessionResponse, AuthUser } from '#shared/types'

export function useAuth() {
  const user = useState<AuthUser | null>('auth-user', () => null)
  const loaded = useState<boolean>('auth-loaded', () => false)
  const pending = useState<boolean>('auth-pending', () => false)

  async function refresh(): Promise<AuthUser | null> {
    if (pending.value) return user.value
    pending.value = true
    try {
      const requestFetch = useRequestFetch()
      const data = await requestFetch<AuthSessionResponse>('/api/auth/session')
      user.value = data.user
      loaded.value = true
      return user.value
    } catch {
      user.value = null
      loaded.value = true
      return null
    } finally {
      pending.value = false
    }
  }

  function setUser(value: AuthUser | null): void {
    user.value = value
    loaded.value = true
  }

  return {
    user: readonly(user),
    loaded: readonly(loaded),
    pending: readonly(pending),
    refresh,
    setUser
  }
}

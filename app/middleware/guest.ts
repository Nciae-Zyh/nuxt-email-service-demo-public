export default defineNuxtRouteMiddleware(async () => {
  const auth = useAuth()
  if (!auth.loaded.value) await auth.refresh()
  if (auth.user.value) return navigateTo('/')
})

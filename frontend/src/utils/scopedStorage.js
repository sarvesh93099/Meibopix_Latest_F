import { getAuthUserProfile, isAuthenticated, isGuestSession } from './auth.js'
import { GUEST_CACHE_PREFIX } from '../features/demo/session.js'

// Cache identity never falls back to a name or a legacy unscoped cache.
export const getScopedStorage = (resource) => {
  if (isGuestSession()) return { storage: sessionStorage, key: `${GUEST_CACHE_PREFIX}${resource}` }
  if (!isAuthenticated()) return null
  const user = getAuthUserProfile()
  const identity = user.sub || user.username
  if (!identity) return null
  return { storage: localStorage, key: `meibopix_cache_v2:${resource}:${user.role}:${encodeURIComponent(identity)}` }
}

export const readScopedCache = (resource) => {
  try {
    const scope = getScopedStorage(resource)
    return scope ? JSON.parse(scope.storage.getItem(scope.key) || 'null') : null
  } catch { return null }
}

export const writeScopedCache = (resource, value) => {
  try {
    const scope = getScopedStorage(resource)
    if (scope) scope.storage.setItem(scope.key, JSON.stringify(value))
  } catch { /* Quota and private browsing should not interrupt an active workflow. */ }
}

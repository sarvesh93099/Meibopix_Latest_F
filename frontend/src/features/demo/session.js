// Guest state is confined to this browser tab. It never creates a server account.
export const GUEST_SESSION_KEY = 'meibopix_guest_session_v1'
export const GUEST_DATA_KEY = 'meibopix_guest_data_v1'
export const GUEST_CACHE_PREFIX = 'meibopix_guest_cache:'

let memorySession = null

export const getGuestSession = () => {
  try {
    const stored = sessionStorage.getItem(GUEST_SESSION_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed?.role === 'guest' && parsed?.authProvider === 'demo') return parsed
    }
  } catch {
    // The preview also works when browser storage is unavailable.
  }
  return memorySession
}

export const isGuestSession = () => Boolean(getGuestSession())

export const createGuestSession = () => {
  memorySession = {
    sub: 'guest-preview',
    name: 'Guest explorer',
    username: 'guest',
    role: 'guest',
    authProvider: 'demo',
    isActive: true,
    twoFactorEnabled: false,
    lastLoginAt: new Date().toISOString()
  }
  try {
    sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(memorySession))
  } catch { /* Keep the in-memory fallback. */ }
  return memorySession
}

export const clearGuestSession = () => {
  memorySession = null
  try { sessionStorage.removeItem(GUEST_SESSION_KEY) } catch { /* Storage is optional. */ }
}

export const clearGuestStorage = () => {
  try {
    sessionStorage.removeItem(GUEST_DATA_KEY)
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index)
      if (key?.startsWith(GUEST_CACHE_PREFIX)) sessionStorage.removeItem(key)
    }
  } catch { /* Storage is optional. */ }
}

export const isGuestRoleAllowed = (allowedRoles = []) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : []
  return roles.length === 0 || roles.includes('guest') || roles.includes('doctor')
}

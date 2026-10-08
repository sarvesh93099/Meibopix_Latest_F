// Manages frontend auth persistence, profile normalization, and login/logout API calls.
import axios from 'axios'
import { buildApiUrl, getApiErrorMessage } from './api.js'
import { clearGuestSession, createGuestSession, getGuestSession, isGuestSession } from '../features/demo/session.js'
import { clearGuestDemo, resetGuestDemo } from '../features/demo/data.js'

export { isGuestSession, resetGuestDemo }

const AUTH_STORAGE_KEY = 'meibography_auth_session_v2'
const AUTH_USER_KEY = 'meibography_auth_user_v2'
const AUTH_VALIDATED_AT_KEY = 'meibography_auth_validated_at_v1'
const AUTH_SESSION_CACHE_TTL_MS = 15_000
const AUTH_CONFIG_CACHE_TTL_MS = 60_000

let authSessionPromise = null
let authConfigPromise = null
let authConfigCache = null
let authConfigFetchedAt = 0
let sessionRevision = 0

// Normalize server responses into a stable shape the UI can safely read from local storage.
const normalizeAuthUser = (user) => {
  const payload = user && typeof user === 'object' ? user : {}
  const username = String(payload.username || '').trim()
  const role = String(payload.role || payload.user_role || 'doctor').trim().toLowerCase() || 'doctor'
  const fallbackName = role === 'admin' ? 'Administrator' : 'Doctor'
  const name = String(payload.name || username || fallbackName).trim() || fallbackName

  return {
    sub: String(payload.sub || ''),
    name,
    username,
    role,
    isActive: Boolean(payload.is_active ?? payload.isActive ?? true),
    loginCount: Number(payload.login_count ?? payload.loginCount ?? 0) || 0,
    email: String(payload.email || '').trim(),
    picture: String(payload.picture || '').trim(),
    givenName: String(payload.given_name || payload.givenName || name).trim(),
    familyName: String(payload.family_name || payload.familyName || '').trim(),
    hostedDomain: String(payload.hosted_domain || payload.hostedDomain || '').trim(),
    authProvider: String(payload.auth_provider || payload.authProvider || '').trim() || 'local',
    twoFactorEnabled: Boolean(payload.two_factor_enabled || payload.twoFactorEnabled),
    lastLoginAt: String(payload.last_login_at || payload.lastLoginAt || '').trim()
  }
}

// Read cached session details defensively so malformed storage never crashes app startup.
const readStoredAuthUser = () => {
  try {
    const rawValue = localStorage.getItem(AUTH_USER_KEY)
    if (!rawValue) {
      return null
    }

    return normalizeAuthUser(JSON.parse(rawValue))
  } catch (error) {
    return null
  }
}

const readValidatedAt = () => {
  try {
    const rawValue = localStorage.getItem(AUTH_VALIDATED_AT_KEY)
    const numericValue = Number(rawValue || 0)
    return Number.isFinite(numericValue) ? numericValue : 0
  } catch (error) {
    return 0
  }
}

const markAuthSessionValidated = () => {
  try { localStorage.setItem(AUTH_VALIDATED_AT_KEY, String(Date.now())) } catch { /* Storage is optional. */ }
}

const hasFreshValidatedSession = (maxAgeMs = AUTH_SESSION_CACHE_TTL_MS) => {
  if (!isAuthenticated()) {
    return false
  }

  const validatedAt = readValidatedAt()
  return validatedAt > 0 && (Date.now() - validatedAt) <= maxAgeMs
}

export const clearStoredAuthSession = () => {
  sessionRevision += 1
  clearGuestSession()
  clearGuestDemo()
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
    localStorage.removeItem(AUTH_VALIDATED_AT_KEY)
  } catch { /* Storage is optional. */ }
}

export const startGuestSession = () => {
  clearStoredAuthSession()
  resetGuestDemo()
  return normalizeAuthUser(createGuestSession())
}

export const persistAuthenticatedUser = (user) => {
  const normalizedUser = normalizeAuthUser(user)
  localStorage.setItem(AUTH_STORAGE_KEY, '1')
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(normalizedUser))
  markAuthSessionValidated()
  return normalizedUser
}

export const isAuthenticated = () => {
  if (isGuestSession()) return true
  try { return localStorage.getItem(AUTH_STORAGE_KEY) === '1' } catch { return false }
}

export const getAuthUserProfile = () => {
  if (isGuestSession()) return normalizeAuthUser(getGuestSession())
  return readStoredAuthUser() || normalizeAuthUser({})
}

export const getAuthUser = () => {
  return getAuthUserProfile().name
}

export const getAuthRole = () => {
  return getAuthUserProfile().role
}

export const isAdminUser = (user = null) => {
  const profile = user && typeof user === 'object' ? normalizeAuthUser(user) : getAuthUserProfile()
  return profile.role === 'admin'
}

export const getDefaultRouteForUser = (user = null) => {
  return isAdminUser(user) ? '/admin' : '/home'
}

// Login config and session checks are split out so login and route guards share the same helpers.
export const fetchAuthConfig = async () => {
  if (authConfigCache && (Date.now() - authConfigFetchedAt) <= AUTH_CONFIG_CACHE_TTL_MS) {
    return authConfigCache
  }

  if (authConfigPromise) {
    return authConfigPromise
  }

  authConfigPromise = axios.get(buildApiUrl('/api/auth/config'), { timeout: 8000 })
    .then((response) => {
      authConfigCache = response.data || {}
      authConfigFetchedAt = Date.now()
      return authConfigCache
    })
    .finally(() => {
      authConfigPromise = null
    })

  return authConfigPromise
}

export const loadAuthSession = async ({ force = false, maxAgeMs = AUTH_SESSION_CACHE_TTL_MS } = {}) => {
  if (isGuestSession()) return getAuthUserProfile()
  if (!force && hasFreshValidatedSession(maxAgeMs)) {
    return getAuthUserProfile()
  }

  if (authSessionPromise) {
    return authSessionPromise
  }

  const requestRevision = sessionRevision
  authSessionPromise = axios.get(buildApiUrl('/api/auth/me'), { timeout: 8000 })
    .then((response) => {
      if (requestRevision !== sessionRevision) return isAuthenticated() ? getAuthUserProfile() : null
      const payload = response.data || {}

      if (!payload.authenticated || !payload.user) {
        clearStoredAuthSession()
        return null
      }

      return persistAuthenticatedUser(payload.user)
    })
    .catch((error) => {
      if (requestRevision !== sessionRevision) return isAuthenticated() ? getAuthUserProfile() : null
      clearStoredAuthSession()
      throw error
    })
    .finally(() => {
      authSessionPromise = null
    })

  return authSessionPromise
}

export const loginSession = async ({ username, password, otp }) => {
  const trimmedUsername = String(username || '').trim()
  const trimmedPassword = String(password || '')
  const trimmedOtp = String(otp || '').trim()

  if (!trimmedUsername || !trimmedPassword) {
    return { success: false, message: 'Username and password are required.' }
  }

  // Explicit sign-in exits guest mode before the real authentication request.
  clearStoredAuthSession()
  const requestRevision = sessionRevision

  try {
    const response = await axios.post(buildApiUrl('/api/auth/login'), {
      username: trimmedUsername,
      password: trimmedPassword,
      otp: trimmedOtp
    }, { timeout: 12000 })
    if (requestRevision !== sessionRevision) return { success: false, message: 'The session changed. Please try again.' }
    const payload = response.data || {}
    if (!payload.authenticated || !payload.user) {
      clearStoredAuthSession()
      return { success: false, message: 'Unable to start an authenticated session.' }
    }

    return {
      success: true,
      user: persistAuthenticatedUser(payload.user)
    }
  } catch (error) {
    if (requestRevision === sessionRevision) clearStoredAuthSession()
    return {
      success: false,
      message: getApiErrorMessage(error, 'Unable to sign in.')
    }
  }
}

export const logoutSession = async () => {
  if (isGuestSession()) {
    clearStoredAuthSession()
    return
  }
  try {
    await axios.post(buildApiUrl('/api/auth/logout'))
  } catch (error) {
    // Clear local session state even if the backend session is already gone.
  } finally {
    clearStoredAuthSession()
  }
}

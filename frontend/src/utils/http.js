// Registers one global Axios interceptor so expired sessions route the user back to login.
import axios from 'axios'
import { clearStoredAuthSession, isGuestSession } from './auth.js'
import { API_BASE_URL } from './api.js'
import { createGuestAdapter } from '../features/demo/adapter.js'

const HTTP_INTERCEPTOR_FLAG = '__MEIBOGRAPHY_HTTP_INTERCEPTOR_READY__'

const redirectToLogin = () => {
  const currentPath = `${window.location.pathname}${window.location.search || ''}`
  if (!window.location.pathname.startsWith('/login')) {
    const redirectTarget = encodeURIComponent(currentPath || '/patients')
    window.location.assign(`/login?redirect=${redirectTarget}`)
  }
}

// Guard the interceptor setup so HMR and repeated imports do not stack duplicate handlers.
if (typeof window !== 'undefined' && !window[HTTP_INTERCEPTOR_FLAG]) {
  axios.defaults.withCredentials = true

  const guestAdapter = createGuestAdapter({ apiBaseUrl: API_BASE_URL, origin: window.location.origin })
  axios.interceptors.request.use((config) => {
    if (isGuestSession()) {
      config.adapter = guestAdapter
      config.withCredentials = false
    }
    return config
  })

  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (isGuestSession() || error?.response?.data?.guest_preview) return Promise.reject(error)
      const originalRequest = error?.config || {}
      const requestUrl = String(originalRequest.url || '')
      const isAuthEndpoint = (
        requestUrl.includes('/api/auth/login') ||
        requestUrl.includes('/api/auth/logout')
      )

      if (error?.response?.status === 401) {
        if (!isAuthEndpoint) {
          clearStoredAuthSession()
          redirectToLogin()
        }
        return Promise.reject(error)
      }

      if (error?.response?.status === 403 && requestUrl.includes('/api/auth')) {
        clearStoredAuthSession()
        redirectToLogin()
      }

      return Promise.reject(error)
    }
  )

  window[HTTP_INTERCEPTOR_FLAG] = true
}

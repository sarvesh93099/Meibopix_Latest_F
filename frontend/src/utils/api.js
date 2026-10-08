// Centralizes API base URL normalization so the rest of the frontend can build paths safely.
const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '')

export const API_BASE_URL = normalizeBaseUrl(import.meta.env?.VITE_API_URL || '')

// Accept either "/path" or "path" and always return a browser-safe request URL.
export const buildApiUrl = (path = '') => {
  // Guest-generated PDF files have local object URLs and never need the API host.
  if (String(path).startsWith('blob:')) return String(path)
  const normalizedPath = String(path || '').startsWith('/')
    ? String(path || '')
    : `/${String(path || '')}`

  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath
}

// Extract the most useful message we can from JSON, text, and HTML error responses.
export const getApiErrorMessage = (error, fallbackMessage = 'Request failed.') => {
  const responseData = error?.response?.data

  if (responseData && typeof responseData === 'object') {
    const candidateMessage = String(
      responseData.error ||
      responseData.message ||
      responseData.detail ||
      ''
    ).trim()

    if (candidateMessage) {
      return candidateMessage
    }
  }

  if (typeof responseData === 'string') {
    const trimmedResponse = responseData.trim()
    if (trimmedResponse && !trimmedResponse.startsWith('<')) {
      return trimmedResponse
    }
  }

  const statusCode = Number(error?.response?.status || 0)
  if (statusCode === 404) {
    return 'This action is not available on the current server.'
  }

  if (statusCode >= 500) {
    return 'The server could not complete this request.'
  }

  return String(error?.message || fallbackMessage).trim() || fallbackMessage
}

// Guest image tests use this website's own API proxy, never a configured external
// host. Vite/nginx already proxy /api to this project's backend. No cookies or
// authorization headers accompany these stateless image requests.
const GUEST_IMAGE_ROUTES = {
  'get:/api/model/status': 'status',
  'post:/api/model/warmup': 'warmup',
  'post:/api/predict': 'analyze',
  'post:/api/model/analyze': 'analyze',
  'post:/api/enhance': 'enhance',
  'post:/api/tear-meniscus/measure': 'tear-meniscus'
}

export const getGuestImageAction = (method, path) => GUEST_IMAGE_ROUTES[`${method}:${path}`]

export const requestGuestImage = async ({ config, action, payload, origin, fetchImpl, makeError }) => {
  const website = new URL(origin)
  if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password || typeof fetchImpl !== 'function') {
    throw makeError(config, 'Image processing is unavailable. The other tests work on this device.', 503)
  }
  const url = new URL(`/api/guest/meibography/${action}`, website.origin)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (config.signal?.aborted) controller.abort()
  config.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, Number(config.timeout) > 0 ? Number(config.timeout) : action === 'analyze' ? 120000 : 30000)
  try {
    const response = await fetchImpl(url.href, {
      method: action === 'status' ? 'GET' : 'POST', credentials: 'omit',
      cache: 'no-store', redirect: 'error',
      headers: action === 'status' ? {} : { 'Content-Type': 'application/json' },
      ...(action === 'status' ? {} : { body: JSON.stringify(payload) }),
      signal: controller.signal
    })
    let data
    try { data = await response.json() }
    catch { throw makeError(config, 'The image service returned an unreadable response. Please try again.', 503) }
    if (!response.ok) throw makeError(config, data?.error || 'Image processing could not finish.', response.status)
    return { data: { ...data, guest_preview: true }, status: response.status, statusText: 'Guest session', headers: {}, config }
  } catch (error) {
    if (error?.isAxiosError) throw error
    if (controller.signal.aborted) {
      const cancelled = makeError(config, config.signal?.aborted ? 'This image test was cancelled.' : 'Image processing took too long. Please try again.', 408)
      cancelled.code = config.signal?.aborted ? 'ERR_CANCELED' : 'ECONNABORTED'
      throw cancelled
    }
    throw makeError(config, 'The image service could not be reached. Try again when your connection is available.', 503)
  } finally {
    clearTimeout(timeout)
    config.signal?.removeEventListener('abort', abort)
  }
}

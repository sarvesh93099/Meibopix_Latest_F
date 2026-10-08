// One result per mounted exam; large images never enter browser storage.
export const createAnalysisRequestCache = ({ ttlMs = 60000, now = Date.now, schedule = setTimeout, cancel = clearTimeout } = {}) => {
  let entry = null
  let expiryTimer = null
  const clear = () => { cancel(expiryTimer); expiryTimer = null; entry = null }
  return {
    clear,
    load(key, run) {
      if (entry && now() < entry.expiresAt && key.length === entry.key.length && key.every((value, index) => Object.is(value, entry.key[index]))) {
        return entry.promise
      }
      clear()
      const next = { key: [...key], expiresAt: Infinity, promise: null }
      next.promise = Promise.resolve().then(run).then(result => {
        next.expiresAt = now() + ttlMs
        if (entry === next) {
          if (!result) clear()
          else {
            // Expire even when the user stops interacting with the exam.
            expiryTimer = schedule(clear, ttlMs)
            expiryTimer?.unref?.()
          }
        }
        return result
      }, error => {
        if (entry === next) entry = null
        throw error
      })
      entry = next
      return next.promise
    }
  }
}

// Bound retained image strings as well as the number of undo/redo steps.
// Active images are excluded: history references share those same strings.
export const boundImageHistory = (history, images, { maxBytes = 6 * 1024 * 1024, maxEntries = 6 } = {}) => {
  const seen = new Set(Object.values(images).filter(Boolean))
  let bytes = 0
  const kept = []
  for (let index = history.length - 1; index >= 0 && kept.length < maxEntries; index--) {
    const snapshot = history[index]
    for (const value of Object.values(snapshot)) {
      if (typeof value !== 'string' || seen.has(value)) continue
      seen.add(value)
      // Conservative UTF-16 estimate; browsers often store base64 more compactly.
      bytes += value.length * 2
    }
    if (bytes > maxBytes) break
    kept.push(snapshot)
  }
  return kept.reverse()
}

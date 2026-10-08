// Framing hints are approximate, not a measurement of detection accuracy.
export const getCameraGuidance = (result, width, height) => {
  const points = result?.faceLandmarks?.[0]
  const hint = (status, message) => ({ status, message })
  if (!points?.[454] || !width || !height) return hint('adjust', 'Bring your face into view')
  const left = points[33]
  const right = points[263]
  const nose = points[1]
  if (![left, right, nose, points[10], points[152]].every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))) {
    return hint('adjust', 'Keep both eyes visible')
  }
  const faceHeight = Math.abs(points[152].y - points[10].y)
  if (faceHeight < 0.30) return hint('adjust', 'Move a little closer to the camera')
  if (faceHeight > 0.85) return hint('adjust', 'Move a little farther from the camera')
  const centerX = (left.x + right.x) / 2
  const centerY = (points[10].y + points[152].y) / 2
  if (Math.abs(centerX - 0.5) > 0.16 || Math.abs(centerY - 0.5) > 0.20) {
    return hint('adjust', 'Move your face toward the center of the guide')
  }
  const eyeSpan = Math.abs(right.x - left.x)
  const tilt = Math.atan2(Math.abs(right.y - left.y) * height, eyeSpan * width) * 180 / Math.PI
  if (tilt > 14) return hint('adjust', 'Gently straighten your head')
  if (eyeSpan > 0 && Math.abs(nose.x - centerX) / eyeSpan > 0.22) {
    return hint('adjust', 'Turn toward the camera so both eyes are visible')
  }
  return hint('ready', 'Framing looks good. Relax and blink naturally')
}

// Blink detection stays local to the browser; only the optional recheck uploads a clip.
export const BLINK_RECORDING_DURATION_SECONDS = 30
export const BLINK_LIVE_ANALYSIS_INTERVAL_MS = 50
export const BLINK_LIVE_CAPTURE_WIDTH = 480
export const BLINK_ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm']
export const BLINK_ALLOWED_MIME_PREFIX = 'video/'

const LEFT_EYE = [362, 385, 387, 263, 373, 380]
const RIGHT_EYE = [33, 160, 158, 133, 153, 144]
let visionModulePromise

export const createLocalBlinkLandmarker = async () => {
  visionModulePromise ||= import('@mediapipe/tasks-vision')
  const { FaceLandmarker, FilesetResolver } = await visionModulePromise
  const wasmUrl = import.meta.env?.VITE_BLINK_WASM_URL || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
  const modelUrl = import.meta.env?.VITE_BLINK_MODEL_URL || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
  const vision = await FilesetResolver.forVisionTasks(wasmUrl)
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelUrl },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.35,
    minFacePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
    outputFaceBlendshapes: true
  })
}

const eyeAspectRatio = (landmarks, indices, width, height) => {
  const points = indices.map((index) => landmarks[index])
  if (points.some((point) => !point)) return null
  const distance = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
  const horizontal = distance(points[0], points[3])
  if (horizontal < 1e-6) return null
  // Measure lid separation perpendicular to the eye-corner axis. Using image
  // vertical distances directly makes EAR change when the head is tilted.
  const axisX = ((points[3].x - points[0].x) * width) / horizontal
  const axisY = ((points[3].y - points[0].y) * height) / horizontal
  const perpendicularDistance = (a, b) => Math.abs(
    ((a.x - b.x) * width * -axisY) + ((a.y - b.y) * height * axisX)
  )
  return (perpendicularDistance(points[1], points[5]) + perpendicularDistance(points[2], points[4])) / (2 * horizontal)
}

export const extractBlinkFrameResultFromLocalLandmarker = (result, width = 1, height = 1) => {
  const landmarks = result?.faceLandmarks?.[0]
  if (!landmarks) return { face_found: false, combined_ear: null, blink_score: null, is_closed: false }
  const left = eyeAspectRatio(landmarks, LEFT_EYE, width, height)
  const right = eyeAspectRatio(landmarks, RIGHT_EYE, width, height)
  // Use category names so a model/version change cannot silently swap eye scores.
  const categories = result?.faceBlendshapes?.[0]?.categories || []
  const scoreFor = (name) => {
    const score = categories.find((category) => category.categoryName === name)?.score
    return Number.isFinite(score) ? score : null
  }
  const leftBlinkScore = scoreFor('eyeBlinkLeft')
  const rightBlinkScore = scoreFor('eyeBlinkRight')
  const availableEars = [left, right].filter(Number.isFinite)
  const availableScores = [leftBlinkScore, rightBlinkScore].filter(Number.isFinite)
  if (!availableEars.length && !availableScores.length) {
    return { face_found: false, combined_ear: null, blink_score: null, is_closed: false }
  }
  const ear = availableEars.length
    ? availableEars.reduce((sum, value) => sum + value, 0) / availableEars.length
    : null
  const blinkScore = availableScores.length
    ? availableScores.reduce((sum, value) => sum + value, 0) / availableScores.length
    : null
  return {
    face_found: true,
    combined_ear: ear,
    blink_score: blinkScore,
    left_ear: left,
    right_ear: right,
    left_blink_score: leftBlinkScore,
    right_blink_score: rightBlinkScore,
    is_closed: availableScores.some((score) => score >= 0.45) || availableEars.some((value) => value < 0.18)
  }
}

const createEyeTrackingState = () => ({ openEar: null, closedFrames: 0, closedAt: null, sawOpen: false })

export const createBlinkTrackingState = () => ({
  totalBlinks: 0, blinkTimestamps: [], eyes: { left: createEyeTrackingState(), right: createEyeTrackingState() },
  lastBlinkAt: -Infinity, faceFound: false, faceDetectedSeconds: 0,
  observedSeconds: 0, lastElapsed: 0, processedFrames: 0, earThreshold: 0.18
})

// Count an open -> closed -> open cycle once. Lost tracking and long eye closures
// cancel a candidate rather than becoming a blink.
export const updateBlinkTracking = (state, frame, elapsedSeconds) => {
  const elapsed = Math.max(state.lastElapsed, Number(elapsedSeconds) || 0)
  const delta = Math.min(0.25, Math.max(0, elapsed - state.lastElapsed))
  if (state.faceFound) state.faceDetectedSeconds += delta
  state.observedSeconds = elapsed
  state.lastElapsed = elapsed
  state.processedFrames += 1
  state.faceFound = Boolean(frame?.face_found)
  if (!state.faceFound) {
    state.eyes.left = createEyeTrackingState()
    state.eyes.right = createEyeTrackingState()
    return state
  }

  const legacyEar = frame.combined_ear == null ? null : Number(frame.combined_ear)
  const legacyScore = frame.blink_score == null ? null : Number(frame.blink_score)
  const hasEyeSignals = frame.left_ear != null || frame.right_ear != null || frame.left_blink_score != null || frame.right_blink_score != null
  const eyeSignals = hasEyeSignals
    ? {
        left: { ear: frame.left_ear, score: frame.left_blink_score },
        right: { ear: frame.right_ear, score: frame.right_blink_score }
      }
    : { left: { ear: legacyEar, score: legacyScore }, right: { ear: legacyEar, score: legacyScore } }

  let blinkDetected = false
  for (const eyeName of ['left', 'right']) {
    const signal = eyeSignals[eyeName]
    const eye = state.eyes[eyeName]
    const ear = signal.ear == null ? null : Number(signal.ear)
    const score = signal.score == null ? null : Number(signal.score)
    const hasEar = Number.isFinite(ear) && ear > 0
    const hasScore = Number.isFinite(score)
    if (!hasEar && !hasScore) continue

    if (hasEar && (!hasScore || score < 0.25) && eye.closedAt === null) {
      eye.openEar = eye.openEar === null ? ear : Math.max(ear, eye.openEar * 0.995)
    }
    const threshold = Math.max(0.10, Math.min(0.23, (eye.openEar ?? 0.26) * 0.70))
    state.earThreshold = threshold
    const closed = (hasScore && score >= 0.45) || (hasEar && ear < threshold)
    const reopened = (!hasScore || score < 0.25) && (!hasEar || ear >= threshold + 0.02)
    if (closed) {
      if (eye.closedAt === null && eye.sawOpen) eye.closedAt = elapsed
      if (eye.closedAt !== null) eye.closedFrames += 1
    } else if (reopened) {
      const closedDuration = elapsed - eye.closedAt
      if (eye.closedAt !== null && eye.closedFrames >= 1 && closedDuration >= 0.04 && closedDuration <= 1.0) {
        blinkDetected = true
      }
      eye.closedAt = null
      eye.closedFrames = 0
      eye.sawOpen = true
    }
  }

  // Track the eyes independently, then combine their events. This keeps a
  // partially occluded or off-angle eye from suppressing a blink in the other.
  if (blinkDetected && elapsed - state.lastBlinkAt >= 0.20) {
    state.totalBlinks += 1
    state.blinkTimestamps.push(Number(elapsed.toFixed(2)))
    state.lastBlinkAt = elapsed
  }
  return state
}

export const interpretBlinkRate = (bpm) => `${Number(bpm || 0).toFixed(1)} blinks per minute measured`
export const interpretBlinkBand = () => 'MEASURED'

export const buildLocalBlinkResult = (state, duration) => {
  const seconds = Math.max(0.001, Number(duration) || state.observedSeconds)
  const faceSeconds = Math.min(seconds, state.faceDetectedSeconds)
  const quality = faceSeconds >= Math.min(3, seconds * 0.5) && faceSeconds / seconds >= 0.5
  const bpm = Number(((state.totalBlinks / seconds) * 60).toFixed(1))
  const displayDuration = Number(seconds.toFixed(1))
  const displayFaceSeconds = Number(faceSeconds.toFixed(1))
  return {
    totalBlinks: state.totalBlinks, bpmOverall: quality ? bpm : null,
    bpmFaceOnly: quality ? Number(((state.totalBlinks / Math.max(faceSeconds, 0.001)) * 60).toFixed(1)) : null,
    sessionDurationSeconds: displayDuration, analyzedDurationSeconds: displayDuration,
    faceDetectedSeconds: displayFaceSeconds, noFaceSeconds: Number(Math.max(0, displayDuration - displayFaceSeconds).toFixed(1)),
    blinkTimestamps: [...state.blinkTimestamps],
    interpretation: quality ? interpretBlinkRate(bpm) : 'Try again with your face in view and good light.',
    interpretationBand: quality ? 'MEASURED' : 'RETRY', quality,
    modelName: 'MediaPipe Face Landmarker (on device)', earThreshold: state.earThreshold,
    minClosedFrames: 1, sessionMode: 'on_device', processedFrames: state.processedFrames
  }
}

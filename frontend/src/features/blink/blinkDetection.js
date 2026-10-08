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
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true
  })
}

const eyeAspectRatio = (landmarks, indices, width, height) => {
  const points = indices.map((index) => landmarks[index])
  if (points.some((point) => !point)) return null
  const distance = (a, b) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height)
  const horizontal = distance(points[0], points[3])
  if (horizontal < 1e-6) return null
  return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * horizontal)
}

export const extractBlinkFrameResultFromLocalLandmarker = (result, width = 1, height = 1) => {
  const landmarks = result?.faceLandmarks?.[0]
  if (!landmarks) return { face_found: false, combined_ear: null, blink_score: null, is_closed: false }
  const left = eyeAspectRatio(landmarks, LEFT_EYE, width, height)
  const right = eyeAspectRatio(landmarks, RIGHT_EYE, width, height)
  if (left === null || right === null) return { face_found: false, combined_ear: null, blink_score: null, is_closed: false }
  // Use category names so a model/version change cannot silently swap eye scores.
  const categories = result?.faceBlendshapes?.[0]?.categories || []
  const scores = ['eyeBlinkLeft', 'eyeBlinkRight'].map((name) => categories.find((category) => category.categoryName === name)?.score)
  const blinkScore = scores.every(Number.isFinite) ? (scores[0] + scores[1]) / 2 : null
  const ear = (left + right) / 2
  return { face_found: true, combined_ear: ear, blink_score: blinkScore, is_closed: ear < 0.18 }
}

export const createBlinkTrackingState = () => ({
  totalBlinks: 0, blinkTimestamps: [], openEar: null, closedFrames: 0,
  closedAt: null, lastBlinkAt: -Infinity, sawOpen: false, faceFound: false,
  faceDetectedSeconds: 0, observedSeconds: 0, lastElapsed: 0, processedFrames: 0, earThreshold: 0.18
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
    state.closedAt = null
    state.closedFrames = 0
    state.sawOpen = false
    return state
  }
  const ear = frame.combined_ear == null ? null : Number(frame.combined_ear)
  const score = frame.blink_score == null ? null : Number(frame.blink_score)
  const hasEar = Number.isFinite(ear) && ear > 0
  const hasScore = Number.isFinite(score)
  if (hasEar && (!hasScore || score < 0.25) && state.closedAt === null) {
    state.openEar = state.openEar === null ? ear : Math.max(ear, state.openEar * 0.995)
  }
  state.earThreshold = Math.max(0.10, Math.min(0.23, (state.openEar ?? 0.26) * 0.70))
  const closed = (hasScore && score >= 0.45) || (hasEar && ear < state.earThreshold)
  const reopened = (!hasScore || score < 0.25) && (!hasEar || ear >= state.earThreshold + 0.02)
  if (closed) {
    if (state.closedAt === null && state.sawOpen) state.closedAt = elapsed
    if (state.closedAt !== null) state.closedFrames += 1
  } else if (reopened) {
    if (state.closedAt !== null && state.closedFrames >= 1 && elapsed - state.closedAt <= 1.5 && elapsed - state.lastBlinkAt >= 0.20) {
      state.totalBlinks += 1
      state.blinkTimestamps.push(Number(elapsed.toFixed(2)))
      state.lastBlinkAt = elapsed
    }
    state.closedAt = null
    state.closedFrames = 0
    state.sawOpen = true
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

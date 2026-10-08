import {
  buildLocalBlinkResult, createBlinkTrackingState, createLocalBlinkLandmarker,
  extractBlinkFrameResultFromLocalLandmarker, updateBlinkTracking
} from './blinkDetection.js'

export const BLINK_VIDEO_MAX_BYTES = 32 * 1024 * 1024
export const BLINK_VIDEO_MAX_SECONDS = 120
const SAMPLE_FPS = 20
const abortError = () => new DOMException('Video analysis was cancelled.', 'AbortError')
const checkAbort = (signal) => { if (signal?.aborted) throw abortError() }

export const validateBlinkVideo = (file) => {
  if (!(file instanceof Blob) || !file.size) throw new Error('Choose a video recording first.')
  if (file.size > BLINK_VIDEO_MAX_BYTES) throw new Error('Choose a recording smaller than 32 MB.')
  if (file.type && !file.type.startsWith('video/')) throw new Error('Choose a supported video file.')
}

const awaitVideoEvent = (video, event, signal, start, timeoutMs = 10000) => new Promise((resolve, reject) => {
  let timer
  const cleanup = () => {
    clearTimeout(timer)
    video.removeEventListener(event, done)
    video.removeEventListener('error', failed)
    signal?.removeEventListener('abort', cancelled)
  }
  const done = () => { cleanup(); resolve() }
  const failed = () => { cleanup(); reject(new Error('This browser could not read the recording. Try an MP4 or WebM video.')) }
  const cancelled = () => { cleanup(); reject(abortError()) }
  video.addEventListener(event, done, { once: true })
  video.addEventListener('error', failed, { once: true })
  signal?.addEventListener('abort', cancelled, { once: true })
  timer = setTimeout(() => { cleanup(); reject(new Error('The recording could not be read in time. Try a shorter video.')) }, timeoutMs)
  if (signal?.aborted) { cancelled(); return }
  try { start?.() } catch (error) { cleanup(); reject(error) }
})

// The decoded-frame loop is independent of model loading and media allocation,
// allowing deterministic checks of timestamps, blink cycles, and cancellation.
export const analyzeBlinkVideoFrames = async (video, canvas, context, landmarker, { duration, signal, onProgress } = {}) => {
  if (!Number.isFinite(duration) || duration <= 0 || duration > BLINK_VIDEO_MAX_SECONDS) throw new Error('Choose a recording of two minutes or less.')
  const state = createBlinkTrackingState()
  const totalFrames = Math.max(1, Math.ceil(duration * SAMPLE_FPS))
  const timestampOrigin = performance.now()
  for (let index = 0; index < totalFrames; index += 1) {
    checkAbort(signal)
    const seconds = Math.min(index / SAMPLE_FPS, Math.max(0, duration - 0.002))
    if (Math.abs(video.currentTime - seconds) > 0.0001) {
      await awaitVideoEvent(video, 'seeked', signal, () => { video.currentTime = seconds })
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const detection = landmarker.detectForVideo(canvas, timestampOrigin + index * 1000 / SAMPLE_FPS)
    updateBlinkTracking(state, extractBlinkFrameResultFromLocalLandmarker(detection, canvas.width, canvas.height), seconds)
    if ((index + 1) % 5 === 0 || index + 1 === totalFrames) {
      onProgress?.(Math.min(99, Math.floor((index + 1) / totalFrames * 100)))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  checkAbort(signal)
  if (state.faceFound) state.faceDetectedSeconds += Math.max(0, duration - state.lastElapsed)
  const result = { ...buildLocalBlinkResult(state, duration), sessionMode: 'on_device_video', fps: SAMPLE_FPS, resolution: `${canvas.width}x${canvas.height}` }
  onProgress?.(100)
  return result
}

// Seek sequentially so every sampled frame has a matching timestamp. No clip is
// uploaded; only MediaPipe's model assets are downloaded by the shared loader.
export const analyzeBlinkVideo = async (file, { signal, onProgress } = {}) => {
  validateBlinkVideo(file)
  checkAbort(signal)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  const objectUrl = URL.createObjectURL(file)
  let landmarker
  try {
    onProgress?.(0)
    await awaitVideoEvent(video, 'loadeddata', signal, () => { video.src = objectUrl; video.load() })
    // MediaRecorder WebM clips may initially report Infinity. Reading their end
    // metadata reveals the duration without analyzing unbounded footage.
    if (!Number.isFinite(video.duration)) {
      await awaitVideoEvent(video, 'seeked', signal, () => { video.currentTime = 1e9 })
    }
    const duration = Number(video.duration)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The recording has no readable duration. Try an MP4 video.')
    if (duration > BLINK_VIDEO_MAX_SECONDS) throw new Error('Choose a recording of two minutes or less.')
    if (!video.videoWidth || !video.videoHeight) throw new Error('The recording has no readable video frames.')
    checkAbort(signal)
    landmarker = await createLocalBlinkLandmarker()
    checkAbort(signal)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Video processing is unavailable in this browser.')
    return await analyzeBlinkVideoFrames(video, canvas, context, landmarker, { duration, signal, onProgress })
  } finally {
    landmarker?.close?.()
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

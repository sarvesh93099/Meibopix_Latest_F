import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeBlinkVideo, analyzeBlinkVideoFrames, BLINK_VIDEO_MAX_BYTES, validateBlinkVideo } from './analyzeVideo.js'

test('uploaded blink analysis rejects empty, nonvideo, and oversized clips before allocating resources', () => {
  assert.throws(() => validateBlinkVideo(new Blob()), /recording first/)
  assert.throws(() => validateBlinkVideo(new Blob(['image'], { type: 'image/png' })), /video file/)
  assert.throws(() => validateBlinkVideo(new Blob([new Uint8Array(BLINK_VIDEO_MAX_BYTES + 1)], { type: 'video/webm' })), /32 MB/)
})

test('pre-cancelled uploaded blink analysis needs no browser or model', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(analyzeBlinkVideo(new Blob(['clip'], { type: 'video/webm' }), { signal: controller.signal }), { name: 'AbortError' })
})

test('overlong video is rejected before model loading and releases browser media', async () => {
  const originalDocument = globalThis.document
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let released = false
  let paused = false
  let cleared = false
  const progress = []
  class Video extends EventTarget {
    duration = 121
    videoWidth = 480
    videoHeight = 360
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadeddata'))) }
    pause() { paused = true }
    removeAttribute(key) { assert.equal(key, 'src'); this.src = ''; cleared = true }
  }
  globalThis.document = { createElement: (type) => { assert.equal(type, 'video'); return new Video() } }
  URL.createObjectURL = () => 'blob:test-recording'
  URL.revokeObjectURL = (url) => { assert.equal(url, 'blob:test-recording'); released = true }
  try {
    await assert.rejects(analyzeBlinkVideo(new Blob(['clip'], { type: 'video/webm' }), { onProgress: (value) => progress.push(value) }), /two minutes/)
    assert.deepEqual(progress, [0])
    assert.equal(released && paused && cleared, true)
  } finally {
    globalThis.document = originalDocument
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

test('cancelling a pending video read releases media and removes event listeners', async () => {
  const originalDocument = globalThis.document
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  const controller = new AbortController()
  let released = false
  let removed = 0
  class Video extends EventTarget {
    load() { if (this.src) queueMicrotask(() => controller.abort()) }
    pause() {}
    removeAttribute() { this.src = '' }
    removeEventListener(...args) { removed += 1; super.removeEventListener(...args) }
  }
  globalThis.document = { createElement: () => new Video() }
  URL.createObjectURL = () => 'blob:test-recording'
  URL.revokeObjectURL = () => { released = true }
  try {
    await assert.rejects(analyzeBlinkVideo(new Blob(['clip'], { type: 'video/webm' }), { signal: controller.signal }), { name: 'AbortError' })
    assert.equal(released, true)
    assert.equal(removed, 2)
  } finally {
    globalThis.document = originalDocument
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
})

class SeekableVideo extends EventTarget {
  time = 0
  get currentTime() { return this.time }
  set currentTime(value) { this.time = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))) }
}

test('uploaded video frame inference counts real blink cycles with matching frame timestamps', async () => {
  const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }))
  for (const indices of [[362, 385, 387, 263, 373, 380], [33, 160, 158, 133, 153, 144]]) {
    const coordinates = [[.3, .5], [.33, .48], [.37, .48], [.4, .5], [.37, .52], [.33, .52]]
    indices.forEach((index, i) => { points[index] = { x: coordinates[i][0], y: coordinates[i][1] } })
  }
  const video = new SeekableVideo()
  const canvas = { width: 480, height: 360 }
  const frameTimes = []
  const inferenceTimes = []
  const progress = []
  const context = { drawImage: (source) => { frameTimes.push(source.currentTime) } }
  const landmarker = { detectForVideo: (source, timestamp) => {
    assert.equal(source, canvas)
    inferenceTimes.push(timestamp)
    const closed = frameTimes.at(-1) >= .15 && frameTimes.at(-1) < .25 || frameTimes.at(-1) >= .6 && frameTimes.at(-1) < .7
    return { faceLandmarks: [points], faceBlendshapes: [{ categories: ['eyeBlinkLeft', 'eyeBlinkRight'].map((categoryName) => ({ categoryName, score: closed ? .8 : .05 })) }] }
  } }
  const result = await analyzeBlinkVideoFrames(video, canvas, context, landmarker, { duration: 1, onProgress: (percent) => progress.push(percent) })
  assert.equal(result.totalBlinks, 2)
  assert.deepEqual(result.blinkTimestamps, [.25, .7])
  assert.equal(result.bpmOverall, 120)
  assert.equal(result.quality, true)
  assert.equal(result.faceDetectedSeconds, 1)
  assert.equal(result.processedFrames, 20)
  assert.deepEqual(frameTimes, Array.from({ length: 20 }, (_, index) => index / 20))
  assert.ok(inferenceTimes.slice(1).every((time, index) => Math.abs(time - inferenceTimes[index] - 50) < 1e-6))
  assert.equal(progress.at(-1), 100)
})

test('uploaded video without a face has no fabricated rate and cancels between frame batches', async () => {
  const canvas = { width: 480, height: 360 }
  const context = { drawImage() {} }
  const landmarker = { detectForVideo: () => ({ faceLandmarks: [] }) }
  const result = await analyzeBlinkVideoFrames(new SeekableVideo(), canvas, context, landmarker, { duration: 1 })
  assert.equal(result.totalBlinks, 0)
  assert.equal(result.bpmOverall, null)
  assert.equal(result.quality, false)
  assert.equal(result.noFaceSeconds, 1)
  const controller = new AbortController()
  let frames = 0
  await assert.rejects(analyzeBlinkVideoFrames(new SeekableVideo(), canvas, context, { detectForVideo: () => { frames += 1; return {} } }, {
    duration: 1, signal: controller.signal, onProgress: () => controller.abort()
  }), { name: 'AbortError' })
  assert.equal(frames, 5)
})

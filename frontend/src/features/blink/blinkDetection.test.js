import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLocalBlinkResult, createBlinkTrackingState, extractBlinkFrameResultFromLocalLandmarker, updateBlinkTracking } from './blinkDetection.js'

const frame = (ear = 0.3, score = 0.05, face = true) => ({ combined_ear: ear, blink_score: score, face_found: face })

test('open eyes produce a valid zero-blink result', () => {
  const state = createBlinkTrackingState()
  for (let i = 0; i <= 100; i += 1) updateBlinkTracking(state, frame(), i * 0.05)
  const result = buildLocalBlinkResult(state, 5)
  assert.equal(result.totalBlinks, 0)
  assert.equal(result.bpmOverall, 0)
  assert.equal(result.quality, true)
})

test('a blink counts once after reopening; held closure is not repeatedly counted', () => {
  const state = createBlinkTrackingState()
  updateBlinkTracking(state, frame(), 0)
  for (let i = 1; i <= 5; i += 1) updateBlinkTracking(state, frame(0.06, 0.8), i * 0.05)
  assert.equal(state.totalBlinks, 0)
  updateBlinkTracking(state, frame(), 0.3)
  updateBlinkTracking(state, frame(), 0.35)
  assert.equal(state.totalBlinks, 1)
  assert.deepEqual(state.blinkTimestamps, [0.3])
})

test('tracking loss cancels the candidate and does not report a rate', () => {
  const state = createBlinkTrackingState()
  updateBlinkTracking(state, frame(), 0)
  updateBlinkTracking(state, frame(0.05, 0.9), 0.05)
  updateBlinkTracking(state, frame(0, 0, false), 0.1)
  updateBlinkTracking(state, frame(), 0.15)
  assert.equal(state.totalBlinks, 0)
  assert.equal(buildLocalBlinkResult(state, 30).bpmOverall, null)
})

test('initial closed eyes and long closures are excluded', () => {
  const state = createBlinkTrackingState()
  updateBlinkTracking(state, frame(0.05, 0.9), 0)
  updateBlinkTracking(state, frame(), 0.2)
  updateBlinkTracking(state, frame(0.05, 0.9), 0.3)
  updateBlinkTracking(state, frame(), 2)
  assert.equal(state.totalBlinks, 0)
})

test('no face never becomes a fabricated blink result', () => {
  const state = createBlinkTrackingState()
  for (let i = 0; i < 100; i += 1) updateBlinkTracking(state, frame(0, 0, false), i * 0.05)
  const result = buildLocalBlinkResult(state, 5)
  assert.equal(result.quality, false)
  assert.equal(result.bpmOverall, null)
  assert.equal(result.noFaceSeconds, 5)
})

test('rounded face and missing-face times still add up to the session duration', () => {
  const state = createBlinkTrackingState()
  state.faceDetectedSeconds = 0.25
  const result = buildLocalBlinkResult(state, 30)
  assert.equal(result.faceDetectedSeconds + result.noFaceSeconds, result.analyzedDurationSeconds)
})

test('landmark EAR respects frame aspect ratio and named blendshapes', () => {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  for (const indices of [[362, 385, 387, 263, 373, 380], [33, 160, 158, 133, 153, 144]]) {
    const coordinates = [[0.3, 0.5], [0.33, 0.48], [0.37, 0.48], [0.4, 0.5], [0.37, 0.52], [0.33, 0.52]]
    indices.forEach((index, i) => { points[index] = { x: coordinates[i][0], y: coordinates[i][1] } })
  }
  const result = extractBlinkFrameResultFromLocalLandmarker({ faceLandmarks: [points], faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.9 }, { categoryName: 'eyeBlinkRight', score: 0.02 }, { categoryName: 'eyeBlinkLeft', score: 0.04 }] }] }, 480, 360)
  assert.ok(Math.abs(result.combined_ear - 0.3) < 1e-6)
  assert.equal(result.blink_score, 0.03)
  assert.equal(result.is_closed, false)
})

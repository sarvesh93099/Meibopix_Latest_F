import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { createGuestAdapter } from '../src/features/demo/adapter.js'
import { getDemoData, getDemoReportFile, resetGuestDemo } from '../src/features/demo/data.js'
import { isGuestRoleAllowed } from '../src/features/demo/session.js'
import { buildGuestReportSections } from '../src/features/demo/reports.js'
import { clearStoredAuthSession, getAuthUserProfile, getDefaultRouteForUser, isGuestSession, loadAuthSession, logoutSession, persistAuthenticatedUser, startGuestSession } from '../src/utils/auth.js'
import { getCachedPatients, setCachedPatients } from '../src/utils/patientCache.js'
import { getCachedClinics, setCachedClinics } from '../src/utils/clinicCache.js'

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  clear() { this.values.clear() }
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
}

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() })
globalThis.window = { location: { origin: 'https://demo.example', pathname: '/login', search: '', assign() { throw new Error('Guest requests must not redirect to sign-in.') } } }
await import('../src/utils/http.js')

const adapter = createGuestAdapter({ origin: window.location.origin })
const request = (url, method = 'get', data, params) => adapter({ url, method, data, params })

beforeEach(() => {
  clearStoredAuthSession()
  localStorage.clear()
  sessionStorage.clear()
  resetGuestDemo()
})

test('guest entry and session validation work without contacting a backend', async () => {
  let serverCalls = 0
  axios.defaults.adapter = () => { serverCalls += 1; throw new Error('No server available') }
  const guest = startGuestSession()
  assert.equal(guest.role, 'guest')
  assert.equal(getDefaultRouteForUser(guest), '/home')
  assert.equal((await loadAuthSession({ force: true })).role, 'guest')
  assert.equal(isGuestRoleAllowed(['doctor']), true)
  assert.equal(isGuestRoleAllowed(['admin']), false)
  assert.equal(serverCalls, 0)
})

test('guest HTTP interceptor replaces network adapters and blocks admin, unknown and external requests', async () => {
  let serverCalls = 0
  axios.defaults.adapter = (config) => { serverCalls += 1; return Promise.resolve({ config, data: 'Server should not run', status: 200, headers: {} }) }
  startGuestSession()
  const patients = await axios.get('/api/patients')
  assert.equal(patients.data.length, 3)
  assert.equal(patients.config.withCredentials, false)
  for (const url of ['/api/admin/dashboard', '/api/surprise', 'https://external.example/api/patients', '//external.example/api/patients']) {
    await assert.rejects(axios.get(url), (error) => error.response.status === 403 && error.response.data.guest_preview)
  }
  assert.equal(serverCalls, 0)
  assert.equal(isGuestSession(), true)
})

test('configured absolute API URLs remain local, while foreign origins and prefixes fail closed', async () => {
  const custom = createGuestAdapter({ apiBaseUrl: 'https://api.example/v1', origin: 'https://demo.example' })
  assert.equal((await custom({ url: 'https://api.example/v1/api/patients' })).data.length, 3)
  for (const url of ['https://api.example/api/patients', 'https://other.example/v1/api/patients', 'https://user:password@api.example/v1/api/patients']) {
    await assert.rejects(custom({ url }), (error) => error.response.status === 403)
  }
})

test('guest CRUD updates only synthetic entries and reset restores the original tour', async () => {
  startGuestSession()
  const added = await request('/api/patients', 'post', { full_name: 'New sample', age: 31, gender: 'Other', mobile: '0000000003' })
  assert.equal(added.status, 201)
  await request(`/api/patients/${added.data.id}`, 'put', { full_name: 'Edited sample', age: 32, mobile: '0000000003' })
  assert.equal((await request(`/api/patients/${added.data.id}`)).data.full_name, 'Edited sample')
  await assert.rejects(request('/api/patients/1'), (error) => error.response.status === 404)
  await request(`/api/patients/${added.data.id}`, 'delete')
  await request('/api/patients/90001', 'delete')
  assert.equal(getDemoData().patients.length, 2)
  resetGuestDemo()
  assert.equal(getDemoData().patients.length, 3)
  assert.equal(getDemoData().results.length, 2)
})

test('guest questionnaires calculate locally with NA handling and input validation', async () => {
  const deq = await request('/api/clinical/deq', 'post', { responses: [1, 2, 3, 4, 0] })
  assert.equal(deq.data.result.total_score, 10)
  assert.equal(deq.data.result.average_score, 2)
  const osdi = await request('/api/clinical/osdi', 'post', { responses: [1, 1, 1, 1, 1, 'NA', 'NA', 1, 1, 1, 1, 1] })
  assert.equal(osdi.data.result.score_e, 10)
  assert.equal(osdi.data.result.osdi_score, 25)
  const posterior = await request('/api/clinical/posterior-segment', 'post', { left: { impression: 'Sample', report: 'Entered observation' } })
  assert.equal(posterior.data.result.left.summary, 'Sample · Entered observation')
  const contrast = await request('/api/clinical/contrast-sensitivity', 'post', { testName: 'Demo contrast chart', rows: { od_pre: { A: 10, B: 10, C: 10, D: 10 } } })
  assert.equal(contrast.data.result.rows.od_pre.aulcsf, 0.778)
  assert.equal(contrast.data.result.test_name, 'Demo contrast chart')
  await assert.rejects(request('/api/clinical/osdi', 'post', { responses: ['NA', ...Array(11).fill(0)] }), (error) => error.response.status === 400)
  await assert.rejects(request('/api/clinical/deq', 'post', { responses: [5, 0, 0, 0, 0] }), (error) => error.response.status === 400)
})

test('reports stay isolated and media is excluded from stored guest assessments', async () => {
  startGuestSession()
  assert.equal((await request('/api/results', 'get', undefined, { kind: 'report', patient_id: 90001 })).data.length, 1)
  const saved = await request('/api/results', 'post', { kind: 'assessment', patient_id: 90001, completed_tests: ['OSDI'], session_data: { images: { left: 'data:image/png;base64,large-image' }, osdiResponses: Array(12).fill(1) } })
  assert.ok(saved.data.session_data.images)
  const persisted = getDemoData().results.find((entry) => entry.id === saved.data.id)
  assert.equal(persisted.session_data.images, undefined)
  await assert.rejects(request('/api/results', 'post', { patient_id: 1 }), (error) => error.response.status === 400)
})

test('guest never reads real, legacy or other-account patient and clinic caches', () => {
  persistAuthenticatedUser({ sub: 'doctor-a', username: 'alice', name: 'Same display name', role: 'doctor' })
  setCachedPatients([{ id: 1, full_name: 'PRIVATE A' }])
  setCachedClinics([{ id: 1, name: 'PRIVATE CLINIC', address: 'Private location' }])
  localStorage.setItem('meibography_patients_cache_v1', JSON.stringify([{ id: 2, full_name: 'LEGACY PRIVATE' }]))
  localStorage.setItem('meibography_clinics_cache_v1', JSON.stringify([{ id: 2, name: 'LEGACY PRIVATE' }]))
  persistAuthenticatedUser({ sub: 'doctor-b', username: 'bob', name: 'Same display name', role: 'doctor' })
  assert.deepEqual(getCachedPatients(), [])
  assert.deepEqual(getCachedClinics(), [])
  startGuestSession()
  assert.deepEqual(getCachedPatients(), [])
  assert.equal(getCachedClinics()[0].name, 'Demo Eye Care Studio')
  setCachedPatients([{ id: 90001, full_name: 'Guest-only edit' }])
  setCachedClinics([{ id: 92001, name: 'Guest-only clinic', address: 'Demo' }])
  assert.equal([...localStorage.values.values()].some((value) => value.includes('Guest-only')), false)
  clearStoredAuthSession()
  persistAuthenticatedUser({ sub: 'doctor-a', username: 'alice', role: 'doctor' })
  assert.equal(getCachedPatients()[0].full_name, 'PRIVATE A')
  assert.equal(getCachedClinics()[0].name, 'PRIVATE CLINIC')
})

test('a delayed real session response cannot overwrite an active guest preview', async () => {
  let respond
  let started
  const ready = new Promise((resolve) => { started = resolve })
  axios.defaults.adapter = (config) => new Promise((resolve) => { respond = (data) => resolve({ config, data, status: 200, headers: {} }); started() })
  const pending = loadAuthSession({ force: true })
  await ready
  startGuestSession()
  respond({ authenticated: true, user: { sub: 'admin-1', username: 'admin', role: 'admin' } })
  assert.equal((await pending).role, 'guest')
  assert.equal(getAuthUserProfile().role, 'guest')
})

test('guest exit needs no server logout and removes tab caches', async () => {
  let serverCalls = 0
  axios.defaults.adapter = () => { serverCalls += 1; throw new Error('Offline') }
  startGuestSession()
  setCachedPatients([{ id: 90001, full_name: 'Guest only' }])
  await logoutSession()
  assert.equal(isGuestSession(), false)
  assert.equal(serverCalls, 0)
  assert.deepEqual(getCachedPatients(), [])
  assert.equal(sessionStorage.length, 0)
})

test('all Guest image tests call only the website Guest API without doctor credentials', async () => {
  const calls = []
  const guestImages = createGuestAdapter({ origin: 'https://clinic.example', apiBaseUrl: 'https://configured-api.example/v1', fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ available: true, result: { summary: 'Computed result' } }) }
  } })
  for (const [path, action, method] of [
    ['/api/model/status', 'status', 'get'], ['/api/predict', 'analyze', 'post'],
    ['/api/model/analyze', 'analyze', 'post'], ['/api/enhance', 'enhance', 'post'],
    ['/api/tear-meniscus/measure', 'tear-meniscus', 'post']
  ]) {
    const response = await guestImages({ url: `https://configured-api.example/v1${path}`, method, headers: { Authorization: 'Private token' }, data: { image_data: 'data:image/png;base64,sample' } })
    assert.equal(response.data.guest_preview, true)
    const call = calls.at(-1)
    assert.equal(call.url, `https://clinic.example/api/guest/meibography/${action}`)
    assert.equal(call.options.credentials, 'omit')
    assert.equal(call.options.redirect, 'error')
    assert.equal(call.options.headers.Authorization, undefined)
  }
  await assert.rejects(guestImages({ url: 'https://evil.example/api/predict', method: 'post' }), (error) => error.response.status === 403)
  assert.equal(calls.length, 5)
})

test('Guest image service failures and cancellation preserve actionable errors', async () => {
  const unavailable = createGuestAdapter({ origin: window.location.origin, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'Models are not installed.' }) }) })
  await assert.rejects(unavailable({ url: '/api/predict', method: 'post', data: {} }), (error) => error.response.status === 503 && error.message === 'Models are not installed.')
  const controller = new AbortController()
  controller.abort()
  const cancelled = createGuestAdapter({ origin: window.location.origin, fetchImpl: async (url, options) => { assert.equal(options.signal.aborted, true); throw new DOMException('Cancelled', 'AbortError') } })
  await assert.rejects(cancelled({ url: '/api/enhance', method: 'post', signal: controller.signal }), (error) => error.code === 'ERR_CANCELED')
})

test('real Guest results preserve every test measurement and exclude nested media from tab storage', async () => {
  const completed = ['Meibography', 'Tear Meniscus', 'Blink Rate Evaluation', 'Bulbar Redness', 'DEQ', 'OSDI', 'Contrast Sensitivity', 'Posterior Segment']
  const sessionData = {
    images: { left_upper: 'data:image/png;base64,image' },
    meibographyResults: { left_upper: { coveragePct: 80, dropoutPct: 20, grade: 'Grade 1', glandCount: 9, annotatedImage: 'data:image/png;base64,segmentation', glandProgressionImages: ['data:image/jpeg;base64,frame'] } },
    tearMeasurements: { left: { tmhMm: 0.25, distancePixels: 8, summary: 'Selected measurement' } },
    blinkCounterResult: { totalBlinks: 0, bpmOverall: 0, sessionDurationSeconds: 30, quality: true, sessionMode: 'manual' },
    bulbarRedness: { selectedId: 'grade-1', selectedLabel: 'Grade 1' },
    deqResponses: Array(5).fill(0), osdiResponses: Array(12).fill(0),
    contrastSensitivity: { rows: { od_pre: { A: 10, B: 10, C: 10, D: 10 } } },
    posteriorSegment: { left: { report: 'Entered findings' } }
  }
  const saved = await request('/api/results', 'post', { kind: 'report', patient_id: 90001, completed_tests: completed, session_data: sessionData, left_analysis: 'Recorded results' })
  assert.equal(saved.data.demo_sample, false)
  assert.equal(saved.data.guest_session, true)
  assert.equal(saved.data.session_data.images.left_upper, sessionData.images.left_upper)
  const history = (await request('/api/results', 'get', undefined, { patient_id: 90001, kind: 'report' })).data.find((record) => record.id === saved.data.id)
  assert.equal(history.session_data.meibographyResults.left_upper.coveragePct, 80)
  assert.equal(history.session_data.meibographyResults.left_upper.annotatedImage, undefined)
  assert.equal(history.session_data.tearMeasurements.left.tmhMm, 0.25)
  assert.equal(history.session_data.blinkCounterResult.bpmOverall, 0)
  assert.equal([...sessionStorage.values.values()].some((value) => value.includes('base64')), false)
  const sections = buildGuestReportSections(history)
  assert.ok(sections.find((section) => section.title === 'DEQ').lines[0].includes('Score: 0'))
  assert.ok(sections.find((section) => section.title === 'OSDI').lines[0].includes('Score: 0'))
  assert.ok(sections.find((section) => section.title === 'Blink rate').lines.some((line) => line.includes('0.0 blinks/min')))
  assert.ok(sections.some((section) => section.title === 'Contrast sensitivity'))
  assert.ok(sections.some((section) => section.title === 'Posterior segment'))
})

test('updating a Guest assessment retains one result and malformed saves create no records', async () => {
  const first = await request('/api/results', 'post', { patient_id: 90001, completed_tests: ['DEQ'], session_data: { deqResponses: [1, 0, 0, 0, 0] } })
  const updated = await request('/api/results', 'post', { patient_id: 90001, assessment_id: first.data.id, completed_tests: ['DEQ', 'OSDI'], session_data: { deqResponses: [2, 0, 0, 0, 0], osdiResponses: Array(12).fill(1) } })
  assert.equal(updated.data.id, first.data.id)
  assert.equal(getDemoData().results.length, 3)
  await assert.rejects(request('/api/results', 'post', { patient_id: 90001, completed_tests: {}, session_data: [] }), (error) => error.response.status === 400)
  assert.equal(getDemoData().results.length, 3)
})

test('deleting a Guest record releases its PDF so reused IDs never expose an older file', async () => {
  const person = (await request('/api/patients', 'post', { full_name: 'Guest record', age: 31, mobile: '0000000003' })).data
  const pdf = new FormData()
  pdf.append('kind', 'report')
  pdf.append('patient_id', String(person.id))
  pdf.append('file', new Blob(['%PDF-1.4 Guest report'], { type: 'application/pdf' }), 'guest.pdf')
  const report = (await request('/api/results', 'post', pdf)).data
  assert.ok(getDemoReportFile(report.id).startsWith('blob:'))
  await request(`/api/patients/${person.id}`, 'delete')
  assert.equal(getDemoReportFile(report.id), '')
})

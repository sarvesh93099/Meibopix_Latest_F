import { compactGuestData, copyDemoValue, getDemoData, getDemoReportFile, removeDemoReportFile, saveDemoData, setDemoReportFile } from './data.js'
import { scoreDemoDEQ, scoreDemoOSDI, summarizeDemoContrast, summarizeDemoPosterior } from './clinical.js'
import { getGuestImageAction, requestGuestImage } from './transport.js'

const guestError = (config, message, status = 403) => {
  const error = new Error(message)
  error.name = 'GuestPreviewError'
  error.isAxiosError = true
  error.config = config
  error.response = { data: { error: message, guest_preview: true }, status, statusText: 'Guest preview', config, headers: {} }
  return error
}

// Guest records stay local. Only stateless image tests use this website's own
// Guest API with credentials omitted, even if a doctor cookie already exists.
export const createGuestAdapter = ({ apiBaseUrl = '', origin = 'http://localhost', fetchImpl = (...args) => globalThis.fetch(...args) } = {}) => async (config) => {
  const response = (data, status = 200) => ({ data: copyDemoValue(data), status, statusText: 'Guest preview', headers: { 'x-meibopix-demo': 'true' }, config })
  let requestUrl
  let apiUrl
  try {
    apiUrl = new URL(apiBaseUrl || origin, origin)
    requestUrl = new URL(config.url, config.baseURL || origin)
  } catch {
    throw guestError(config, 'This action is not available in the guest preview.')
  }
  if (requestUrl.origin !== apiUrl.origin || requestUrl.username || requestUrl.password) {
    throw guestError(config, 'External requests are disabled in the guest preview.')
  }
  const prefix = apiBaseUrl ? apiUrl.pathname.replace(/\/+$/, '') : ''
  if (prefix && !requestUrl.pathname.startsWith(`${prefix}/`)) {
    throw guestError(config, 'This action is not available in the guest preview.')
  }
  const path = requestUrl.pathname.slice(prefix.length).replace(/\/+$/, '')
  const method = String(config.method || 'get').toLowerCase()
  const isForm = typeof FormData !== 'undefined' && config.data instanceof FormData
  let payload = {}
  try {
    payload = isForm ? Object.fromEntries(config.data.entries()) : typeof config.data === 'string' ? JSON.parse(config.data) : config.data || {}
  } catch {
    throw guestError(config, 'Please check your demo entries and try again.', 400)
  }
  const imageAction = getGuestImageAction(method, path)
  if (imageAction) return requestGuestImage({ config, action: imageAction, payload, origin, fetchImpl, makeError: guestError })
  const data = getDemoData()
  const findPatient = (id) => data.patients.find((patient) => String(patient.id) === String(id))
  const validatePatient = (entry) => {
    if (!String(entry.full_name || '').trim() || !Number.isInteger(Number(entry.age)) || Number(entry.age) < 1 || Number(entry.age) > 130 || !/^\d{10}$/.test(String(entry.mobile || ''))) {
      throw guestError(config, 'Enter a name, an age from 1 to 130, and a 10-digit sample phone number.', 400)
    }
  }

  if (path === '/api/patients' && method === 'get') return response(data.patients)
  if (path === '/api/patients' && method === 'post') {
    validatePatient(payload)
    const patient = { id: Math.max(90000, ...data.patients.map((entry) => Number(entry.id))) + 1, full_name: String(payload.full_name).trim(), age: Number(payload.age), gender: String(payload.gender || 'Other'), mobile: String(payload.mobile), avatar_style: String(payload.avatar_style || 'ocean'), created_at: new Date().toISOString(), doctor_name: 'Guest workspace', demo_sample: false, guest_session: true }
    data.patients.unshift(patient)
    saveDemoData(data)
    return response(patient, 201)
  }
  const patientRoute = path.match(/^\/api\/patients\/(\d+)$/)
  if (patientRoute && ['get', 'put', 'delete'].includes(method)) {
    const patient = findPatient(patientRoute[1])
    if (!patient) throw guestError(config, 'That sample person was not found.', 404)
    if (method === 'get') return response(patient)
    if (method === 'delete') {
      data.patients = data.patients.filter((entry) => entry.id !== patient.id)
      data.results.filter((entry) => entry.patient_id === patient.id).forEach((entry) => removeDemoReportFile(entry.id))
      data.results = data.results.filter((entry) => entry.patient_id !== patient.id)
      saveDemoData(data)
      return response({ message: 'Sample person removed from this preview.' })
    }
    validatePatient({ ...patient, ...payload })
    Object.assign(patient, { full_name: String(payload.full_name ?? patient.full_name).trim(), age: Number(payload.age ?? patient.age), gender: String(payload.gender ?? patient.gender), mobile: String(payload.mobile ?? patient.mobile), updated_at: new Date().toISOString() })
    saveDemoData(data)
    return response(patient)
  }
  if (path === '/api/results' && method === 'get') {
    const patientId = config.params?.patient_id || requestUrl.searchParams.get('patient_id')
    const kind = config.params?.kind || requestUrl.searchParams.get('kind')
    return response(data.results.filter((report) => (!patientId || String(report.patient_id) === String(patientId)) && (!kind || report.kind === kind)).map((report) => ({ ...report, patient: findPatient(report.patient_id), download_url: getDemoReportFile(report.id) })))
  }
  if (path === '/api/results' && method === 'post') {
    const patient = findPatient(payload.patient_id)
    if (!patient) throw guestError(config, 'Choose a sample person before saving your demo report.', 400)
    const parseField = (value, fallback) => typeof value === 'string' ? JSON.parse(value) : value ?? fallback
    let completedTests
    let sessionData
    try {
      completedTests = parseField(payload.completed_tests, [])
      sessionData = parseField(payload.session_data, {})
    } catch { throw guestError(config, 'Unable to save these demo entries.', 400) }
    if (!Array.isArray(completedTests) || !sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) throw guestError(config, 'Unable to save these test results.', 400)
    const kind = payload.kind === 'report' ? 'report' : 'assessment'
    let record = kind === 'assessment' && data.results.find((item) => item.kind === kind && String(item.id) === String(payload.assessment_id) && item.patient_id === patient.id)
    if (!record) {
      record = { id: Math.max(91000, ...data.results.map((entry) => Number(entry.id))) + 1, created_at: new Date().toISOString() }
      data.results.unshift(record)
    }
    // Current page state retains media; result history stores measurements and
    // entries only so segmentation images cannot exhaust browser memory/storage.
    Object.assign(record, { patient_id: patient.id, kind, status: kind === 'report' ? 'reported' : 'draft', completed_tests: completedTests, session_data: compactGuestData(sessionData), left_analysis: String(payload.left_analysis || ''), right_analysis: String(payload.right_analysis || ''), demo_sample: false, guest_session: true, updated_at: new Date().toISOString() })
    if (isForm && payload.file instanceof Blob) setDemoReportFile(record.id, payload.file)
    saveDemoData(data)
    return response({ ...record, session_data: sessionData, patient, download_url: getDemoReportFile(record.id) }, 201)
  }
  if (path === '/api/camera/settings' && method === 'get') return response(data.camera)
  if (path === '/api/camera/settings' && method === 'post') {
    for (const key of ['brightness', 'contrast']) {
      if (Number.isFinite(Number(payload[key]))) data.camera[key] = Math.min(100, Math.max(0, Number(payload[key])))
    }
    saveDemoData(data)
    return response(data.camera)
  }
  if (path === '/api/upload' && method === 'post' && (payload.image_data || payload.image)) return response({ success: true, guest_preview: true, message: 'Sample image stays in this browser tab.' })
  if (method === 'post' && path.startsWith('/api/clinical/')) {
    const calculators = { '/api/clinical/deq': scoreDemoDEQ, '/api/clinical/osdi': scoreDemoOSDI, '/api/clinical/contrast-sensitivity': summarizeDemoContrast, '/api/clinical/posterior-segment': summarizeDemoPosterior }
    if (calculators[path]) {
      try { return response({ result: calculators[path](payload), guest_preview: true }) }
      catch (error) { throw guestError(config, error.message, 400) }
    }
  }
  throw guestError(config, path.startsWith('/api/admin')
    ? 'Administrator actions are unavailable in a Guest session.'
    : path.includes('/blink-counter/')
      ? 'Use the on-device video analysis or manual counter in your Guest session.'
      : 'This server action requires a signed-in doctor. Your Guest records stay in this browser tab.')
}

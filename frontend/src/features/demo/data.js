import { GUEST_DATA_KEY, clearGuestStorage } from './session.js'

let memoryData = null
const reportFiles = new Map()
const clone = (value) => JSON.parse(JSON.stringify(value))

// Keep media in page memory. Refreshes restore entered measurements without
// duplicating large camera or segmentation images in tab storage.
export const compactGuestData = (value) => {
  if (typeof value === 'string' && /^(?:data:(?:image|video|audio)\/|blob:)/i.test(value)) return undefined
  if (Array.isArray(value)) return value.map(compactGuestData).filter((item) => item !== undefined)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'images')
    .map(([key, item]) => [key, compactGuestData(item)])
    .filter(([, item]) => item !== undefined))
  return value
}

export const createDemoData = () => {
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString()
  const patients = [
    { id: 90001, full_name: 'Avery Demo', age: 28, gender: 'Female', mobile: '0000000000', avatar_style: 'ocean', created_at: daysAgo(0) },
    { id: 90002, full_name: 'Maya Sample', age: 42, gender: 'Female', mobile: '0000000001', avatar_style: 'rose', created_at: daysAgo(2) },
    { id: 90003, full_name: 'Leo Example', age: 35, gender: 'Male', mobile: '0000000002', avatar_style: 'mint', created_at: daysAgo(9) }
  ].map((patient) => ({ ...patient, doctor_name: 'Demo workspace', demo_sample: true }))
  return {
    patients,
    results: [
      { id: 91001, patient_id: 90001, kind: 'report', status: 'reported', created_at: daysAgo(0), completed_tests: ['Blink Rate Evaluation'], left_analysis: 'Fictional demonstration: 7 blinks in 30 seconds = 14 blinks/min.', right_analysis: 'Sample data only. This is not a clinical result.', demo_sample: true },
      { id: 91002, patient_id: 90002, kind: 'report', status: 'reported', created_at: daysAgo(2), completed_tests: ['OSDI'], left_analysis: 'Fictional questionnaire example: OSDI score 25.', right_analysis: 'Sample data only. This is not a clinical result.', demo_sample: true }
    ],
    camera: { brightness: 50, contrast: 50, camera_available: false }
  }
}

export const getDemoData = () => {
  if (memoryData) return memoryData
  try {
    const stored = JSON.parse(sessionStorage.getItem(GUEST_DATA_KEY) || 'null')
    if (Array.isArray(stored?.patients) && Array.isArray(stored?.results)) {
      memoryData = stored
      return memoryData
    }
  } catch { /* Start from the fictional seed if storage is unavailable or malformed. */ }
  memoryData = createDemoData()
  return memoryData
}

export const saveDemoData = (data) => {
  memoryData = data
  try { sessionStorage.setItem(GUEST_DATA_KEY, JSON.stringify(compactGuestData(data))) } catch { /* In-memory mode remains available. */ }
}

export const clearGuestDemo = () => {
  for (const url of reportFiles.values()) URL.revokeObjectURL(url)
  reportFiles.clear()
  clearGuestStorage()
  memoryData = null
}

export const resetGuestDemo = () => {
  clearGuestDemo()
  memoryData = createDemoData()
  saveDemoData(memoryData)
}

export const setDemoReportFile = (id, file) => {
  const previous = reportFiles.get(String(id))
  if (previous) URL.revokeObjectURL(previous)
  reportFiles.set(String(id), URL.createObjectURL(file))
}

export const getDemoReportFile = (id) => reportFiles.get(String(id)) || ''
export const removeDemoReportFile = (id) => {
  const url = reportFiles.get(String(id))
  if (url) URL.revokeObjectURL(url)
  reportFiles.delete(String(id))
}
export const copyDemoValue = clone

// Mirrors patient records into local storage so the dashboard can recover from API failures.
import { readScopedCache, writeScopedCache } from './scopedStorage.js'

const asArray = (value) => (Array.isArray(value) ? value : [])

// Keep the newest patients first so cached lists match the dashboard ordering.
const sortPatientsByCreatedAt = (patients) => {
  return [...patients].sort((a, b) => {
    const aTime = new Date(a?.created_at || 0).getTime()
    const bTime = new Date(b?.created_at || 0).getTime()
    return bTime - aTime
  })
}

const idsMatch = (left, right) => String(left) === String(right)

export const getCachedPatients = () => {
  return sortPatientsByCreatedAt(asArray(readScopedCache('patients')))
}

export const setCachedPatients = (patients) => {
  writeScopedCache('patients', asArray(patients))
}

export const upsertCachedPatient = (patient) => {
  if (!patient || patient.id === undefined || patient.id === null) {
    return
  }

  const existingPatients = getCachedPatients()
  const existingIndex = existingPatients.findIndex((item) => idsMatch(item.id, patient.id))
  const nextPatients = [...existingPatients]

  if (existingIndex >= 0) {
    nextPatients[existingIndex] = patient
  } else {
    nextPatients.push(patient)
  }

  setCachedPatients(sortPatientsByCreatedAt(nextPatients))
}

export const removeCachedPatient = (patientId) => {
  const remainingPatients = getCachedPatients().filter((patient) => !idsMatch(patient.id, patientId))
  setCachedPatients(remainingPatients)
}

export const getCachedPatientById = (patientId) => {
  return getCachedPatients().find((patient) => idsMatch(patient.id, patientId)) || null
}

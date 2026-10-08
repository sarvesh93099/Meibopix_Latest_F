// Keeps the clinic list available offline by mirroring a normalized copy in local storage.
import { readScopedCache, writeScopedCache } from './scopedStorage.js'
import { isGuestSession } from './auth.js'
const REMOVED_CLINIC_PATTERNS = [/1\s*accord/i]

const asArray = (value) => (Array.isArray(value) ? value : [])

// Normalize each entry so the clinics page can rely on IDs and timestamp fields being present.
const normalizeClinics = (clinics) => {
  return asArray(clinics)
    .filter((clinic) => clinic && clinic.id !== undefined && clinic.id !== null)
    .map((clinic) => ({
      id: clinic.id,
      name: clinic.name || '',
      address: clinic.address || '',
      created_at: clinic.created_at || new Date().toISOString(),
      updated_at: clinic.updated_at || clinic.created_at || new Date().toISOString()
    }))
}

const removeDeprecatedClinics = (clinics) => {
  return normalizeClinics(clinics).filter((clinic) => {
    return ![clinic.name, clinic.address].some((value) => (
      REMOVED_CLINIC_PATTERNS.some((pattern) => pattern.test(String(value || '')))
    ))
  })
}

export const getCachedClinics = (fallbackClinics = []) => {
  const cached = readScopedCache('clinics')
  if (Array.isArray(cached)) return removeDeprecatedClinics(cached)
  const fallback = isGuestSession()
    ? [{ id: 92001, name: 'Demo Eye Care Studio', address: 'Fictional sample clinic · guest preview', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]
    : fallbackClinics
  return removeDeprecatedClinics(fallback)
}

export const setCachedClinics = (clinics) => {
  const normalizedClinics = removeDeprecatedClinics(clinics)
  writeScopedCache('clinics', normalizedClinics)
  return normalizedClinics
}

// Share imports between lazy routes and intent prefetches so each page loads once.
export const ROUTE_LOADERS = {
  Layout: () => import('../components/Layout'),
  Home: () => import('../pages/Home'),
  Tools: () => import('../pages/Tools'),
  AddPatient: () => import('../pages/AddPatient'),
  PatientsList: () => import('../pages/PatientsList'),
  PatientDetails: () => import('../pages/PatientDetails'),
  Tests: () => import('../pages/Tests'),
  Clinics: () => import('../pages/Clinics'),
  Settings: () => import('../pages/Settings'),
  AdminDashboard: () => import('../pages/AdminDashboard'),
  MeibographyStandalone: () => import('../pages/MeibographyStandalone'),
  Login: () => import('../pages/Login')
}

const prefetchedRoutes = new Map()

export const isConstrainedDevice = (device = typeof navigator !== 'undefined' ? navigator : {}) => (
  Boolean(device.connection?.saveData)
  || /(^|-)2g$/.test(device.connection?.effectiveType || '')
  || (Number(device.deviceMemory) > 0 && Number(device.deviceMemory) <= 4)
  || (Number(device.hardwareConcurrency) > 0 && Number(device.hardwareConcurrency) <= 2)
)

const getRouteName = (target) => {
  const pathname = String(target || '').split(/[?#]/)[0].replace(/\/$/, '')
  if (pathname === '/home') return 'Home'
  if (pathname === '/tools') return 'Tools'
  if (pathname === '/patients/new') return 'AddPatient'
  if (pathname === '/patients') return 'PatientsList'
  if (pathname === '/tests' || /^\/patients\/[^/]+\/reports$/.test(pathname)) return 'Tests'
  if (/^\/patients\/[^/]+$/.test(pathname)) return 'PatientDetails'
  if (pathname === '/clinics') return 'Clinics'
  if (pathname === '/settings') return 'Settings'
  if (pathname === '/admin') return 'AdminDashboard'
  if (pathname === '/eye-test/meibography' || /^\/test\/[^/]+$/.test(pathname)) return 'MeibographyStandalone'
  if (pathname === '/login') return 'Login'
  return null
}

// Call only on a person's hover/focus intent; avoid background downloads on slow links.
export const prefetchRoute = (target) => {
  if (isConstrainedDevice() || (typeof document !== 'undefined' && document.hidden)) return Promise.resolve()
  const name = getRouteName(target)
  if (!name) return Promise.resolve()
  if (!prefetchedRoutes.has(name)) {
    prefetchedRoutes.set(name, ROUTE_LOADERS[name]().catch(() => {
      // Navigation can retry a transient network failure normally.
      prefetchedRoutes.delete(name)
    }))
  }
  return prefetchedRoutes.get(name)
}

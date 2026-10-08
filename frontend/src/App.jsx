import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AppErrorBoundary from './components/AppErrorBoundary'
import LoadingState from './components/LoadingState'
import { getAuthUserProfile, getDefaultRouteForUser } from './utils/auth'
import { ROUTE_LOADERS } from './utils/performance'

const Home = lazy(ROUTE_LOADERS.Home)
const Layout = lazy(ROUTE_LOADERS.Layout)
const Tools = lazy(ROUTE_LOADERS.Tools)
const AddPatient = lazy(ROUTE_LOADERS.AddPatient)
const PatientsList = lazy(ROUTE_LOADERS.PatientsList)
const PatientDetails = lazy(ROUTE_LOADERS.PatientDetails)
const Tests = lazy(ROUTE_LOADERS.Tests)
const Clinics = lazy(ROUTE_LOADERS.Clinics)
const Settings = lazy(ROUTE_LOADERS.Settings)
const AdminDashboard = lazy(ROUTE_LOADERS.AdminDashboard)
const MeibographyStandalone = lazy(ROUTE_LOADERS.MeibographyStandalone)
const Login = lazy(ROUTE_LOADERS.Login)

const RouteFallback = () => <LoadingState />
const HomeRedirect = () => <Navigate to={getDefaultRouteForUser(getAuthUserProfile())} replace />
const DoctorRoute = ({ children }) => <ProtectedRoute allowedRoles={['doctor', 'guest']}>{children}</ProtectedRoute>

export default function App() {
  return <BrowserRouter><AppErrorBoundary><div className="app"><Suspense fallback={<RouteFallback />}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
    <Route element={<ProtectedRoute><Layout><Suspense fallback={<RouteFallback />}><Outlet /></Suspense></Layout></ProtectedRoute>}>
      <Route path="/home" element={<DoctorRoute><Home /></DoctorRoute>} />
      <Route path="/tools" element={<DoctorRoute><Tools /></DoctorRoute>} />
      <Route path="/patients" element={<DoctorRoute><PatientsList /></DoctorRoute>} />
      <Route path="/patients/new" element={<DoctorRoute><AddPatient /></DoctorRoute>} />
      <Route path="/patients/:id" element={<DoctorRoute><PatientDetails /></DoctorRoute>} />
      <Route path="/tests" element={<DoctorRoute><Tests /></DoctorRoute>} />
      <Route path="/patients/:id/reports" element={<DoctorRoute><Tests /></DoctorRoute>} />
      <Route path="/clinics" element={<DoctorRoute><Clinics /></DoctorRoute>} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
    </Route>
    <Route path="/test/:patientId" element={<DoctorRoute><MeibographyStandalone /></DoctorRoute>} />
    <Route path="/eye-test/meibography" element={<DoctorRoute><MeibographyStandalone /></DoctorRoute>} />
    <Route path="/blink-rate" element={<Navigate to="/eye-test/meibography?section=blink-rate" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></div></AppErrorBoundary></BrowserRouter>
}

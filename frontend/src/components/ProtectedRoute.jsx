// Route guard that keeps authenticated pages behind a validated backend session.
import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getAuthUserProfile, getDefaultRouteForUser, isAuthenticated, loadAuthSession } from '../utils/auth'
import { isGuestRoleAllowed } from '../features/demo/session.js'

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const location = useLocation()
  const [authState, setAuthState] = useState(() => (
    isAuthenticated() ? 'authenticated' : 'checking'
  ))

  useEffect(() => {
    let isMounted = true

    // Reconfirm any stored session with the backend so stale local storage cannot bypass auth.
    const validateSession = async () => {
      if (isAuthenticated()) {
        setAuthState('authenticated')

        try {
          const user = await loadAuthSession()
          if (isMounted && !user) {
            setAuthState('unauthenticated')
          }
        } catch (error) {
          if (isMounted) {
            setAuthState('unauthenticated')
          }
        }
        return
      }

      try {
        const user = await loadAuthSession()
        if (isMounted) {
          setAuthState(user ? 'authenticated' : 'unauthenticated')
        }
      } catch (error) {
        if (isMounted) {
          setAuthState('unauthenticated')
        }
      }
    }

    validateSession()

    return () => {
      isMounted = false
    }
  }, [location.pathname])

  if (authState === 'checking') {
    return (
      <div className="login-page">
        <div className="login-card">
          <span className="login-kicker">Session Check</span>
          <h1 className="login-title">Checking secure access...</h1>
          <p className="login-subtitle">Please wait while the active account session is verified.</p>
        </div>
      </div>
    )
  }

  if (authState !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const authUser = getAuthUserProfile()
  const normalizedAllowedRoles = Array.isArray(allowedRoles)
    ? allowedRoles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean)
    : []

  const guestAllowed = authUser.role === 'guest' && isGuestRoleAllowed(normalizedAllowedRoles)
  if (normalizedAllowedRoles.length > 0 && !normalizedAllowedRoles.includes(authUser.role) && !guestAllowed) {
    return <Navigate to={getDefaultRouteForUser(authUser)} replace />
  }

  return children
}

export default ProtectedRoute

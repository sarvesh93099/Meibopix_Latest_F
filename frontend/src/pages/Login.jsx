import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { ArrowRight, Check, Eye, EyeOff, FileText, Heart, LockKeyhole, Sparkles, Users, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { fetchAuthConfig, getDefaultRouteForUser, loadAuthSession, loginSession, startGuestSession } from '../utils/auth'
import { buildApiUrl, getApiErrorMessage } from '../utils/api'
import EyeIllustration from '../components/EyeIllustration'
import '../styles/login.css'

const Login = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [authConfig, setAuthConfig] = useState({
    configured: false,
    username_hint: 'Authorized user',
    two_factor_enabled: false,
    two_factor_ready: true
  })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [signupModalOpen, setSignupModalOpen] = useState(false)
  const [signupEmail, setSignupEmail] = useState('')
  const [signupError, setSignupError] = useState('')
  const [signupSuccess, setSignupSuccess] = useState('')
  const [signupSubmitting, setSignupSubmitting] = useState(false)
  const signupButtonRef = useRef(null)
  const signupDialogRef = useRef(null)

  useEffect(() => {
    let isMounted = true

    const bootstrap = async () => {
      try {
        const [sessionResult, configResult] = await Promise.allSettled([loadAuthSession(), fetchAuthConfig()])
        if (!isMounted) return
        const activeSession = sessionResult.status === 'fulfilled' ? sessionResult.value : null

        if (activeSession) {
          navigate(getDefaultRouteForUser(activeSession), { replace: true })
          return
        }

        if (configResult.status !== 'fulfilled') throw configResult.reason
        const config = configResult.value
        if (!isMounted) {
          return
        }

        setAuthConfig(config)
      } catch (authError) {
        if (isMounted) {
          setError('Staff sign-in is unavailable right now. You can still explore as a guest.')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    bootstrap()

    return () => {
      isMounted = false
    }
  }, [navigate])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const result = await loginSession({ username, password, otp })
    if (!result.success) {
      setError(result.message)
      setSubmitting(false)
      return
    }

    const redirectParam = new URLSearchParams(location.search).get('redirect')
    const requestedRedirect = location.state?.from || redirectParam
    const safeRedirect = typeof requestedRedirect === 'string' && requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//') && !requestedRedirect.startsWith('/login')
    const redirectTo = safeRedirect ? requestedRedirect : getDefaultRouteForUser(result.user)
    setSubmitting(false)
    navigate(redirectTo, { replace: true })
  }

  const openSignupModal = () => {
    setSignupModalOpen(true)
    setSignupError('')
    setSignupSuccess('')
  }

  const handleGuest = () => {
    const guest = startGuestSession()
    navigate(getDefaultRouteForUser(guest), { replace: true })
  }

  const closeSignupModal = () => {
    if (signupSubmitting) {
      return
    }

    setSignupModalOpen(false)
    setSignupError('')
    setSignupSuccess('')
    setSignupEmail('')
    signupButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!signupModalOpen) return
    signupDialogRef.current?.querySelector('input')?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !signupSubmitting) closeSignupModal()
      if (event.key !== 'Tab') return
      const controls = [...(signupDialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled])') || [])]
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [signupModalOpen, signupSubmitting])

  const handleSignupRequest = async (event) => {
    event.preventDefault()
    setSignupSubmitting(true)
    setSignupError('')
    setSignupSuccess('')

    try {
      const response = await axios.post(buildApiUrl('/api/signup-request'), {
        email: signupEmail.trim()
      }, { timeout: 12000 })
      setSignupSuccess(response.data?.message || 'Signup request submitted for admin review.')
      setSignupEmail('')
    } catch (requestError) {
      setSignupError(getApiErrorMessage(requestError, 'Unable to submit signup request.'))
    } finally {
      setSignupSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-story-title">
        <div className="login-story-brand"><span className="login-story-brand-icon"><Eye size={24} strokeWidth={1.5} aria-hidden="true" /></span><span>MeiboPix<span className="login-brand-dot">.</span></span></div>
        <span className="login-story-kicker"><Heart size={15} aria-hidden="true" /> THE ART OF SEEING CLEARLY</span>
        <h1 id="login-story-title" className="login-story-title">Care begins<br />with <span>clarity.</span></h1>
        <p className="login-story-description">A considered space for eye assessments, patient care, and the details that make a difference.</p>
        <div className="login-eye-study" aria-hidden="true"><EyeIllustration /><span>OBSERVE. ASSESS. UNDERSTAND.</span></div>
        <div className="login-preview-card" aria-label="Three simple steps in the workspace">
          <div className="login-preview-heading"><span className="login-preview-icon"><Eye size={23} aria-hidden="true" /></span><div><strong>A clearer path to your results</strong><span>One connected workspace</span></div><span className="login-preview-check"><Check size={18} aria-hidden="true" /></span></div>
          <ol className="login-preview-steps">
            <li><span>1</span><Users size={19} aria-hidden="true" /><div><strong>Choose a person</strong><small>Open their simple profile</small></div></li>
            <li><span>2</span><Eye size={19} aria-hidden="true" /><div><strong>Pick an eye check</strong><small>Follow clear instructions</small></div></li>
            <li><span>3</span><FileText size={19} aria-hidden="true" /><div><strong>See the result</strong><small>Save a report to share</small></div></li>
          </ol>
        </div>
        <div className="login-story-highlights"><span><Check size={14} />8 eye tests</span><span><Check size={14} />Guided sessions</span><span><Check size={14} />Shareable reports</span></div>
        <p className="login-story-footer"><LockKeyhole size={14} aria-hidden="true" /> Your guest workspace and staff records stay separate.</p>
      </section>
      <div className="login-card">
        <span className="login-kicker">WELCOME TO MEIBOPIX</span>
        <h2 className="login-title">Welcome to a<br />clearer workspace.</h2>
        <p className="login-subtitle">Everything you need for your next eye assessment.</p>
        <button type="button" className="login-guest-btn" onClick={handleGuest} disabled={submitting}>
          <span className="login-guest-icon"><Sparkles size={22} aria-hidden="true" /></span>
          <span><strong>Explore as a guest</strong><small>No account or password needed</small></span>
          <ArrowRight size={21} aria-hidden="true" />
        </button>
        <p className="login-guest-note">All eight tests and reports are available. Your guest results stay in this tab. Image tests send only your selected image for processing.</p>
        <div className="login-divider"><span>or sign in to your workspace</span></div>

        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="login-username" className="login-label">Username</label>
          <input
            id="login-username"
            type="text"
            className="login-input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Your username"
            autoComplete="username"
            disabled={loading || submitting || !authConfig.configured}
            required
          />

          <label htmlFor="login-password" className="login-label">Password</label>
          <div className="login-password-field"><input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            className="login-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            disabled={loading || submitting || !authConfig.configured}
            required
          /><button type="button" className="login-password-toggle" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={loading || !authConfig.configured}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>

          {authConfig.two_factor_enabled && (
            <>
              <label htmlFor="login-otp" className="login-label">6-digit security code</label>
              <input
                id="login-otp"
                type="text"
                className="login-input"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                disabled={loading || !authConfig.configured || !authConfig.two_factor_ready}
              />
            </>
          )}

          {error && <div className="login-error" role="alert">{error}</div>}
          {!loading && !authConfig.configured && (
            <div className="login-note">Staff sign-in has not been set up yet. Your guest workspace is ready to use.</div>
          )}
          {!loading && authConfig.two_factor_enabled && !authConfig.two_factor_ready && (
            <div className="login-error" role="alert">Staff security settings need attention. Please contact your administrator.</div>
          )}

          <button
            type="submit"
            className="login-submit-btn"
            disabled={loading || submitting || !authConfig.configured || (authConfig.two_factor_enabled && !authConfig.two_factor_ready)}
          >
            {(loading || submitting) && <span className="login-busy" aria-hidden="true"><i /><i /><i /></span>}{loading ? 'Checking staff sign-in…' : submitting ? 'Signing in…' : 'Sign in'}
          </button>

          <button
            ref={signupButtonRef}
            type="button"
            className="login-secondary-btn"
            onClick={openSignupModal}
            disabled={signupSubmitting}
          >
            Request a staff account
          </button>
        </form>

        <div className="login-signup-copy">
          Staff accounts are approved by an administrator. Guest access is ready to use right away.
        </div>
      </div>

      {signupModalOpen && (
        <div className="login-modal-backdrop" role="presentation" onClick={closeSignupModal}>
          <div ref={signupDialogRef} className="login-modal" role="dialog" aria-modal="true" aria-labelledby="signup-request-title" onClick={(event) => event.stopPropagation()}>
            <div className="login-modal-header">
              <div>
                <h2 id="signup-request-title" className="login-modal-title">Request a staff account</h2>
                <p className="login-modal-subtitle">Share your email. An administrator will review your request.</p>
              </div>
              <button type="button" className="login-modal-close" onClick={closeSignupModal} aria-label="Close access request" disabled={signupSubmitting}>
                <X size={20} />
              </button>
            </div>

            <form className="login-modal-form" onSubmit={handleSignupRequest}>
              <label htmlFor="signup-email" className="login-label">Work email</label>
              <input
                id="signup-email"
                type="email"
                className="login-input"
                value={signupEmail}
                onChange={(event) => setSignupEmail(event.target.value)}
                placeholder="doctor@example.com"
                autoComplete="email"
                disabled={signupSubmitting}
                required
              />

              {signupError && <div className="login-error" role="alert">{signupError}</div>}
              {signupSuccess && <div className="login-success" role="status">{signupSuccess}</div>}

              <div className="login-modal-actions">
                <button type="button" className="login-secondary-btn" onClick={closeSignupModal} disabled={signupSubmitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="login-submit-btn"
                  disabled={signupSubmitting}
                >
                  {signupSubmitting ? 'Sending…' : 'Send request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}

export default Login

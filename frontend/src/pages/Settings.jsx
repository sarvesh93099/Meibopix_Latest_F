// Read-only account summary page for the currently signed-in clinic user.
import React from 'react'
import { getAuthUserProfile, isGuestSession, resetGuestDemo } from '../utils/auth'

const Settings = () => {
  const authUser = getAuthUserProfile()
  const isAdmin = authUser.role === 'admin'
  const guest = isGuestSession()
  const summaryItems = [
    { label: 'Authorized User', value: authUser.username || authUser.name || 'Not available' },
    { label: 'Workspace', value: guest ? 'Guest preview' : isAdmin ? 'Administrator' : 'Doctor' },
    { label: 'Access', value: guest ? 'Fictional sample data' : authUser.twoFactorEnabled ? '2FA Enabled' : 'Private staff session' }
  ]

  return (
    <div className="page-container settings-dashboard">
      <div className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-hero-kicker">MAKE YOURSELF AT HOME</span>
          <h1 className="dashboard-hero-title">Your account</h1>
          <p className="dashboard-hero-description">
            {guest ? 'You’re exploring the project as a guest. Your preview uses fictional people and sample reports.' : isAdmin
              ? 'This workspace controls operational visibility across doctor accounts, login activity, and patient distribution.'
              : 'This workspace protects the signed-in doctor session and preserves secure access to clinical patient data.'}
          </p>
        </div>
        <div className="dashboard-hero-stats">
          {summaryItems.map((item) => (
            <div key={item.label} className="dashboard-stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="settings-content">
        <div className="settings-heading-block">
          <h2 className="settings-title">Account Overview</h2>
          <p className="settings-subtitle">See which account you’re using and how your data is stored.</p>
        </div>

        <div className="settings-profile-card">
          <div className="settings-profile-row">
            <span className="settings-profile-label">Username:</span>
            <span className="settings-profile-value">{authUser.username || authUser.name || 'Not available'}</span>
          </div>
          <div className="settings-profile-row">
            <span className="settings-profile-label">Provider:</span>
            <span className="settings-profile-value">{guest ? 'Guest preview in this browser tab' : 'Secure staff sign-in'}</span>
          </div>
          <div className="settings-profile-row">
            <span className="settings-profile-label">Role:</span>
            <span className="settings-profile-value">{guest ? 'Guest' : isAdmin ? 'Administrator' : 'Doctor'}</span>
          </div>
          <div className="settings-profile-row">
            <span className="settings-profile-label">Last Login:</span>
            <span className="settings-profile-value">
              {authUser.lastLoginAt ? new Date(authUser.lastLoginAt).toLocaleString() : 'Not available'}
            </span>
          </div>
          <div className="settings-profile-row">
            <span className="settings-profile-label">Two-Factor Authentication:</span>
            <span className="settings-profile-value">{guest ? 'No password required for the preview' : authUser.twoFactorEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
        </div>

        <div className="settings-password-row">
          <div className="settings-security-note">
            {guest ? 'Guest changes stay in this browser tab. The preview does not access real patients or administrator tools. Reset the demo to restore its sample data.' : 'Need to change your password or account access? Contact your administrator.'}
            {guest && <div style={{ marginTop: 15 }}><button type="button" className="secondary-action" onClick={() => { resetGuestDemo(); window.location.reload() }}>Reset guest demo</button></div>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Settings
import '../styles/dashboard.css'

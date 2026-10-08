import React, { useEffect, useState } from 'react'
import axios from 'axios'
import {
  Activity,
  CheckCircle2,
  Clock3,
  Eye,
  EyeOff,
  ShieldCheck,
  ShieldX,
  Stethoscope,
  Trash2,
  Users
} from 'lucide-react'
import { buildApiUrl } from '../utils/api'

const emptyDashboard = {
  summary: {
    total_doctors: 0,
    active_doctors: 0,
    disabled_doctors: 0,
    pending_requests: 0,
    approved_requests: 0,
    rejected_requests: 0,
    total_logins: 0,
    total_patients: 0,
    unassigned_patients: 0
  },
  doctors: [],
  requests: []
}

const formatDateTime = (value, emptyLabel = 'Not available') => {
  if (!value) {
    return emptyLabel
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return emptyLabel
  }

  return date.toLocaleString()
}

const suggestUsername = (email) => {
  const emailText = String(email || '').trim().toLowerCase()
  const localPart = emailText.includes('@') ? emailText.split('@')[0] : emailText
  const safeValue = localPart.replace(/[^a-z0-9_.-]+/g, '.').replace(/^\.+|\.+$/g, '')
  return safeValue || 'doctor'
}

const AdminDashboard = () => {
  const [dashboard, setDashboard] = useState(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [approvalDrafts, setApprovalDrafts] = useState({})
  const [passwordDrafts, setPasswordDrafts] = useState({})
  const [approvalPasswordVisible, setApprovalPasswordVisible] = useState({})
  const [doctorPasswordVisible, setDoctorPasswordVisible] = useState({})
  const [credentialPreview, setCredentialPreview] = useState(null)

  const loadDashboard = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await axios.get(buildApiUrl('/api/admin/dashboard'))
      const payload = response.data || emptyDashboard
      setDashboard({
        ...emptyDashboard,
        ...payload,
        summary: {
          ...emptyDashboard.summary,
          ...(payload.summary || {})
        },
        doctors: Array.isArray(payload.doctors) ? payload.doctors : [],
        requests: Array.isArray(payload.requests) ? payload.requests : []
      })
    } catch (loadError) {
      console.error('Failed to load admin dashboard:', loadError)
      setError(loadError.response?.data?.error || 'Unable to load admin dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboard()
  }, [])

  const updateApprovalDraft = (requestId, field, value, email = '') => {
    setApprovalDrafts((currentDrafts) => {
      const existingDraft = currentDrafts[requestId] || {
        username: suggestUsername(email),
        password: '',
        email
      }

      return {
        ...currentDrafts,
        [requestId]: {
          ...existingDraft,
          [field]: value
        }
      }
    })
  }

  const getApprovalDraft = (requestItem) => {
    return approvalDrafts[requestItem.id] || {
      username: requestItem.approved_username || suggestUsername(requestItem.email),
      password: '',
      email: requestItem.email || ''
    }
  }

  const updatePasswordDraft = (doctorId, value) => {
    setPasswordDrafts((currentDrafts) => ({
      ...currentDrafts,
      [doctorId]: value
    }))
  }

  const toggleApprovalPasswordVisibility = (requestId) => {
    setApprovalPasswordVisible((currentVisibility) => ({
      ...currentVisibility,
      [requestId]: !currentVisibility[requestId]
    }))
  }

  const toggleDoctorPasswordVisibility = (doctorId) => {
    setDoctorPasswordVisible((currentVisibility) => ({
      ...currentVisibility,
      [doctorId]: !currentVisibility[doctorId]
    }))
  }

  const handleApprove = async (requestItem) => {
    const draft = getApprovalDraft(requestItem)
    setNotice('')
    setBusyKey(`approve-${requestItem.id}`)

    try {
      await axios.post(buildApiUrl(`/api/admin/requests/${requestItem.id}/approve`), {
        username: draft.username,
        password: draft.password,
        email: draft.email
      })
      setApprovalDrafts((currentDrafts) => ({
        ...currentDrafts,
        [requestItem.id]: {
          ...draft,
          password: ''
        }
      }))
      setCredentialPreview({
        title: 'Doctor Account Approved',
        username: draft.username,
        password: draft.password,
        description: `The account for ${requestItem.email} was approved with this password.`
      })
      setNotice(`Approved ${requestItem.email} and created the doctor account.`)
      await loadDashboard()
    } catch (actionError) {
      setError(actionError.response?.data?.error || 'Unable to approve doctor request.')
    } finally {
      setBusyKey('')
    }
  }

  const handleReject = async (requestItem) => {
    setNotice('')
    setBusyKey(`reject-${requestItem.id}`)

    try {
      await axios.post(buildApiUrl(`/api/admin/requests/${requestItem.id}/reject`))
      setNotice(`Rejected the request for ${requestItem.email}.`)
      await loadDashboard()
    } catch (actionError) {
      setError(actionError.response?.data?.error || 'Unable to reject doctor request.')
    } finally {
      setBusyKey('')
    }
  }

  const handlePasswordChange = async (doctor) => {
    const password = String(passwordDrafts[doctor.id] || '')
    if (!password.trim()) {
      setError('Enter a new password before saving.')
      return
    }

    setNotice('')
    setBusyKey(`password-${doctor.id}`)

    try {
      await axios.post(buildApiUrl(`/api/admin/doctors/${doctor.id}/password`), {
        password
      })
      setPasswordDrafts((currentDrafts) => ({
        ...currentDrafts,
        [doctor.id]: ''
      }))
      setCredentialPreview({
        title: 'Doctor Password Updated',
        username: doctor.username,
        password,
        description: `The password for ${doctor.username} was changed successfully.`
      })
      setNotice(`Updated the password for ${doctor.username}.`)
      await loadDashboard()
    } catch (actionError) {
      setError(actionError.response?.data?.error || 'Unable to update doctor password.')
    } finally {
      setBusyKey('')
    }
  }

  const handleToggleDoctor = async (doctor) => {
    setNotice('')
    setBusyKey(`status-${doctor.id}`)

    try {
      await axios.post(buildApiUrl(`/api/admin/doctors/${doctor.id}/disable`), {
        disabled: doctor.is_active
      })
      setNotice(`${doctor.is_active ? 'Disabled' : 'Re-enabled'} ${doctor.username}.`)
      await loadDashboard()
    } catch (actionError) {
      setError(actionError.response?.data?.error || 'Unable to update doctor status.')
    } finally {
      setBusyKey('')
    }
  }

  const handleDeleteDoctor = async (doctor) => {
    const confirmed = window.confirm(`Delete doctor account "${doctor.username}"? Assigned patients will be unassigned.`)
    if (!confirmed) {
      return
    }

    setNotice('')
    setBusyKey(`delete-${doctor.id}`)

    try {
      const response = await axios.delete(buildApiUrl(`/api/admin/doctors/${doctor.id}`))
      const unassignedCount = response.data?.patients_unassigned || 0
      setNotice(`Deleted ${doctor.username}. ${unassignedCount} patient${unassignedCount === 1 ? '' : 's'} were unassigned.`)
      await loadDashboard()
    } catch (actionError) {
      setError(actionError.response?.data?.error || 'Unable to delete doctor account.')
    } finally {
      setBusyKey('')
    }
  }

  const summaryCards = [
    {
      label: 'Pending Requests',
      value: dashboard.summary.pending_requests || 0,
      icon: <Clock3 size={18} />
    },
    {
      label: 'Active Doctors',
      value: dashboard.summary.active_doctors || 0,
      icon: <ShieldCheck size={18} />
    },
    {
      label: 'Disabled Doctors',
      value: dashboard.summary.disabled_doctors || 0,
      icon: <ShieldX size={18} />
    },
    {
      label: 'Total Doctors',
      value: dashboard.summary.total_doctors || 0,
      icon: <Stethoscope size={18} />
    },
    {
      label: 'Doctor Logins',
      value: dashboard.summary.total_logins || 0,
      icon: <Activity size={18} />
    },
    {
      label: 'Assigned Patients',
      value: dashboard.summary.total_patients || 0,
      icon: <Users size={18} />
    }
  ]

  return (
    <div className="page-container admin-dashboard-page">
      <div className="dashboard-hero admin-dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-hero-kicker">Admin Overview</span>
          <h1 className="dashboard-hero-title">Doctor Access Control</h1>
          <p className="dashboard-hero-description">
            Review doctor signup requests, approve accounts manually, and manage doctor credentials from one protected dashboard.
          </p>
        </div>
        <div className="dashboard-hero-stats">
          {summaryCards.map((item) => (
            <div key={item.label} className="dashboard-stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {notice && <div className="admin-dashboard-banner admin-dashboard-banner-success">{notice}</div>}
      {error && <div className="admin-dashboard-banner admin-dashboard-banner-error">{error}</div>}
      {credentialPreview && (
        <div className="admin-credential-preview">
          <div className="admin-credential-preview-header">
            <div>
              <strong>{credentialPreview.title}</strong>
              <p>{credentialPreview.description}</p>
            </div>
            <button
              type="button"
              className="admin-action-btn admin-action-btn-secondary"
              onClick={() => setCredentialPreview(null)}
            >
              Close
            </button>
          </div>
          <div className="admin-credential-preview-grid">
            <div>
              <span className="admin-credential-label">Username</span>
              <code className="admin-credential-value">{credentialPreview.username}</code>
            </div>
            <div>
              <span className="admin-credential-label">Password</span>
              <code className="admin-credential-value">{credentialPreview.password}</code>
            </div>
          </div>
          <p className="admin-credential-note">Existing saved passwords cannot be recovered later. This preview only shows the password you just entered.</p>
        </div>
      )}

      <div className="admin-management-grid">
        <section className="admin-dashboard-panel admin-section-card">
          <div className="admin-dashboard-heading">
            <h2 className="settings-title">Doctor Signup Requests</h2>
            <p className="settings-subtitle">Approve pending requests by assigning a username and password, or reject them to keep access closed.</p>
          </div>

          {loading ? (
            <div className="admin-dashboard-empty">Loading signup requests...</div>
          ) : dashboard.requests.length === 0 ? (
            <div className="admin-dashboard-empty">No doctor signup requests have been submitted yet.</div>
          ) : (
            <div className="admin-table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.requests.map((requestItem) => {
                    const draft = getApprovalDraft(requestItem)
                    const isApproved = requestItem.status === 'approved'

                    return (
                      <tr key={requestItem.id}>
                        <td>
                          <div className="admin-primary-cell">{requestItem.email}</div>
                          <div className="admin-secondary-cell">Request #{requestItem.id}</div>
                        </td>
                        <td>
                          <span className={`admin-status-pill admin-status-${requestItem.status}`}>
                            {requestItem.status}
                          </span>
                        </td>
                        <td>{formatDateTime(requestItem.created_at)}</td>
                        <td>
                          {isApproved ? (
                            <div className="admin-approved-copy">
                              <CheckCircle2 size={16} />
                              <span>Approved as @{requestItem.approved_username || requestItem.doctor?.username || 'doctor'}</span>
                            </div>
                          ) : (
                            <div className="admin-inline-form">
                              <input
                                type="text"
                                name={`approval-username-${requestItem.id}`}
                                className="admin-inline-input"
                                value={draft.username}
                                onChange={(event) => updateApprovalDraft(requestItem.id, 'username', event.target.value, requestItem.email)}
                                placeholder="Username"
                                disabled={busyKey !== '' && busyKey !== `approve-${requestItem.id}`}
                              />
                              <div className="admin-password-input-row">
                                <input
                                  type={approvalPasswordVisible[requestItem.id] ? 'text' : 'password'}
                                  name={`approval-password-${requestItem.id}`}
                                  className="admin-inline-input"
                                  value={draft.password}
                                  onChange={(event) => updateApprovalDraft(requestItem.id, 'password', event.target.value, requestItem.email)}
                                  placeholder="Password"
                                  disabled={busyKey !== '' && busyKey !== `approve-${requestItem.id}`}
                                />
                                <button
                                  type="button"
                                  className="admin-password-toggle"
                                  onClick={() => toggleApprovalPasswordVisibility(requestItem.id)}
                                  aria-label={approvalPasswordVisible[requestItem.id] ? 'Hide password' : 'Show password'}
                                >
                                  {approvalPasswordVisible[requestItem.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                                  <span>{approvalPasswordVisible[requestItem.id] ? 'Hide' : 'Show'}</span>
                                </button>
                              </div>
                              <div className="admin-row-actions">
                                <button
                                  type="button"
                                  className="admin-action-btn admin-action-btn-primary"
                                  onClick={() => handleApprove(requestItem)}
                                  disabled={busyKey === `approve-${requestItem.id}` || busyKey === `reject-${requestItem.id}`}
                                >
                                  {busyKey === `approve-${requestItem.id}` ? 'Approving...' : 'Approve'}
                                </button>
                                <button
                                  type="button"
                                  className="admin-action-btn admin-action-btn-secondary"
                                  onClick={() => handleReject(requestItem)}
                                  disabled={busyKey === `approve-${requestItem.id}` || busyKey === `reject-${requestItem.id}`}
                                >
                                  {busyKey === `reject-${requestItem.id}` ? 'Rejecting...' : 'Reject'}
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-dashboard-panel admin-section-card">
          <div className="admin-dashboard-heading">
            <h2 className="settings-title">Doctor Account Management</h2>
            <p className="settings-subtitle">Change passwords, disable access, or delete a doctor account. Patient records stay intact and become unassigned if the doctor is deleted.</p>
            <p className="admin-dashboard-helper">Stored passwords are protected as secure hashes, so the dashboard can only show the password you are currently entering or just changed.</p>
          </div>

          {loading ? (
            <div className="admin-dashboard-empty">Loading doctor accounts...</div>
          ) : dashboard.doctors.length === 0 ? (
            <div className="admin-dashboard-empty">No doctor accounts are available yet.</div>
          ) : (
            <div className="admin-table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Doctor</th>
                    <th>Status</th>
                    <th>Patients</th>
                    <th>Last Login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.doctors.map((doctor) => (
                    <tr key={doctor.id}>
                      <td>
                        <div className="admin-primary-cell">{doctor.username}</div>
                        <div className="admin-secondary-cell">{doctor.email}</div>
                      </td>
                      <td>
                        <span className={`admin-status-pill ${doctor.is_active ? 'admin-status-approved' : 'admin-status-rejected'}`}>
                          {doctor.is_active ? 'active' : 'disabled'}
                        </span>
                      </td>
                      <td>{doctor.patient_count || 0}</td>
                      <td>{formatDateTime(doctor.last_login_at, 'No login yet')}</td>
                      <td>
                        <div className="admin-inline-form">
                          <div className="admin-password-input-row">
                            <input
                              type={doctorPasswordVisible[doctor.id] ? 'text' : 'password'}
                              name={`doctor-password-${doctor.id}`}
                              className="admin-inline-input"
                              value={passwordDrafts[doctor.id] || ''}
                              onChange={(event) => updatePasswordDraft(doctor.id, event.target.value)}
                              placeholder="New password"
                              disabled={busyKey !== '' && !busyKey.startsWith(`password-${doctor.id}`)}
                            />
                            <button
                              type="button"
                              className="admin-password-toggle"
                              onClick={() => toggleDoctorPasswordVisibility(doctor.id)}
                              aria-label={doctorPasswordVisible[doctor.id] ? 'Hide password' : 'Show password'}
                            >
                              {doctorPasswordVisible[doctor.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                              <span>{doctorPasswordVisible[doctor.id] ? 'Hide' : 'Show'}</span>
                            </button>
                          </div>
                          <div className="admin-row-actions">
                            <button
                              type="button"
                              className="admin-action-btn admin-action-btn-primary"
                              onClick={() => handlePasswordChange(doctor)}
                              disabled={busyKey === `password-${doctor.id}`}
                            >
                              {busyKey === `password-${doctor.id}` ? 'Saving...' : 'Change Password'}
                            </button>
                            <button
                              type="button"
                              className="admin-action-btn admin-action-btn-secondary"
                              onClick={() => handleToggleDoctor(doctor)}
                              disabled={busyKey === `status-${doctor.id}`}
                            >
                              {busyKey === `status-${doctor.id}` ? 'Updating...' : doctor.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              className="admin-action-btn admin-action-btn-danger"
                              onClick={() => handleDeleteDoctor(doctor)}
                              disabled={busyKey === `delete-${doctor.id}`}
                            >
                              {busyKey === `delete-${doctor.id}` ? 'Deleting...' : (
                                <>
                                  <Trash2 size={16} />
                                  <span>Delete</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

    </div>
  )
}

export default AdminDashboard
import '../styles/dashboard.css'

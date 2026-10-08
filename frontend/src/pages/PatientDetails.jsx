// Patient profile page with inline editing and shortcuts into the testing workflow.
import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import PatientAvatar from '../components/PatientAvatar'
import { getCachedPatientById, upsertCachedPatient } from '../utils/patientCache'
import { buildApiUrl } from '../utils/api'

const PatientDetails = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [patient, setPatient] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({
    full_name: '',
    age: '',
    gender: '',
    mobile: ''
  })

  useEffect(() => {
    fetchPatientDetails()
  }, [id])

  const fetchPatientDetails = async () => {
    // Use the backend as the source of truth, then cache the record for offline recovery.
    try {
      const response = await axios.get(buildApiUrl(`/api/patients/${id}`))
      setPatient(response.data)
      upsertCachedPatient(response.data)
      setEditForm({
        full_name: response.data.full_name,
        age: response.data.age,
        gender: response.data.gender,
        mobile: response.data.mobile
      })
    } catch (error) {
      console.error('Error fetching patient details:', error)
      const cachedPatient = getCachedPatientById(id)
      if (cachedPatient) {
        setPatient(cachedPatient)
        setEditForm({
          full_name: cachedPatient.full_name,
          age: cachedPatient.age,
          gender: cachedPatient.gender,
          mobile: cachedPatient.mobile
        })
        showToast('Showing saved patient details from cache', 'success')
      } else {
        showToast('Failed to fetch patient details', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = () => {
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditForm({
      full_name: patient.full_name,
      age: patient.age,
      gender: patient.gender,
      mobile: patient.mobile
    })
  }

  const handleSave = async () => {
    try {
      const ageNum = parseInt(editForm.age, 10)
      if (Number.isNaN(ageNum) || ageNum <= 0) {
        showToast('Please enter a valid age', 'error')
        return
      }

      const formData = {
        ...editForm,
        age: ageNum
      }

      const response = await axios.put(buildApiUrl(`/api/patients/${id}`), formData)
      const updatedPatient = response.data
      setPatient(updatedPatient)
      upsertCachedPatient(updatedPatient)
      setIsEditing(false)
      showToast('Patient updated successfully', 'success')

    } catch (error) {
      console.error('Error updating patient:', error)
      const errorMessage = error.response?.data?.error || 'Failed to update patient'
      showToast(errorMessage, 'error')
    }
  }

  const handleInputChange = (event) => {
    setEditForm({
      ...editForm,
      [event.target.name]: event.target.value
    })
  }

  const showToast = (message, type) => {
    const toast = document.createElement('div')
    toast.className = `toast ${type}`
    toast.textContent = message
    document.body.appendChild(toast)

    setTimeout(() => {
      toast.remove()
    }, 3000)
  }

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div className="loading-spinner"></div>
          <p style={{ marginTop: '20px', color: '#666' }}>Loading patient details...</p>
        </div>
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="page-container">
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <h2 style={{ color: '#666', marginBottom: '20px' }}>Patient Not Found</h2>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/patients')}
          >
            Back to Patients
          </button>
        </div>
      </div>
    )
  }

  const createdLabel = patient.created_at ? new Date(patient.created_at).toLocaleDateString() : 'N/A'
  const summaryItems = [
    { label: 'Age', value: `${patient.age} yrs` },
    { label: 'Gender', value: patient.gender },
    { label: 'Added', value: createdLabel }
  ]

  return (
    <div className="patient-details-page">
      <div className="patient-details-topbar">
        <button
          type="button"
          className="details-back-button"
          onClick={() => navigate('/patients')}
        >
          Back to Patients
        </button>
      </div>

        <div className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <span className="dashboard-hero-kicker">Patient Overview</span>
            <h1 className="dashboard-hero-title">{patient.full_name}</h1>
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

      <div className="patient-details-card">
        <div className="patient-details-header">
          <div className="patient-header-content">
            <PatientAvatar
              style={patient.avatar_style}
              label={patient.full_name}
              size="xl"
              className="patient-avatar"
              decorative
            />
            <div className="patient-header-info">
              <h2 className="patient-details-name">{patient.full_name}</h2>
              <div className="patient-details-meta">
                <span className="patient-details-id">ID: #{patient.id}</span>
                <span className="patient-details-date">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '14px', height: '14px', marginRight: '4px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Added: {createdLabel}
                </span>
                <span className="patient-status active">Active</span>
              </div>
            </div>
          </div>
          <div className="patient-header-actions">
            {!isEditing ? (
              <button
                className="btn btn-primary edit-btn"
                onClick={handleEdit}
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '16px', height: '16px', marginRight: '8px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Patient
              </button>
            ) : (
              <div className="edit-actions">
                <button
                  className="btn btn-success"
                  onClick={handleSave}
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '16px', height: '16px', marginRight: '8px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleCancel}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="patient-details-content">
          <div className="patient-details-section">
            <h3 className="section-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '20px', height: '20px', marginRight: '8px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Personal Information
            </h3>
            <div className="info-grid">
              <div className="info-item">
                <label>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '14px', height: '14px', marginRight: '6px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  Full Name:
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    name="full_name"
                    value={editForm.full_name}
                    onChange={handleInputChange}
                    className="edit-input"
                  />
                ) : (
                  <span>{patient.full_name}</span>
                )}
              </div>
              <div className="info-item">
                <label>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '14px', height: '14px', marginRight: '6px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Age:
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    name="age"
                    value={editForm.age}
                    onChange={handleInputChange}
                    className="edit-input"
                  />
                ) : (
                  <span>{patient.age} years</span>
                )}
              </div>
              <div className="info-item">
                <label>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '14px', height: '14px', marginRight: '6px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  Gender:
                </label>
                {isEditing ? (
                  <select
                    name="gender"
                    value={editForm.gender}
                    onChange={handleInputChange}
                    className="edit-input"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <span>{patient.gender}</span>
                )}
              </div>
              <div className="info-item">
                <label>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '14px', height: '14px', marginRight: '6px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Mobile Number:
                </label>
                {isEditing ? (
                  <input
                    type="tel"
                    name="mobile"
                    value={editForm.mobile}
                    onChange={handleInputChange}
                    className="edit-input"
                  />
                ) : (
                  <span>{patient.mobile}</span>
                )}
              </div>
            </div>
          </div>

          <div className="patient-details-section">
            <h3 className="section-title">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '20px', height: '20px', marginRight: '8px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Actions
            </h3>
            <div className="combined-action-container">
              <div className="combined-action-btn" onClick={() => navigate(`/test/${patient.id}`)}>
                <div className="action-icon primary">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                </div>
                <div className="action-content">
                  <span className="action-title">Start Test</span>
                  <span className="action-desc">Begin new eye examination</span>
                </div>
              </div>

              <div className="combined-action-btn" onClick={() => navigate(`/patients/${patient.id}/history`)}>
                <div className="action-icon secondary">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="action-content">
                  <span className="action-title">View History</span>
                  <span className="action-desc">See past test results</span>
                </div>
              </div>

              <div className="combined-action-btn" onClick={() => navigate(`/patients/${patient.id}/reports`)}>
                <div className="action-icon tertiary">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v1a1 1 0 001 1h4a1 1 0 001-1v-1m3-2V8a2 2 0 00-2-2H8a2 2 0 00-2 2v8m5-4h.01" />
                  </svg>
                </div>
                <div className="action-content">
                  <span className="action-title">Download Reports</span>
                  <span className="action-desc">Export patient documents</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PatientDetails
import '../styles/dashboard.css'

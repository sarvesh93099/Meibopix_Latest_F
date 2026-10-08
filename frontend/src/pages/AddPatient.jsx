// Form page for creating a new patient record before launching exam workflows.
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import PatientAvatar, {
  DEFAULT_PATIENT_AVATAR_STYLE,
  getPatientAvatarOption,
  PATIENT_AVATAR_OPTIONS
} from '../components/PatientAvatar'
import { upsertCachedPatient } from '../utils/patientCache'
import { buildApiUrl } from '../utils/api'

const MOBILE_NUMBER_ERROR = 'Mobile number should contain exactly 10 digits.'

const AddPatient = () => {
  const navigate = useNavigate()
  const [formData, setFormData] = useState({
    full_name: '',
    age: '',
    mobile: '',
    gender: 'Male',
    avatar_style: DEFAULT_PATIENT_AVATAR_STYLE
  })
  const [loading, setLoading] = useState(false)
  const [mobileError, setMobileError] = useState('')

  // Keep form state updates shallow so each field can reuse the same change handler.
  const handleChange = (e) => {
    const { name, value } = e.target
    const normalizedValue = name === 'mobile' ? String(value || '').replace(/\D/g, '') : value

    setFormData(prev => ({
      ...prev,
      [name]: normalizedValue
    }))

    if (name === 'mobile') {
      if (normalizedValue.length === 0 || normalizedValue.length === 10) {
        setMobileError('')
      } else {
        setMobileError(MOBILE_NUMBER_ERROR)
      }
    }
  }

  const handleGenderChange = (gender) => {
    setFormData(prev => ({
      ...prev,
      gender
    }))
  }

  const handleAvatarChange = (avatarStyle) => {
    setFormData(prev => ({
      ...prev,
      avatar_style: avatarStyle
    }))
  }

  const handleAvatarCycle = () => {
    const currentIndex = PATIENT_AVATAR_OPTIONS.findIndex((option) => option.id === formData.avatar_style)
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % PATIENT_AVATAR_OPTIONS.length
      : 0
    handleAvatarChange(PATIENT_AVATAR_OPTIONS[nextIndex].id)
  }

  const handleReset = () => {
    setFormData({
      full_name: '',
      age: '',
      mobile: '',
      gender: 'Male',
      avatar_style: DEFAULT_PATIENT_AVATAR_STYLE
    })
    setMobileError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const age = Number(formData.age)
    if (!formData.full_name.trim() || !Number.isInteger(age) || age < 1 || age > 130) {
      showToast('Enter a name and an age from 1 to 130.', 'error')
      return
    }

    if (formData.mobile.length !== 10) {
      setMobileError(MOBILE_NUMBER_ERROR)
      showToast(MOBILE_NUMBER_ERROR, 'error')
      return
    }

    setLoading(true)

    try {
      console.info('Creating patient record...')
      const response = await axios.post(buildApiUrl('/api/patients'), {
        ...formData,
        full_name: formData.full_name.trim(),
        age
      })
      upsertCachedPatient(response.data)

      showToast('Patient created successfully', 'success')
      navigate('/patients')
    } catch (error) {
      console.error('Error creating patient:', error)
      showToast(error.response?.data?.error || 'We couldn’t save this patient. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
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

  const selectedAvatarOption = getPatientAvatarOption(formData.avatar_style)

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-container">
          <button type="button" className="page-back" aria-label="Back to patients" onClick={() => navigate('/patients')}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="page-title">Add New Patient</h1>
        </div>
        <div className="page-share">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m9.032 4.026a9.001 9.001 0 01-7.432 0m9.032-4.026A9.001 9.001 0 0112 3c-4.474 0-8.268 3.12-9.032 7.326m0 4.026A9.001 9.001 0 0012 21c4.474 0 8.268-3.12 9.032-7.326" />
          </svg>
        </div>
      </div>

      {/* Profile Section */}
      <div className="profile-section">
        <button
          type="button"
          className="profile-cycle-button"
          onClick={handleAvatarCycle}
          aria-label="Change patient profile color"
        >
          <PatientAvatar
            style={formData.avatar_style}
            label={formData.full_name || 'Patient'}
            size="xl"
            decorative
          />
        </button>

        <div className="profile-cycle-copy">
          <span className="profile-cycle-kicker">Color Profile</span>
          <strong className="profile-cycle-title">{selectedAvatarOption.label}</strong>
          <span className="profile-cycle-subtitle">Click the profile image to switch between the 5 color presets.</span>
        </div>

        <div className="profile-palette" role="group" aria-label="Patient profile colors">
          {PATIENT_AVATAR_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`profile-palette-button ${formData.avatar_style === option.id ? 'active' : ''}`}
              onClick={() => handleAvatarChange(option.id)}
              aria-label={`Use ${option.label} profile color`}
            >
              <span
                className="profile-palette-swatch"
                style={{ '--patient-avatar-gradient': option.gradient }}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="patient-full-name">Full name</label>
          <input
            type="text"
            name="full_name"
            id="patient-full-name"
            value={formData.full_name}
            onChange={handleChange}
            className="form-input"
            placeholder="Enter full name"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="patient-age">Age</label>
          <input
            type="number"
            name="age"
            id="patient-age"
            value={formData.age}
            onChange={handleChange}
            className="form-input"
            placeholder="Enter age"
            min="1"
            max="130"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="patient-phone">Phone number</label>
          <input
            type="tel"
            name="mobile"
            id="patient-phone"
            value={formData.mobile}
            onChange={handleChange}
            onBlur={() => {
              if (formData.mobile.length > 0 && formData.mobile.length !== 10) {
                setMobileError(MOBILE_NUMBER_ERROR)
              }
            }}
            className="form-input"
            placeholder="Enter mobile number"
            inputMode="numeric"
            maxLength={10}
            aria-invalid={Boolean(mobileError)}
            aria-describedby={mobileError ? 'patient-phone-error' : undefined}
            required
          />
          {mobileError && <div id="patient-phone-error" className="form-error" role="alert">{mobileError}</div>}
        </div>

        <div className="form-group">
          <label className="form-label">Gender</label>
          <div className="radio-group">
            <label className={`radio-pill ${formData.gender === 'Male' ? 'active' : ''}`}>
              <input
                type="radio"
                name="gender"
                value="Male"
                checked={formData.gender === 'Male'}
                onChange={() => handleGenderChange('Male')}
                className="radio-input"
              />
              Male
            </label>
            <label className={`radio-pill ${formData.gender === 'Female' ? 'active' : ''}`}>
              <input
                type="radio"
                name="gender"
                value="Female"
                checked={formData.gender === 'Female'}
                onChange={() => handleGenderChange('Female')}
                className="radio-input"
              />
              Female
            </label>
            <label className={`radio-pill ${formData.gender === 'Other' ? 'active' : ''}`}>
              <input
                type="radio"
                name="gender"
                value="Other"
                checked={formData.gender === 'Other'}
                onChange={() => handleGenderChange('Other')}
                className="radio-input"
              />
              Other
            </label>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" onClick={handleReset} className="btn btn-outline">
            Reset
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : 'Save patient'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default AddPatient
import '../styles/dashboard.css'

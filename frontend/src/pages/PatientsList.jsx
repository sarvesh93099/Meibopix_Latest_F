// Dashboard landing page that lists patients, local search filters, and quick navigation actions.
import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { CalendarDays, ChevronRight, Search, Stethoscope, Trash2, UserPlus, Users } from 'lucide-react'
import PatientAvatar from '../components/PatientAvatar'
import { getCachedPatients, removeCachedPatient, setCachedPatients } from '../utils/patientCache'
import { buildApiUrl } from '../utils/api'

const PatientsList = () => {
  const navigate = useNavigate()
  const [allPatients, setAllPatients] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [feedback, setFeedback] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    fetchPatients()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, activeFilter])

  const fetchPatients = async () => {
    // Prefer live backend data, but fall back to the cached snapshot so the dashboard stays usable.
    try {
      setLoading(true)
      setFeedback('')
      const response = await axios.get(buildApiUrl('/api/patients'))
      const records = Array.isArray(response.data) ? response.data : []
      setAllPatients(records)
      setCachedPatients(records)
    } catch (error) {
      console.error('Error fetching patients:', error)
      const cachedPatients = getCachedPatients()
      if (cachedPatients.length > 0) {
        setAllPatients(cachedPatients)
        setFeedback('You’re viewing a saved copy. Try again to get the latest records.')
      } else {
        setFeedback('We couldn’t load your patients. Check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const patients = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const days = activeFilter === 'recent' ? 3 : activeFilter === 'last3weeks' ? 21 : null
    const cutoff = new Date()
    if (days) cutoff.setDate(cutoff.getDate() - days)
    return allPatients.filter(patient => (
      (!query || `${patient.full_name || ''} ${patient.mobile || ''}`.toLowerCase().includes(query)) &&
      (!days || new Date(patient.created_at) >= cutoff)
    ))
  }, [allPatients, searchQuery, activeFilter])
  const totalPages = Math.max(1, Math.ceil(patients.length / 8))
  const currentPage = Math.min(page, totalPages)
  const visiblePatients = patients.slice((currentPage - 1) * 8, currentPage * 8)

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this patient?')) {
      return
    }

    try {
      setDeletingId(id)
      await axios.delete(buildApiUrl(`/api/patients/${id}`))
      removeCachedPatient(id)
      const updatedAllPatients = allPatients.filter(patient => patient.id !== id)
      setAllPatients(updatedAllPatients)
      showToast('Patient deleted successfully', 'success')
    } catch (error) {
      console.error('Error deleting patient:', error)
      showToast('Failed to delete patient', 'error')
    } finally {
      setDeletingId(null)
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

  const recentPatientsCount = allPatients.filter((patient) => {
    const createdDate = new Date(patient.created_at)
    const lastSevenDays = new Date()
    lastSevenDays.setDate(lastSevenDays.getDate() - 7)
    return createdDate >= lastSevenDays
  }).length

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ textAlign: 'center', padding: '40px' }}>
          Loading patients...
        </div>
      </div>
    )
  }

  return (
    <div className="patients-page">
      <div className="patients-hero-card">
        <h1 className="patients-hero-title">Patients</h1>
        <p className="patients-hero-description">
          Find a person, see their details, or start an eye test.
        </p>
        <div className="patients-hero-stats">
          <div className="patients-stat-card">
            <div className="patients-stat-icon">
              <Users size={18} />
            </div>
            <div>
              <span>Total Patients</span>
              <strong>{allPatients.length}</strong>
            </div>
          </div>
          <div className="patients-stat-card">
            <div className="patients-stat-icon">
              <CalendarDays size={18} />
            </div>
            <div>
              <span>Added This Week</span>
              <strong>{recentPatientsCount}</strong>
            </div>
          </div>
          <div className="patients-stat-card">
            <div className="patients-stat-icon">
              <Stethoscope size={18} />
            </div>
            <div>
              <span>Matching Your Search</span>
              <strong>{patients.length}</strong>
            </div>
          </div>
        </div>
      </div>

      {feedback && <div className="list-feedback" role="alert"><span>{feedback}</span><button type="button" onClick={fetchPatients}>Try again</button></div>}
      <div className="patients-workspace-card">
        <div className="patients-action-bar">
          <div className="filter-tabs">
            <button 
              className={`filter-tab ${activeFilter === 'recent' ? 'active' : ''}`}
              onClick={() => setActiveFilter('recent')}
            >
              Recent
            </button>
            <button 
              className={`filter-tab ${activeFilter === 'last3weeks' ? 'active' : ''}`}
              onClick={() => setActiveFilter('last3weeks')}
            >
              Last 3 weeks
            </button>
            <button 
              className={`filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              All
            </button>
          </div>

          <div className="search-container">
            <div className="search-icon">
              <Search size={18} />
            </div>
            <input
              type="text"
              name="patient-search"
              className="search-input"
              placeholder="Search by patient name or mobile number"
              aria-label="Search patients by name or phone number"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

            <button 
              className="add-patient-btn"
              onClick={() => navigate('/patients/new')}
            >
              <UserPlus size={18} />
              <span>Add a patient</span>
            </button>
        </div>

        {patients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Users size={24} />
            </div>
            <h3 className="empty-state-title">{allPatients.length ? 'No matching people' : 'Your first patient starts here'}</h3>
            <p className="empty-state-description">{allPatients.length ? 'Try another name, phone number, or choose All.' : 'Add a name and a few details. Then you’re ready to start an eye test.'}</p>
            <button 
              className="empty-state-btn"
              onClick={() => navigate('/patients/new')}
            >
              + Add a patient
            </button>
          </div>
        ) : (
          <>
            <div className="patients-table">
              <div className="table-header">
                <div className="header-cell">Patient Name</div>
                <div className="header-cell">Age / Sex</div>
                <div className="header-cell">Mobile Number</div>
                <div className="header-cell">Action</div>
              </div>
              {visiblePatients.map(patient => (
                <div key={patient.id} className="table-row">
                  <div className="table-cell">
                    <div className="patient-identity">
                      <PatientAvatar
                        style={patient.avatar_style}
                        label={patient.full_name}
                        size="sm"
                        className="patient-avatar-badge"
                        decorative
                      />
                      <div>
                        <div className="patient-name">{patient.full_name}</div>
                        <div className="patient-meta-text">Patient ID #{patient.id}</div>
                      </div>
                    </div>
                  </div>
                  <div className="table-cell">
                    <div className="patient-age-sex">{patient.age} / {patient.gender}</div>
                  </div>
                  <div className="table-cell">
                    <div className="patient-mobile">{patient.mobile}</div>
                  </div>
                  <div className="table-cell">
                    <div className="patient-actions">
                      <button className="action-link" onClick={() => navigate(`/patients/${patient.id}`)}>
                        <span>See details</span>
                        <ChevronRight size={15} />
                      </button>
                      <button className="action-link" onClick={() => navigate(`/test/${patient.id}`)}>
                        <span>Start a test</span>
                        <ChevronRight size={15} />
                      </button>
                      <button className="delete-icon" aria-label={`Delete ${patient.full_name}`} disabled={deletingId === patient.id} onClick={() => handleDelete(patient.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="list-pagination">
              <span>{patients.length} people · Page {currentPage} of {totalPages}</span>
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>Next</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default PatientsList
import '../styles/dashboard.css'

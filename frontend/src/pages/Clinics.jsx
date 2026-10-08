// Clinics management page with local persistence, search, and add/edit modal flows.
import React, { useEffect, useMemo, useState } from 'react'
import { Eye, Pencil, Plus, Search, X, ChevronRight } from 'lucide-react'
import { getCachedClinics, setCachedClinics } from '../utils/clinicCache'
import useDialogFocus from '../hooks/useDialogFocus'

const PAGE_SIZE = 8
const EMPTY_CLINIC_FORM = { name: '', address: '' }

const DEFAULT_CLINICS = [
  {
    id: 1,
    name: 'Main Eye Care Center',
    address: 'Clinical Services Wing, Main City Campus',
    created_at: '2026-03-10T00:00:00.000Z',
    updated_at: '2026-03-10T00:00:00.000Z'
  }
]

const Clinics = () => {
  const [clinics, setClinics] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState('add')
  const [activeClinic, setActiveClinic] = useState(null)
  const [clinicForm, setClinicForm] = useState(EMPTY_CLINIC_FORM)
  const [formError, setFormError] = useState('')
  useDialogFocus(isModalOpen, '.clinics-modal', () => setIsModalOpen(false))

  useEffect(() => {
    const cachedClinics = getCachedClinics(DEFAULT_CLINICS)
    setClinics(cachedClinics)
    setCachedClinics(cachedClinics)
  }, [])

  // Keep filtering derived so add/edit actions only need to update the base clinic list once.
  const filteredClinics = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) {
      return clinics
    }

    return clinics.filter((clinic) => {
      return [clinic.name, clinic.address].some((value) => value.toLowerCase().includes(query))
    })
  }, [clinics, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredClinics.length / PAGE_SIZE))

  const paginatedClinics = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return filteredClinics.slice(startIndex, startIndex + PAGE_SIZE)
  }, [currentPage, filteredClinics])

  const summaryItems = [
    { label: 'Total Clinics', value: clinics.length },
    { label: 'Visible Results', value: filteredClinics.length },
    { label: 'This Page', value: paginatedClinics.length }
  ]

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const openAddModal = () => {
    setModalMode('add')
    setActiveClinic(null)
    setClinicForm(EMPTY_CLINIC_FORM)
    setFormError('')
    setIsModalOpen(true)
  }

  const openEditModal = (clinic) => {
    setModalMode('edit')
    setActiveClinic(clinic)
    setClinicForm({
      name: clinic.name,
      address: clinic.address
    })
    setFormError('')
    setIsModalOpen(true)
  }

  const openViewModal = (clinic) => {
    setModalMode('view')
    setActiveClinic(clinic)
    setClinicForm({
      name: clinic.name,
      address: clinic.address
    })
    setFormError('')
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setFormError('')
  }

  const handleFormChange = (field) => (event) => {
    setClinicForm((currentForm) => ({
      ...currentForm,
      [field]: event.target.value
    }))
  }

  const handleSaveClinic = () => {
    const trimmedName = clinicForm.name.trim()
    const trimmedAddress = clinicForm.address.trim()

    if (!trimmedName || !trimmedAddress) {
      setFormError('Clinic name and address are required.')
      return
    }

    const nowIso = new Date().toISOString()
    let nextClinics

    if (modalMode === 'edit' && activeClinic) {
      nextClinics = clinics.map((clinic) => (
        clinic.id === activeClinic.id
          ? {
              ...clinic,
              name: trimmedName,
              address: trimmedAddress,
              updated_at: nowIso
            }
          : clinic
      ))
    } else {
      nextClinics = [
        {
          id: Date.now(),
          name: trimmedName,
          address: trimmedAddress,
          created_at: nowIso,
          updated_at: nowIso
        },
        ...clinics
      ]
    }

    const persistedClinics = setCachedClinics(nextClinics)
    setClinics(persistedClinics)
    closeModal()
  }

  return (
    <div className="page-container clinics-dashboard">
      <div className="dashboard-summary-card">
        <span className="dashboard-hero-kicker">Practice Operations</span>
        <h1 className="dashboard-summary-title">Clinics</h1>
        <p className="dashboard-hero-description">
          Maintain clinic locations and operational details used across your ophthalmic workflow.
        </p>
        <div className="dashboard-hero-stats">
          {summaryItems.map((item) => (
            <div key={item.label} className="dashboard-stat-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="clinics-workspace-card">
        <div className="clinics-toolbar">
          <div className="clinics-search">
            <Search size={20} className="clinics-search-icon" />
            <input
              type="text"
              name="clinic-search"
              className="clinics-search-input"
              placeholder="Search by clinic name or address"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setCurrentPage(1)
              }}
            />
          </div>
          <button type="button" className="clinics-add-button" onClick={openAddModal}>
            <Plus size={20} />
            <span>Add Clinic Location</span>
          </button>
        </div>

        <div className="reports-table clinics-table">
          <div className="reports-row reports-header clinics-row clinics-row-header">
            <div className="clinics-header-name clinics-cell-name">Name</div>
            <div className="clinics-header-address clinics-cell-address">Address</div>
            <div className="clinics-header-actions clinics-actions">Actions</div>
          </div>

          {paginatedClinics.length === 0 ? (
            <div className="reports-empty-state clinics-empty-state">No clinic locations match the current search.</div>
          ) : (
            paginatedClinics.map((clinic) => (
              <div key={clinic.id} className="reports-row clinics-row">
                <div className="clinics-cell-name">{clinic.name}</div>
                <div className="clinics-cell-address">{clinic.address}</div>
                <div className="clinics-actions">
                  <button
                    type="button"
                    className="clinics-icon-button"
                    aria-label={`Edit ${clinic.name}`}
                    onClick={() => openEditModal(clinic)}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    className="clinics-icon-button"
                    aria-label={`View ${clinic.name}`}
                    onClick={() => openViewModal(clinic)}
                  >
                    <Eye size={18} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="clinics-pagination">
        <button
          type="button"
          className="tests-page-arrow"
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          <ChevronRight size={22} />
        </button>
        <span className="tests-page-label">Page {currentPage} Of {totalPages}</span>
        <button
          type="button"
          className="tests-page-arrow tests-page-arrow-next"
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {isModalOpen && (
        <div className="clinics-modal-backdrop" onClick={closeModal}>
          <div className="clinics-modal" role="dialog" aria-modal="true" aria-labelledby="clinic-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="clinics-modal-header">
              <h2 id="clinic-dialog-title" className="clinics-modal-title">
                {modalMode === 'add' ? 'Add Clinic' : modalMode === 'edit' ? 'Edit Clinic' : 'Clinic Details'}
              </h2>
              <button type="button" className="clinics-modal-close" onClick={closeModal} aria-label="Close clinic dialog">
                <X size={18} />
              </button>
            </div>

            {modalMode === 'view' ? (
              <div className="clinics-view-card">
                <div className="clinics-view-row">
                  <span className="clinics-view-label">Name:</span>
                  <span className="clinics-view-value">{clinicForm.name}</span>
                </div>
                <div className="clinics-view-row">
                  <span className="clinics-view-label">Address:</span>
                  <span className="clinics-view-value">{clinicForm.address}</span>
                </div>
              </div>
            ) : (
              <div className="clinics-form">
                <div className="form-group">
                  <label className="form-label" htmlFor="clinic-name">Clinic Name</label>
                  <input
                    id="clinic-name"
                    className="form-input"
                    value={clinicForm.name}
                    onChange={handleFormChange('name')}
                    placeholder="Enter clinic name"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="clinic-address">Address</label>
                  <textarea
                    id="clinic-address"
                    className="form-input clinics-form-textarea"
                    value={clinicForm.address}
                    onChange={handleFormChange('address')}
                    placeholder="Enter clinic address"
                  />
                </div>

                {formError && <div className="clinics-form-error" role="alert">{formError}</div>}
              </div>
            )}

            <div className="clinics-modal-actions">
              <button type="button" className="btn btn-outline" onClick={closeModal}>
                {modalMode === 'view' ? 'Close' : 'Cancel'}
              </button>
              {modalMode !== 'view' && (
                <button type="button" className="btn btn-primary" onClick={handleSaveClinic}>
                  {modalMode === 'edit' ? 'Save Changes' : 'Add Clinic'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Clinics
import '../styles/dashboard.css'

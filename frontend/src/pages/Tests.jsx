// Patient-specific report history page with client-side search, pagination, and type labeling.
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { CheckCircle2, ChevronDown, ChevronRight, Download, Eye, Plus, Search } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAuthUser } from '../utils/auth'
import { buildApiUrl } from '../utils/api'
import { downloadGuestSampleReport } from '../features/demo/reports'
import { LoadingSkeleton } from '../components/LoadingState'
import { prefetchRoute } from '../utils/performance'
import '../styles/reports.css'

const PAGE_SIZE = 6
const DEFAULT_TEST_TYPE = 'Meibography'
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric'
})
const TEST_TYPE_KEYWORDS = [
  'Meibography',
  'Tear Meniscus',
  'Blink Rate Evaluation',
  'Bulbar Redness Analysis',
  'DEQ',
  'OSDI',
  'Contrast Sensitivity',
  'Posterior Segment'
]

// Normalize server timestamps into the dd-mm-yyyy format used across the dashboard cards.
const formatDateLabel = (value) => {
  if (!value) {
    return 'N/A'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'N/A'
  }

  return dateFormatter.format(date).replace(/\//g, '-')
}

const extractTestTypes = (assessment) => {
  if (Array.isArray(assessment?.completed_tests) && assessment.completed_tests.length > 0) {
    return assessment.completed_tests
  }

  const analysisText = `${assessment?.left_analysis || ''} ${assessment?.right_analysis || ''}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  const matchedTypes = TEST_TYPE_KEYWORDS.filter((item) => {
    if (item === 'Posterior Segment') {
      return analysisText.includes('posterior segment')
        && !/^posterior segment:\s*normal$/.test(analysisText)
        && !/\bposterior segment:\s*normal\b/.test(analysisText)
    }

    return analysisText.includes(item.toLowerCase())
  })
  return matchedTypes.length > 0 ? matchedTypes : [DEFAULT_TEST_TYPE]
}

const Tests = () => {
  const { id: patientId } = useParams()
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTestType, setSelectedTestType] = useState('all')
  const [downloadingId, setDownloadingId] = useState(null)
  const [downloadError, setDownloadError] = useState('')
  const [expandedReportId, setExpandedReportId] = useState(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const doctorName = getAuthUser()

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setDownloadError('')
    setExpandedReportId(null)
    const fetchReports = async () => {
      try {
        const response = await axios.get(buildApiUrl('/api/results'), {
          signal: controller.signal,
          params: {
            kind: 'report',
            ...(patientId ? { patient_id: patientId } : {})
          }
        })
        if (!controller.signal.aborted) setReports(Array.isArray(response.data) ? response.data : [])
      } catch (fetchError) {
        if (controller.signal.aborted || axios.isCancel(fetchError)) return
        console.error('Error fetching reports:', fetchError)
        setError('Failed to load saved reports.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    fetchReports()
    // Rapid navigation cannot replace the next patient's reports with an old response.
    return () => controller.abort()
  }, [patientId, reloadVersion])

  useEffect(() => {
    setReports([])
    setSelectedTestType('all')
  }, [patientId])

  const normalizedReports = useMemo(() => {
    return reports.map((report) => {
      const testTypes = extractTestTypes(report)
      return {
        ...report,
        dateLabel: formatDateLabel(report.created_at),
        patientName: report.patient?.full_name || `Patient #${report.patient_id}`,
        testTypes,
        testTypeLabel: testTypes.join(', '),
        doctorName: report.patient?.doctor_name || doctorName,
        statusLabel: 'Report Ready',
        reportDownloadUrl: report.download_url ? buildApiUrl(report.download_url) : ''
      }
    })
  }, [reports, doctorName])

  const availableTestTypes = useMemo(() => {
    const options = normalizedReports.flatMap((report) => report.testTypes)
    return [...new Set(options)]
  }, [normalizedReports])

  const filteredReports = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase()

    return normalizedReports.filter((report) => {
      const matchesType = selectedTestType === 'all' || report.testTypes.includes(selectedTestType)
      const matchesQuery = !query || [
        report.patientName,
        report.testTypeLabel,
        report.doctorName,
        report.statusLabel
      ].some((value) => value.toLowerCase().includes(query))

      return matchesType && matchesQuery
    })
  }, [normalizedReports, deferredSearchTerm, selectedTestType])

  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE))

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedTestType, patientId])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const paginatedReports = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE
    return filteredReports.slice(startIndex, startIndex + PAGE_SIZE)
  }, [currentPage, filteredReports])

  const summaryItems = [
    { label: 'Total Reports', value: normalizedReports.length },
    { label: 'Visible Reports', value: filteredReports.length },
    { label: 'Reports Ready', value: normalizedReports.length }
  ]

  const handleAddTest = () => {
    if (patientId) {
      navigate(`/test/${patientId}`)
      return
    }

    navigate('/patients')
  }

  const handleDownloadSample = async (report) => {
    setDownloadingId(report.id)
    setDownloadError('')
    try {
      await downloadGuestSampleReport(report)
    } catch {
      setDownloadError('The report could not be downloaded. Please try again.')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="page-container reports-dashboard">
      <div className="dashboard-summary-card">
        <span className="dashboard-hero-kicker">YOUR SAVED RESULTS</span>
        <h1 className="dashboard-summary-title">Your results, clearly.</h1>
        <p className="dashboard-hero-description">
          Find a person’s results, open their record, or download a saved report.
        </p>
        <div className="dashboard-hero-stats">
          {summaryItems.map((item) => (
            <div key={item.label} className="dashboard-stat-card">
              <span>{item.label}</span>
              <strong>{loading ? <span className="reports-count-placeholder" aria-label="Loading" /> : item.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="tests-workspace-card">
        <div className="tests-toolbar">
          <div className="tests-search">
            <Search size={20} className="tests-search-icon" />
            <input
              type="text"
              name="test-search"
              className="tests-search-input"
              placeholder="Search by patient name, test type, doctor, or status"
              aria-label="Search reports"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <div className="tests-toolbar-actions">
            <select
              name="test-type-filter"
              className="tests-filter"
              aria-label="Filter reports by test"
              value={selectedTestType}
              onChange={(event) => setSelectedTestType(event.target.value)}
            >
              <option value="all">All eye tests</option>
              {availableTestTypes.map((testType) => (
                <option key={testType} value={testType}>{testType}</option>
              ))}
            </select>
            <button type="button" className="tests-add-button" onClick={handleAddTest} onMouseEnter={() => prefetchRoute(patientId ? `/test/${patientId}` : '/patients')} onFocus={() => prefetchRoute(patientId ? `/test/${patientId}` : '/patients')}>
              <Plus size={20} />
              <span>Start a test</span>
            </button>
          </div>
        </div>

        {downloadError && <p className="reports-download-error" role="alert">{downloadError}</p>}
        <div className="reports-table tests-table" aria-busy={loading}>
          <div className="reports-row reports-header tests-row tests-row-header">
            <div className="tests-header-date tests-cell-date">Date</div>
            <div className="tests-header-patient tests-cell-patient">Patient</div>
            <div className="tests-header-type tests-cell-type">Test</div>
            <div className="tests-header-doctor tests-cell-doctor">Doctor</div>
            <div className="tests-header-action">Action</div>
          </div>

          {loading ? (
            <LoadingSkeleton rows={4} />
          ) : error ? (
            <div className="reports-empty-state tests-empty-state" role="alert">{error} <button type="button" className="secondary-action" onClick={() => setReloadVersion((version) => version + 1)}>Try again</button></div>
          ) : filteredReports.length === 0 ? (
            <div className="reports-empty-state tests-empty-state">{normalizedReports.length ? 'No reports match your search. Try another name or choose all eye tests.' : 'No reports yet. Choose a patient, complete a test, then save a report.'}</div>
          ) : (
            paginatedReports.map((report) => (
              <React.Fragment key={report.id}>
              <div className={`reports-row tests-row${expandedReportId === report.id ? ' reports-row-expanded' : ''}`}>
                <div className="tests-cell-date">{report.dateLabel}</div>
                <div className="reports-patient-name tests-cell-patient">{report.patientName}</div>
                <div className="tests-cell-type"><span>{report.testTypeLabel}</span><span className="report-ready-label"><CheckCircle2 size={12} aria-hidden="true" /> Ready to view</span></div>
                <div className="tests-cell-doctor">{report.doctorName}</div>
                <div className="reports-actions tests-actions">
                  <button
                    type="button"
                    className="tests-action-button"
                    onClick={() => setExpandedReportId((current) => current === report.id ? null : report.id)}
                    aria-expanded={expandedReportId === report.id}
                    aria-controls={`report-details-${report.id}`}
                  >
                    <Eye size={15} aria-hidden="true" />
                    <span>View results</span>
                    <ChevronDown size={15} className={expandedReportId === report.id ? 'reports-chevron-open' : ''} aria-hidden="true" />
                  </button>
                  {(report.demo_sample || report.guest_session) && !report.reportDownloadUrl ? <button type="button" className="tests-action-button" disabled={downloadingId === report.id} onClick={() => handleDownloadSample(report)}><Download size={15} aria-hidden="true" /><span>{downloadingId === report.id ? 'Preparing…' : report.demo_sample ? 'Sample PDF' : 'Download PDF'}</span></button> : report.reportDownloadUrl ? <a
                    href={report.reportDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="tests-action-button tests-action-link"
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>PDF</span>
                  </a> : <span className="tests-action-button">No PDF saved</span>}
                </div>
              </div>
              {expandedReportId === report.id && (
                <section id={`report-details-${report.id}`} className="report-result-detail" aria-label={`Results for ${report.patientName}`}>
                  <div className="report-detail-heading">
                    <div><span className="report-detail-eyebrow">ASSESSMENT SUMMARY</span><h2>{report.patientName}</h2></div>
                    <button type="button" className="tests-action-button" onClick={() => navigate(`/patients/${report.patient_id}`)} onMouseEnter={() => prefetchRoute(`/patients/${report.patient_id}`)} onFocus={() => prefetchRoute(`/patients/${report.patient_id}`)}>Patient details<ChevronRight size={15} aria-hidden="true" /></button>
                  </div>
                  <div className="report-result-columns">
                    <div><h3>Left eye / assessment</h3><p>{report.left_analysis || 'No left eye findings saved in this report.'}</p></div>
                    <div><h3>Right eye / notes</h3><p>{report.right_analysis || 'No right eye findings saved in this report.'}</p></div>
                  </div>
                  {(report.demo_sample || report.guest_session) && <p className="report-demo-caption">{report.demo_sample ? 'Fictional example report. Use this sample to explore the results workspace.' : 'Your guest results are saved in this tab. Download a PDF to keep a copy.'}</p>}
                </section>
              )}
              </React.Fragment>
            ))
          )}
        </div>
      </div>

      {!loading && !error && filteredReports.length > 0 && (
        <div className="tests-pagination">
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
      )}
    </div>
  )
}

export default Tests
import '../styles/dashboard.css'

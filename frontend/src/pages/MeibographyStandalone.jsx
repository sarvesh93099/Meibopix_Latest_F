// Main exam workspace that coordinates capture, analysis, review, reporting, and auxiliary tests.
import React, { Suspense, lazy, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, Bell, Camera, Check, ChevronLeft, Contrast, Eye, FileText, PencilLine, RotateCcw, Save, Settings, Sun, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import axios from 'axios'
import '../styles/dashboard.css'
import '../styles/clinical.css'
import '../styles/assessment.css'
import '../styles/exam-layout.css'
import '../styles/exam-polish.css'
import SampleImagesGallery from '../features/meibography/SampleImagesGallery'
import { createAnalysisRequestCache } from '../features/meibography/analysisCache'
import OcularAnalysisPanel from '../components/OcularAnalysisPanel'
import BlinkSessionSegmentedControl from '../components/BlinkSessionSegmentedControl'
import LoadingState from '../components/LoadingState'
import { buildLocalBlinkResult, createBlinkTrackingState, updateBlinkTracking } from '../features/blink/blinkDetection'
import { TEST_CATALOG } from '../features/tests/catalog'
import useDialogFocus from '../hooks/useDialogFocus'
import TearMeasureSegmentedControl from '../components/TearMeasureSegmentedControl'
import SegmentedActionControl from '../components/SegmentedActionControl'
import eyeLogo from '../assets/eye-logo.svg'
import { getAuthUser, isGuestSession } from '../utils/auth'
import { getCachedPatients, setCachedPatients } from '../utils/patientCache'
import { API_BASE_URL as RESOLVED_API_BASE_URL, buildApiUrl } from '../utils/api'
import {
  ADDITIONAL_TEST_SECTIONS,
  AUTO_ENHANCE_DELAY_MS,
  BLINK_LIVE_ANALYSIS_INTERVAL_MS,
  BLINK_LIVE_CAPTURE_WIDTH,
  BLINK_RECORDING_DURATION_SECONDS,
  BULBAR_REDNESS_OPTIONS,
  CAMERA_SESSION_SECTIONS,
  DEQ_RESPONSE_COUNT,
  MAX_TEAR_REVIEW_ZOOM,
  MIN_TEAR_REVIEW_ZOOM,
  OSDI_RESPONSE_COUNT,
  TEAR_POINT_HIT_RADIUS,
  TEAR_REVIEW_ZOOM_STEP,
  TEST_SECTION_LABELS,
  buildMeibographyAnalysisDetail,
  blobToDataUrl,
  clampReportValue,
  createImageState,
  createInitialContrastState,
  createInitialMeibographyWorkflowState,
  createInitialPosteriorSegmentState,
  createLocalBlinkLandmarker,
  enhanceImageDataUrlInBrowser,
  extractBlinkFrameResultFromLocalLandmarker,
  formatLidLabel,
  getBulbarRednessLabel,
  getAnnotationLabelPosition,
  getImageKey,
  getLidMismatchPrompt,
  INITIAL_IMAGES,
  imageReducer,
  loadJsPdfModule,
  summarizeContrastSensitivity,
  summarizeDeqResponses,
  summarizeOsdiResponses,
  summarizePosteriorSegment,
} from '../features/meibography'

const API_BASE_URL = RESOLVED_API_BASE_URL
const AdditionalTestsPanel = lazy(() => import('../components/AdditionalTestsPanel'))
const BlinkCounterPanel = lazy(() => import('../components/BlinkCounterPanel'))

const PanelFallback = () => <div className="meibography-content"><LoadingState compact title="Preparing your test" detail="Loading the tools for this step." /></div>


const MeibographyStandalone = () => {
  const { patientId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedPatient, setSelectedPatient] = useState('')
  const [patients, setPatients] = useState([])
  const [currentEye, setCurrentEye] = useState('left')
  const [currentLid, setCurrentLid] = useState(searchParams.get('section') === 'tear-meniscus' ? 'lower' : 'upper')
  const [activeTestSection, setActiveTestSection] = useState(() => TEST_CATALOG.some(test => test.id === searchParams.get('section')) ? searchParams.get('section') : 'meibography')
  const [brightness, setBrightness] = useState(50)
  const [contrast, setContrast] = useState(50)
  const [isAnnotateMode, setIsAnnotateMode] = useState(false)
  const [annotationPoints, setAnnotationPoints] = useState([])
  const [isAnnotationClosed, setIsAnnotationClosed] = useState(false)
  const [isStartingCamera, setIsStartingCamera] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [isServerCameraMode, setIsServerCameraMode] = useState(false)
  const [serverCameraStreamNonce, setServerCameraStreamNonce] = useState(0)
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [blinkSessionActionMode, setBlinkSessionActionMode] = useState('start')
  const [captureActionMode, setCaptureActionMode] = useState('capture')
  const [tearMeasureActionMode, setTearMeasureActionMode] = useState('measure')
  const [reviewActionMode, setReviewActionMode] = useState('analyze')
  const [imageState, dispatchImage] = useReducer(imageReducer, createImageState())
  const [isSavingReport, setIsSavingReport] = useState(false)
  const [assessmentId, setAssessmentId] = useState(null)
  const [assessmentStatus, setAssessmentStatus] = useState('draft')
  const [reviewSnapshot, setReviewSnapshot] = useState(null)
  const [loadedSample, setLoadedSample] = useState(null)
  const [cameraError, setCameraError] = useState('')
  const [isManualImageProcessing, setIsManualImageProcessing] = useState(false)
  const [pendingUploadContext, setPendingUploadContext] = useState(null)
  const [meibographyResults, setMeibographyResults] = useState({})
  const [tearMeasurements, setTearMeasurements] = useState({ left: null, right: null })
  const [tearMeasurementDraftPoints, setTearMeasurementDraftPoints] = useState([])
  const [isTearMeasureMode, setIsTearMeasureMode] = useState(false)
  const [isMeasuringTearMeniscus, setIsMeasuringTearMeniscus] = useState(false)
  const [blinkVideoFile, setBlinkVideoFile] = useState(null)
  const [blinkCounterResult, setBlinkCounterResult] = useState(null)
  const [isAnalyzingBlinkCounter, setIsAnalyzingBlinkCounter] = useState(false)
  const [blinkVideoProgress, setBlinkVideoProgress] = useState(null)
  const [isRecordingBlinkCounter, setIsRecordingBlinkCounter] = useState(false)
  const [blinkRecordingSecondsLeft, setBlinkRecordingSecondsLeft] = useState(BLINK_RECORDING_DURATION_SECONDS)
  const [liveBlinkMetrics, setLiveBlinkMetrics] = useState({
    totalBlinks: 0,
    bpmOverall: 0,
    faceFound: false
  })
  const [deqResponses, setDeqResponses] = useState(Array(DEQ_RESPONSE_COUNT).fill(0))
  const [osdiResponses, setOsdiResponses] = useState(Array(OSDI_RESPONSE_COUNT).fill('0'))
  const [osdiDuration, setOsdiDuration] = useState('')
  const [osdiComments, setOsdiComments] = useState('')
  const [selectedBulbarRednessId, setSelectedBulbarRednessId] = useState('')
  const [contrastSensitivity, setContrastSensitivity] = useState(createInitialContrastState())
  const [posteriorSegment, setPosteriorSegment] = useState(createInitialPosteriorSegmentState())
  const [isAnalyzingMeibography, setIsAnalyzingMeibography] = useState(false)
  const [meibographyWorkflow, setMeibographyWorkflow] = useState(createInitialMeibographyWorkflowState())
  const [analysisPreviewModal, setAnalysisPreviewModal] = useState(null)
  useDialogFocus(Boolean(analysisPreviewModal), '.meibography-analysis-modal-dialog', () => setAnalysisPreviewModal(null))
  const [tearReviewZoom, setTearReviewZoom] = useState(MIN_TEAR_REVIEW_ZOOM)
  const [tearReviewPan, setTearReviewPan] = useState({ x: 0, y: 0 })
  const [tearMeasureHoverPoint, setTearMeasureHoverPoint] = useState(null)
  const clinicalResults = useMemo(() => ({
    deq: summarizeDeqResponses(deqResponses),
    osdi: summarizeOsdiResponses(osdiResponses, osdiDuration, osdiComments),
    contrast: summarizeContrastSensitivity(contrastSensitivity),
    posterior: summarizePosteriorSegment(posteriorSegment)
  }), [deqResponses, osdiResponses, osdiDuration, osdiComments, contrastSensitivity, posteriorSegment])

  const videoRef = useRef(null)
  const backendBlinkStreamImageRef = useRef(null)
  const reviewImageRef = useRef(null)
  const annotationLayerRef = useRef(null)
  const streamRef = useRef(null)
  const toastTimeoutRef = useRef(null)
  const isMountedRef = useRef(false)
  const cameraRequestRef = useRef(0)
  const activeTestSectionRef = useRef(activeTestSection)
  const manualImageInputRef = useRef(null)
  const pendingUploadContextRef = useRef(null)
  const autoEnhanceTimeoutRef = useRef(null)
  const autoEnhanceRequestTokenRef = useRef(0)
  const autoEnhanceControllerRef = useRef(null)
  const analysisControllerRef = useRef(null)
  const analysisRequestCacheRef = useRef(null)
  if (!analysisRequestCacheRef.current) analysisRequestCacheRef.current = createAnalysisRequestCache()
  const meibographyPlaybackTimeoutsRef = useRef([])
  const meibographyPlaybackTokenRef = useRef(0)
  const blinkRecorderRef = useRef(null)
  const blinkRecordingTimerRef = useRef(null)
  const blinkRecordingStopTimeoutRef = useRef(null)
  const blinkRecordingStartedAtRef = useRef(0)
  const blinkRecordingEndsAtRef = useRef(0)
  const blinkRecordingDurationRef = useRef(BLINK_RECORDING_DURATION_SECONDS)
  const blinkLiveAnalysisIntervalRef = useRef(null)
  const blinkLiveLoopTokenRef = useRef(0)
  const isRecordingBlinkCounterRef = useRef(false)
  const localBlinkLandmarkerRef = useRef(null)
  const localBlinkLandmarkerInitPromiseRef = useRef(null)
  const meibographyModelWarmupPromiseRef = useRef(null)
  const isMeibographyModelReadyRef = useRef(false)
  const blinkTrackingStateRef = useRef(createBlinkTrackingState())
  const blinkSessionGenerationRef = useRef(0)
  const blinkVideoAnalysisAbortRef = useRef(null)
  const blinkRecorderCleanupRef = useRef(null)
  const blinkLastUiUpdateRef = useRef(0)
  const blinkLastUiCountRef = useRef(0)
  const blinkLastUiFaceRef = useRef(false)
  const blinkLivePendingRequestRef = useRef(false)
  const blinkLiveErrorShownRef = useRef(false)
  const assessmentAutosaveTimeoutRef = useRef(null)
  const lastSyncedAssessmentFingerprintRef = useRef('')
  const submittedTestSectionsRef = useRef(new Set())
  const isSavingAssessmentRef = useRef(false)
  const tearInteractionRef = useRef({
    mode: null,
    pointIndex: null,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
    hasMoved: false,
    latestPoints: null,
    suppressClick: false
  })
  const images = imageState.images

  useEffect(() => {
    fetchPatients()
    fetchCameraSettings()
  }, [])

  useEffect(() => {
    if (patientId) {
      setSelectedPatient(patientId)
    }
  }, [patientId])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      blinkVideoAnalysisAbortRef.current?.abort()
      autoEnhanceControllerRef.current?.abort()
      analysisControllerRef.current?.abort()
      analysisRequestCacheRef.current.clear()
      stopCameraStream(true)
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!videoRef.current || !streamRef.current) {
      return
    }

    if (videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current
    }

    videoRef.current.play?.().catch(() => {})
  }, [activeTestSection, cameraReady])

  useEffect(() => {
    isRecordingBlinkCounterRef.current = isRecordingBlinkCounter
  }, [isRecordingBlinkCounter])

  useEffect(() => {
    activeTestSectionRef.current = activeTestSection
    if (activeTestSection !== 'blink-rate') blinkVideoAnalysisAbortRef.current?.abort()
  }, [activeTestSection])

  useEffect(() => {
    if (!CAMERA_SESSION_SECTIONS.includes(activeTestSection)) {
      stopCameraStream(true)
    }
  }, [activeTestSection])



  useEffect(() => {
    setTearMeasurementDraftPoints([])
    setIsTearMeasureMode(false)
    setTearMeasureHoverPoint(null)
  }, [currentEye])

  useEffect(() => {
    pendingUploadContextRef.current = pendingUploadContext
  }, [pendingUploadContext])

  useEffect(() => {
    setTearReviewZoom(MIN_TEAR_REVIEW_ZOOM)
    setTearReviewPan({ x: 0, y: 0 })
  }, [reviewSnapshot])

  useEffect(() => {
    if (activeTestSection !== 'tear-meniscus') {
      return
    }

    setIsAnnotateMode(false)
    setAnnotationPoints([])
    setIsAnnotationClosed(false)
    setTearMeasureHoverPoint(null)
  }, [activeTestSection])

  useEffect(() => {
    if (activeTestSection !== 'tear-meniscus') {
      return
    }

    const originalTearImage = getPreferredTearMeniscusSourceImage(currentEye, 'lower')
    if (originalTearImage && reviewSnapshot !== originalTearImage) {
      setReviewSnapshot(originalTearImage)
    }
  }, [activeTestSection, currentEye, pendingUploadContext, meibographyResults, reviewSnapshot])

  useEffect(() => () => {
    if (assessmentAutosaveTimeoutRef.current) {
      clearTimeout(assessmentAutosaveTimeoutRef.current)
    }
    if (autoEnhanceTimeoutRef.current) {
      clearTimeout(autoEnhanceTimeoutRef.current)
    }
    meibographyPlaybackTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId))
    meibographyPlaybackTimeoutsRef.current = []
    meibographyPlaybackTokenRef.current += 1
    isRecordingBlinkCounterRef.current = false
    blinkLiveLoopTokenRef.current += 1
    blinkSessionGenerationRef.current += 1
    if (blinkRecordingTimerRef.current) {
      clearInterval(blinkRecordingTimerRef.current)
    }
    if (blinkRecordingStopTimeoutRef.current) {
      clearTimeout(blinkRecordingStopTimeoutRef.current)
    }
    if (blinkLiveAnalysisIntervalRef.current) {
      clearInterval(blinkLiveAnalysisIntervalRef.current)
    }
    if (blinkRecorderRef.current && blinkRecorderRef.current.state !== 'inactive') {
      blinkRecorderRef.current.onstop = null
      blinkRecorderRef.current.stop()
    }
    blinkRecorderCleanupRef.current?.()
    localBlinkLandmarkerRef.current?.close?.()
    localBlinkLandmarkerRef.current = null
  }, [])

  // Close settings dropdown when clicking outside or pressing Escape.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showSettings && !event.target.closest('.settings-inline-content')) {
        setShowSettings(false)
      }
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && showSettings) {
        setShowSettings(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showSettings])

  useEffect(() => {
    if (!reviewSnapshot) {
      setReviewActionMode('analyze')
      return
    }

    if (isAnnotateMode && reviewActionMode !== 'annotate') {
      setReviewActionMode('annotate')
      return
    }

    if (!isAnnotateMode && reviewActionMode === 'annotate') {
      setReviewActionMode('analyze')
    }
  }, [isAnnotateMode, reviewActionMode, reviewSnapshot])

  useEffect(() => {
    if (isRecordingBlinkCounter && blinkSessionActionMode !== 'start') {
      setBlinkSessionActionMode('start')
      return
    }

    if (isAnalyzingBlinkCounter && blinkSessionActionMode !== 'analyze') {
      setBlinkSessionActionMode('analyze')
    }
  }, [blinkSessionActionMode, isAnalyzingBlinkCounter, isRecordingBlinkCounter])

  useEffect(() => {
    if (!reviewSnapshot) {
      setTearMeasureActionMode('measure')
      return
    }

    if (isTearMeasureMode || isMeasuringTearMeniscus) {
      setTearMeasureActionMode('measure')
    }
  }, [isMeasuringTearMeniscus, isTearMeasureMode, reviewSnapshot])

  const fetchPatients = async () => {
    try {
      const response = await axios.get(buildApiUrl('/api/patients'))
      setPatients(response.data)
      setCachedPatients(response.data)
    } catch (error) {
      console.error('Error fetching patients:', error)
      const cachedPatients = getCachedPatients()
      if (cachedPatients.length > 0) {
        setPatients(cachedPatients)
        showToastMessage('Loaded saved patients from cache.')
      } else {
        showToastMessage('Unable to load patients.')
      }
    }
  }

  const fetchCameraSettings = async () => {
    try {
      const response = await axios.get(buildApiUrl('/api/camera/settings'))
      setBrightness(response.data.brightness)
      setContrast(response.data.contrast)
    } catch (error) {
      console.error('Error fetching camera settings:', error)
    }
  }

  const warmMeibographyModel = async () => {
    if (isMeibographyModelReadyRef.current) {
      return true
    }

    if (meibographyModelWarmupPromiseRef.current) {
      return meibographyModelWarmupPromiseRef.current
    }

    const requestPromise = axios.post(buildApiUrl('/api/model/warmup'), {}, { timeout: 10000 })
      .then((response) => {
        if (response?.data?.loaded || response?.data?.available) {
          isMeibographyModelReadyRef.current = true
        }
        return Boolean(response?.data?.loaded || response?.data?.available)
      })
      .catch((error) => {
        console.error('Error warming meibography model:', error)
        return false
      })
      .finally(() => {
        if (meibographyModelWarmupPromiseRef.current === requestPromise) {
          meibographyModelWarmupPromiseRef.current = null
        }
      })

    meibographyModelWarmupPromiseRef.current = requestPromise
    return requestPromise
  }

  const resetAssessmentWorkspace = () => {
    cancelPendingAutoEnhance()
    cancelMeibographyPlayback()
    analysisRequestCacheRef.current.clear()
    setIsAnalyzingMeibography(false)
    blinkVideoAnalysisAbortRef.current?.abort()
    dispatchImage({ type: 'REPLACE_ALL', images: INITIAL_IMAGES })
    setCurrentEye('left')
    setCurrentLid(activeTestSectionRef.current === 'tear-meniscus' ? 'lower' : 'upper')
    if (isRecordingBlinkCounterRef.current) handleClearBlinkCounter()
    setReviewSnapshot(null)
    setPendingUploadContext(null)
    setAnnotationPoints([])
    setIsAnnotationClosed(false)
    setIsAnnotateMode(false)
    setMeibographyResults({})
    setTearMeasurements({ left: null, right: null })
    setTearMeasurementDraftPoints([])
    setIsTearMeasureMode(false)
    setIsMeasuringTearMeniscus(false)
    setBlinkVideoFile(null)
    setBlinkCounterResult(null)
    setIsAnalyzingBlinkCounter(false)
    setIsRecordingBlinkCounter(false)
    setBlinkRecordingSecondsLeft(BLINK_RECORDING_DURATION_SECONDS)
    setLiveBlinkMetrics({
      totalBlinks: 0,
      bpmOverall: 0,
      faceFound: false
    })
    setDeqResponses(Array(DEQ_RESPONSE_COUNT).fill(0))
    setOsdiResponses(Array(OSDI_RESPONSE_COUNT).fill('0'))
    setOsdiDuration('')
    setOsdiComments('')
    setSelectedBulbarRednessId('')
    setContrastSensitivity(createInitialContrastState())
    setPosteriorSegment(createInitialPosteriorSegmentState())
    submittedTestSectionsRef.current.clear()
    setAnalysisPreviewModal(null)
    setTearReviewZoom(MIN_TEAR_REVIEW_ZOOM)
    setTearReviewPan({ x: 0, y: 0 })
    setTearMeasureHoverPoint(null)
    resetMeibographyWorkflow()
  }

  const normalizeContrastSensitivityState = (value = {}) => ({
    testName: value?.testName || 'Glaucoma',
    rows: {
      od_pre: { ...createInitialContrastState().rows.od_pre, ...(value?.rows?.od_pre || {}) },
      od_post: { ...createInitialContrastState().rows.od_post, ...(value?.rows?.od_post || {}) },
      os_pre: { ...createInitialContrastState().rows.os_pre, ...(value?.rows?.os_pre || {}) },
      os_post: { ...createInitialContrastState().rows.os_post, ...(value?.rows?.os_post || {}) }
    }
  })

  const normalizePosteriorSegmentState = (value = {}) => ({
    left: {
      ...createInitialPosteriorSegmentState().left,
      ...(value?.left || {})
    },
    right: {
      ...createInitialPosteriorSegmentState().right,
      ...(value?.right || {})
    }
  })

  const buildPersistedAnalysisText = (eye) => {
    const deqSummary = clinicalResults.deq || summarizeDeqResponses(deqResponses)
    const osdiSummary = clinicalResults.osdi || summarizeOsdiResponses(osdiResponses, osdiDuration, osdiComments)
    const contrastSummary = clinicalResults.contrast || summarizeContrastSensitivity(contrastSensitivity)
    const posteriorSummary = clinicalResults.posterior || summarizePosteriorSegment(posteriorSegment)
    const meibographyLines = ['upper', 'lower'].map((lid) => {
      const result = meibographyResults[getImageKey(eye, lid)]
      if (!result) {
        return ''
      }
      return `Meibography ${formatLidLabel(lid)}: Coverage ${Number(result.coveragePct || 0).toFixed(1)}%, Dropout ${Number(result.dropoutPct || 0).toFixed(1)}%, ${result.grade}`
    }).filter(Boolean)
    const tearMeasurement = tearMeasurements[eye]
    const tearLine = tearMeasurement?.tmhMm
      ? `Tear meniscus: ${Number(tearMeasurement.tmhMm).toFixed(2)} mm (${tearMeasurement.statusLabel || 'Measured'})`
      : ''
    const blinkLine = blinkCounterResult?.bpmOverall != null && blinkCounterResult?.quality !== false
      ? `Blink rate: ${Number(blinkCounterResult.bpmOverall).toFixed(1)} blinks/min | Total blinks: ${Number(blinkCounterResult.totalBlinks || 0)} (${blinkCounterResult.sessionMode === 'manual' ? 'manual count' : 'camera count'})`
      : ''
    const bulbarLine = selectedBulbarRednessId
      ? `Bulbar Redness: ${getBulbarRednessLabel(selectedBulbarRednessId)}`
      : ''
    const contrastPrefix = eye === 'left' ? 'os' : 'od'
    const contrastPre = contrastSummary.rows?.[`${contrastPrefix}_pre`]?.aulcsf
    const contrastPost = contrastSummary.rows?.[`${contrastPrefix}_post`]?.aulcsf
    const hasContrastValue = contrastPre !== null && contrastPre !== undefined
      || contrastPost !== null && contrastPost !== undefined
    const contrastLine = hasContrastValue
      ? `Contrast Sensitivity: pre ${contrastPre ?? 'N/A'}, post ${contrastPost ?? 'N/A'}`
      : ''
    const posteriorValues = posteriorSummary[eye]
    const hasPosteriorData = Boolean(
      String(posteriorValues?.report || '').trim() ||
      String(posteriorValues?.recommendation || '').trim() ||
      String(posteriorValues?.impression || 'Normal').trim() !== 'Normal'
    )
    const posteriorLine = (hasPosteriorData || submittedTestSectionsRef.current.has('posterior-segment')) && posteriorValues?.summary
      ? `Posterior Segment: ${posteriorValues.summary}`
      : ''
    const deqLine = (deqSummary.total_score > 0 || submittedTestSectionsRef.current.has('deq')) ? `DEQ: ${deqSummary.total_score} (${deqSummary.interpretation})` : ''
    const osdiLine = (osdiSummary.osdi_score > 0 || submittedTestSectionsRef.current.has('osdi')) ? `OSDI: ${osdiSummary.osdi_score} (${osdiSummary.interpretation})` : ''
    return [
      ...meibographyLines,
      tearLine,
      blinkLine,
      bulbarLine,
      contrastLine,
      posteriorLine,
      deqLine,
      osdiLine
    ].filter(Boolean).join('\n')
  }

  const buildAssessmentSessionData = () => ({
    images,
    meibographyResults,
    tearMeasurements,
    blinkCounterResult,
    deqResponses,
    osdiResponses,
    osdiDuration,
    osdiComments,
    bulbarRedness: {
      selectedId: selectedBulbarRednessId,
      selectedLabel: getBulbarRednessLabel(selectedBulbarRednessId)
    },
    contrastSensitivity,
    posteriorSegment,
    clinicalResults,
    submittedTestSections: [...submittedTestSectionsRef.current],
    currentEye,
    currentLid,
    activeTestSection
  })

  const buildCompletedTests = (sessionData = buildAssessmentSessionData()) => {
    const nextTests = []
    const hasAnyMeibographyResult = Object.values(sessionData.meibographyResults || {}).some(Boolean)
    const hasAnyTearMeasurement = ['left', 'right'].some((eye) => {
      const measurement = sessionData.tearMeasurements?.[eye]
      return Boolean(measurement?.tmhMm || measurement?.summary || measurement?.annotatedImage)
    })
    const hasBlinkResult = Boolean(
      sessionData.blinkCounterResult && sessionData.blinkCounterResult.quality !== false &&
      (
        Number(sessionData.blinkCounterResult?.totalBlinks || 0) > 0 ||
        Number(sessionData.blinkCounterResult?.bpmOverall || 0) > 0 ||
        sessionData.blinkCounterResult?.interpretation
      )
    )
    const submitted = sessionData.submittedTestSections || []
    const hasDeqData = submitted.includes('deq') || (sessionData.deqResponses || []).some((value) => Number(value || 0) > 0)
    const hasOsdiData = submitted.includes('osdi') || (sessionData.osdiResponses || []).some((value) => String(value || '0') !== '0')
      || Boolean(String(sessionData.osdiDuration || '').trim())
      || Boolean(String(sessionData.osdiComments || '').trim())
    const hasContrastData = Object.values(sessionData.contrastSensitivity?.rows || {}).some((row) => (
      Object.values(row || {}).some((value) => String(value ?? '').trim() !== '')
    ))
    const hasPosteriorData = submitted.includes('posterior-segment') || ['left', 'right'].some((eye) => {
      const currentValue = sessionData.posteriorSegment?.[eye] || {}
      return Boolean(
        String(currentValue.report || '').trim() ||
        String(currentValue.recommendation || '').trim() ||
        String(currentValue.impression || 'Normal').trim() !== 'Normal'
      )
    })

    if (hasAnyMeibographyResult) {
      nextTests.push(TEST_SECTION_LABELS.meibography)
    }
    if (hasAnyTearMeasurement) {
      nextTests.push(TEST_SECTION_LABELS['tear-meniscus'])
    }
    if (hasBlinkResult) {
      nextTests.push(TEST_SECTION_LABELS['blink-rate'])
    }
    if (sessionData.bulbarRedness?.selectedId) {
      nextTests.push(TEST_SECTION_LABELS['bulbar-redness'])
    }
    if (hasDeqData) {
      nextTests.push(TEST_SECTION_LABELS.deq)
    }
    if (hasOsdiData) {
      nextTests.push(TEST_SECTION_LABELS.osdi)
    }
    if (hasContrastData) {
      nextTests.push(TEST_SECTION_LABELS['contrast-sensitivity'])
    }
    if (hasPosteriorData) {
      nextTests.push(TEST_SECTION_LABELS['posterior-segment'])
    }

    return nextTests
  }

  const buildAssessmentPayload = () => {
    const sessionData = buildAssessmentSessionData()
    const completedTests = buildCompletedTests(sessionData)
    return {
      patient_id: Number(selectedPatient),
      assessment_id: assessmentId && assessmentStatus !== 'reported' ? assessmentId : undefined,
      status: 'draft',
      session_data: sessionData,
      completed_tests: completedTests,
      left_analysis: buildPersistedAnalysisText('left'),
      right_analysis: buildPersistedAnalysisText('right')
    }
  }

  const buildAssessmentFingerprint = (value = {}) => JSON.stringify({
    patient_id: value?.patient_id || null,
    session_data: value?.session_data || {},
    completed_tests: value?.completed_tests || [],
    left_analysis: value?.left_analysis || '',
    right_analysis: value?.right_analysis || ''
  })

  const hasPersistableAssessmentData = (value = {}) => (
    Array.isArray(value?.completed_tests) &&
    value.completed_tests.length > 0
  )

  const syncAssessment = async ({ silent = true } = {}) => {
    if (!selectedPatient) {
      return null
    }

    const payload = buildAssessmentPayload()
    if (!hasPersistableAssessmentData(payload)) {
      return null
    }

    try {
      assessmentAutosaveTimeoutRef.current = null
      isSavingAssessmentRef.current = true
      const response = await axios.post(buildApiUrl('/api/results'), {
        kind: 'assessment',
        ...payload
      })
      const savedAssessment = response.data || null
      if (savedAssessment?.id) {
        setAssessmentId(savedAssessment.id)
        setAssessmentStatus(savedAssessment.status || 'draft')
        lastSyncedAssessmentFingerprintRef.current = buildAssessmentFingerprint({
          patient_id: savedAssessment.patient_id,
          session_data: savedAssessment.session_data,
          completed_tests: savedAssessment.completed_tests,
          left_analysis: savedAssessment.left_analysis,
          right_analysis: savedAssessment.right_analysis
        })
      }
      return savedAssessment
    } catch (error) {
      console.error('Assessment save error:', error)
      if (!silent) {
        showToastMessage('Failed to save patient test data.')
      }
      return null
    } finally {
      isSavingAssessmentRef.current = false
    }
  }

  useEffect(() => {
    if (!selectedPatient) {
      if (assessmentAutosaveTimeoutRef.current) {
        clearTimeout(assessmentAutosaveTimeoutRef.current)
      }
      lastSyncedAssessmentFingerprintRef.current = ''
      setAssessmentId(null)
      setAssessmentStatus('draft')
      resetAssessmentWorkspace()
      return
    }

    if (assessmentAutosaveTimeoutRef.current) {
      clearTimeout(assessmentAutosaveTimeoutRef.current)
    }
    lastSyncedAssessmentFingerprintRef.current = ''
    setAssessmentId(null)
    setAssessmentStatus('draft')
    resetAssessmentWorkspace()
  }, [selectedPatient])

  const stopCameraStream = (invalidatePending = false) => {
    if (invalidatePending) {
      cameraRequestRef.current += 1
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.pause?.()
      videoRef.current.srcObject = null
    }

    if (isMountedRef.current) {
      setIsServerCameraMode(false)
    }

    if (isMountedRef.current) {
      setCameraReady(false)
      setCameraError('')
    }
  }

  const startServerCameraFallback = async (requestId) => {
    try {
      const response = await axios.get(buildApiUrl('/api/camera/settings'))
      const cameraAvailable = Boolean(response?.data?.camera_available)
      if (!cameraAvailable) {
        return false
      }

      if (!isMountedRef.current || cameraRequestRef.current !== requestId) {
        return false
      }

      stopCameraStream()
      setIsServerCameraMode(true)
      setServerCameraStreamNonce((previousNonce) => previousNonce + 1)
      setCameraError('Using backend camera stream fallback.')
      setCameraReady(true)
      showToastMessage('Using backend camera stream fallback.')
      return true
    } catch (fallbackError) {
      return false
    }
  }

  const handleSectionChange = (section, options = {}) => {
    const {
      forceLowerLid = false,
      autoStartCamera = false
    } = options
    const isSwitchingSection = activeTestSectionRef.current !== section

    if (isSwitchingSection) {
      if (isRecordingBlinkCounterRef.current) handleClearBlinkCounter()
      localBlinkLandmarkerRef.current?.close?.()
      localBlinkLandmarkerRef.current = null
      stopCameraStream(true)
    }

    setActiveTestSection(section)
    setSearchParams({ section }, { replace: true })

    if (forceLowerLid) {
      setCurrentLid('lower')
    }


    if (autoStartCamera && (isSwitchingSection || !cameraReady)) {
      void startCameraStream()
    }
  }

  const startCameraStream = async () => {
    if (isStartingCamera && streamRef.current) {
      return
    }

    const requestId = cameraRequestRef.current + 1
    cameraRequestRef.current = requestId

    if (!navigator.mediaDevices?.getUserMedia) {
      const fallbackActivated = await startServerCameraFallback(requestId)
      if (!fallbackActivated) {
        const errorMessage = 'Camera access is unavailable. Port 5000 does not make HTTP secure: use http://localhost:5000 on this computer, or open the app over HTTPS and allow camera permission. Upload an eye image to continue if no camera is available.'
        if (isMountedRef.current) {
          setCameraError(errorMessage)
          showToastMessage(errorMessage)
        }
      }
      return
    }

    try {
      if (isMountedRef.current) {
        setIsStartingCamera(true)
        setCameraError('')
      }

      const constraintsOptions = [
        {
          video: {
            facingMode: 'user',
            width: { ideal: activeTestSectionRef.current === 'blink-rate' ? 640 : 1280 },
            height: { ideal: activeTestSectionRef.current === 'blink-rate' ? 480 : 720 },
            frameRate: { ideal: 20, max: 30 }
          },
          audio: false
        },
        {
          video: true,
          audio: false
        }
      ]

      let stream = null
      let lastError = null

      for (const constraints of constraintsOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch (cameraErrorCandidate) {
          lastError = cameraErrorCandidate
        }
      }

      if (!stream && ['NotFoundError', 'OverconstrainedError'].includes(lastError?.name)) {
        try {
          const videoDevices = (await navigator.mediaDevices.enumerateDevices())
            .filter((device) => device.kind === 'videoinput' && device.deviceId)

          for (const device of videoDevices) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: device.deviceId } },
                audio: false
              })
              break
            } catch (cameraErrorCandidate) {
              lastError = cameraErrorCandidate
            }
          }
        } catch (enumerationError) {
          console.warn('Camera enumeration failed:', enumerationError)
        }
      }

      if (!stream) {
        throw lastError || new Error('Unable to access camera stream.')
      }

      if (!isMountedRef.current || cameraRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      stopCameraStream()
      streamRef.current = stream
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (!isMountedRef.current || cameraRequestRef.current !== requestId) {
            return
          }
          setCameraReady(false)
          setCameraError('Camera stream ended. Click Enable Camera to restart.')
        }
      })

      if (videoRef.current) {
        const videoElement = videoRef.current
        videoElement.srcObject = stream
        await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(), 2500)
          videoElement.onloadedmetadata = () => {
            clearTimeout(timer)
            resolve()
          }
        })

        if (!isMountedRef.current || cameraRequestRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        await videoElement.play()
      }

      if (isMountedRef.current && cameraRequestRef.current === requestId) {
        setCameraError('')
        setCameraReady(true)
        showToastMessage('Camera feed is live.')
      } else {
        stream.getTracks().forEach((track) => track.stop())
      }
    } catch (error) {
      console.error('Camera start error:', error)
      const fallbackActivated = await startServerCameraFallback(requestId)
      if (fallbackActivated) {
        return
      }
      let errorMessage = `Camera error: ${error?.message || 'Unable to start camera.'}`
      if (error?.name === 'NotAllowedError') {
        errorMessage = 'Camera permission denied. Allow camera access and click Enable Camera.'
      } else if (error?.name === 'NotFoundError') {
        errorMessage = 'The browser could not open a camera. Connect or enable a webcam, allow camera access for this site, and close other camera apps. Upload an eye image if no camera is available.'
      } else if (error?.name === 'NotReadableError') {
        errorMessage = 'Camera is busy in another app. Close other camera apps and try again.'
      }
      if (isMountedRef.current && cameraRequestRef.current === requestId) {
        setCameraError(errorMessage)
        setCameraReady(false)
        showToastMessage(errorMessage)
      }
    } finally {
      if (isMountedRef.current && cameraRequestRef.current === requestId) {
        setIsStartingCamera(false)
      }
    }
  }

  const updateCameraSettings = async (newBrightness, newContrast) => {
    try {
      await axios.post(buildApiUrl('/api/camera/settings'), {
        brightness: newBrightness,
        contrast: newContrast
      })
    } catch (error) {
      console.error('Error updating camera settings:', error)
    }
  }

  const handleBrightnessChange = (value) => {
    setBrightness(value)
    updateCameraSettings(value, contrast)
  }

  const handleContrastChange = (value) => {
    setContrast(value)
    updateCameraSettings(brightness, value)
  }

  const clearCurrentEyeTearMeasurement = () => {
    setTearMeasurements((previousMeasurements) => ({
      ...previousMeasurements,
      [currentEye]: null
    }))
  }

  const getPreferredTearMeniscusSourceImage = (eye = currentEye, lid = currentLid) => {
    const lowerKey = getImageKey(eye, 'lower')
    const activeKey = getImageKey(eye, lid)
    return (
      pendingUploadContext?.originalImageData ||
      meibographyResults[lowerKey]?.sourceImage ||
      meibographyResults[activeKey]?.sourceImage ||
      null
    )
  }

  const resetMeibographyWorkflow = () => {
    setMeibographyWorkflow(createInitialMeibographyWorkflowState())
  }

  const updateMeibographyWorkflow = ({ stage, title, detail, visiblePreviewKeys }) => {
    setMeibographyWorkflow((previousWorkflow) => ({
      stage: stage ?? previousWorkflow.stage,
      title: title ?? previousWorkflow.title,
      detail: detail ?? previousWorkflow.detail,
      visiblePreviewKeys: visiblePreviewKeys ?? previousWorkflow.visiblePreviewKeys
    }))
  }

  const clearCurrentMeibographyResult = (eye = currentEye, lid = currentLid) => {
    const resultKey = getImageKey(eye, lid)
    setMeibographyResults((previousResults) => ({
      ...previousResults,
      [resultKey]: null
    }))
    if (eye === currentEye && lid === currentLid) {
      resetMeibographyWorkflow()
    }
  }

  const getRelativeAnnotationPoint = (event) => {
    const layerElement = annotationLayerRef.current
    const reviewImageElement = reviewImageRef.current
    if (!layerElement) {
      return null
    }

    const bounds = layerElement.getBoundingClientRect()
    const normalizedX = (event.clientX - bounds.left) / bounds.width
    const normalizedY = (event.clientY - bounds.top) / bounds.height

    if (
      reviewImageElement &&
      reviewImageElement.naturalWidth > 0 &&
      reviewImageElement.naturalHeight > 0
    ) {
      const containerWidth = layerElement.clientWidth
      const containerHeight = layerElement.clientHeight
      const imageWidth = reviewImageElement.naturalWidth
      const imageHeight = reviewImageElement.naturalHeight

      if (containerWidth > 0 && containerHeight > 0 && imageWidth > 0 && imageHeight > 0) {
        const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
        const renderedWidth = imageWidth * scale
        const renderedHeight = imageHeight * scale
        const offsetX = (containerWidth - renderedWidth) / 2
        const offsetY = (containerHeight - renderedHeight) / 2
        const xInContainer = normalizedX * containerWidth
        const yInContainer = normalizedY * containerHeight
        const isInsideImage = (
          xInContainer >= offsetX &&
          xInContainer <= offsetX + renderedWidth &&
          yInContainer >= offsetY &&
          yInContainer <= offsetY + renderedHeight
        )

        if (!isInsideImage) {
          return null
        }
      }
    }

    return {
      x: Math.min(1, Math.max(0, normalizedX)),
      y: Math.min(1, Math.max(0, normalizedY))
    }
  }

  const mapOverlayPointsToImage = (sourcePoints = []) => {
    const layerElement = annotationLayerRef.current
    const reviewImageElement = reviewImageRef.current
    let mappedPoints = sourcePoints

    if (
      layerElement &&
      reviewImageElement &&
      reviewImageElement.naturalWidth > 0 &&
      reviewImageElement.naturalHeight > 0
    ) {
      const containerWidth = layerElement.clientWidth
      const containerHeight = layerElement.clientHeight
      const imageWidth = reviewImageElement.naturalWidth
      const imageHeight = reviewImageElement.naturalHeight

      if (containerWidth > 0 && containerHeight > 0 && imageWidth > 0 && imageHeight > 0) {
        const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight)
        const renderedWidth = imageWidth * scale
        const renderedHeight = imageHeight * scale
        const offsetX = (containerWidth - renderedWidth) / 2
        const offsetY = (containerHeight - renderedHeight) / 2

        mappedPoints = sourcePoints.map((point) => {
          const xInContainer = point.x * containerWidth
          const yInContainer = point.y * containerHeight
          const xOnImage = (xInContainer - offsetX) / renderedWidth
          const yOnImage = (yInContainer - offsetY) / renderedHeight

          return {
            x: Math.min(1, Math.max(0, xOnImage)),
            y: Math.min(1, Math.max(0, yOnImage))
          }
        })
      }
    }

    return mappedPoints
  }

  const clampTearReviewPan = (nextPan, zoomLevel = tearReviewZoom) => {
    if (zoomLevel <= MIN_TEAR_REVIEW_ZOOM) {
      return { x: 0, y: 0 }
    }

    const layerElement = annotationLayerRef.current || reviewImageRef.current
    const width = layerElement?.clientWidth || 0
    const height = layerElement?.clientHeight || 0

    if (width <= 0 || height <= 0) {
      return nextPan
    }

    const maxOffsetX = ((zoomLevel - 1) * width) / 2
    const maxOffsetY = ((zoomLevel - 1) * height) / 2

    return {
      x: Math.max(-maxOffsetX, Math.min(maxOffsetX, nextPan.x)),
      y: Math.max(-maxOffsetY, Math.min(maxOffsetY, nextPan.y))
    }
  }

  const applyTearOverlayPoints = (nextPoints, previousMeasurement) => ({
    ...(previousMeasurement || {}),
    topPoint: nextPoints[0] || previousMeasurement?.topPoint || null,
    bottomPoint: nextPoints[1] || previousMeasurement?.bottomPoint || null
  })

  const requestTearMeniscusMeasurement = async (sourceImageData, measurementPoints) => {
    const response = await axios.post(`${API_BASE_URL}/api/tear-meniscus/measure`, {
      ...(buildImageTransportPayload(sourceImageData)),
      eye: currentEye,
      brightness,
      contrast,
      points: measurementPoints
    })

    return response?.data?.result || null
  }

  const commitTearMeasurement = async (overlayPoints, options = {}) => {
    const {
      successMessage,
      preserveMeasureMode = false,
      clearDraftPoints = true
    } = options

    const sourceImageData = activeTestSection === 'tear-meniscus'
      ? (getPreferredTearMeniscusSourceImage(currentEye, 'lower') || pendingUploadContext?.sourceImageData || reviewSnapshot)
      : (pendingUploadContext?.sourceImageData || reviewSnapshot)
    const mappedPoints = mapOverlayPointsToImage(overlayPoints)
    const result = await requestTearMeniscusMeasurement(sourceImageData, mappedPoints)

    setTearMeasurements((previousMeasurements) => ({
      ...previousMeasurements,
      [currentEye]: {
        distancePixels: result?.distance_pixels ?? 0,
        tmhMm: Number(result?.tmh_mm ?? 0),
        label: result?.tmh_label || result?.label || '--',
        distanceLabel: result?.distance_label || '',
        statusLabel: result?.status_label || '',
        statusColor: result?.status_color || '',
        corneaWidthPixels: Number(result?.cornea_width_pixels ?? 0),
        summary: result?.summary || '',
        // Keep the visible markers in overlay-space so they do not jump after
        // the server converts points into image-space for measurement.
        topPoint: overlayPoints[0] || result?.top_point || mappedPoints[0],
        bottomPoint: overlayPoints[1] || result?.bottom_point || mappedPoints[1],
        annotatedImage: result?.annotated_image_data || '',
        diagramImage: result?.diagram_image_data || '',
        measuredAt: result?.measured_at || ''
      }
    }))

    if (clearDraftPoints) {
      setTearMeasurementDraftPoints([])
    }
    if (!preserveMeasureMode) {
      setIsTearMeasureMode(false)
    }
    if (successMessage) {
      showToastMessage(successMessage(result))
    }
    return result
  }

  const updateTearOverlayPoints = (pointIndex, nextPoint) => {
    if (isTearMeasureMode) {
      const nextPoints = Array.isArray(tearInteractionRef.current.latestPoints)
        ? [...tearInteractionRef.current.latestPoints]
        : [...tearMeasurementDraftPoints]
      nextPoints[pointIndex] = nextPoint
      tearInteractionRef.current.latestPoints = nextPoints
      setTearMeasurementDraftPoints(nextPoints)
      return
    }

    const basePoints = Array.isArray(tearInteractionRef.current.latestPoints)
      ? [...tearInteractionRef.current.latestPoints]
      : [currentTearMeasurement?.topPoint, currentTearMeasurement?.bottomPoint]
    basePoints[pointIndex] = nextPoint
    tearInteractionRef.current.latestPoints = basePoints
    setTearMeasurements((previousMeasurements) => {
      const previousMeasurement = previousMeasurements[currentEye]
      if (!previousMeasurement) {
        return previousMeasurements
      }
      return {
        ...previousMeasurements,
        [currentEye]: applyTearOverlayPoints(basePoints, previousMeasurement)
      }
    })
  }

  const handleTearOverlayPointerDown = (event) => {
    if (!isTearReviewActive) {
      return
    }

    const pointElement = typeof event.target?.closest === 'function'
      ? event.target.closest('[data-tear-point-index]')
      : null
    const pointIndexValue = pointElement?.dataset?.tearPointIndex
    const pointIndex = Number(pointIndexValue)
    if (isTearMeasureMode && Number.isInteger(pointIndex)) {
      event.preventDefault()
      event.stopPropagation()
      tearInteractionRef.current = {
        mode: 'point',
        pointIndex,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: tearReviewPan.x,
        startPanY: tearReviewPan.y,
        hasMoved: false,
        latestPoints: tearOverlayPoints,
        suppressClick: false
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      return
    }

    if (tearReviewZoom <= MIN_TEAR_REVIEW_ZOOM) {
      return
    }

    tearInteractionRef.current = {
      mode: 'pan',
      pointIndex: null,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: tearReviewPan.x,
      startPanY: tearReviewPan.y,
      hasMoved: false,
      latestPoints: null,
      suppressClick: false
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleTearOverlayPointerMove = (event) => {
    const interaction = tearInteractionRef.current
    if (!interaction.mode) {
      if (isTearMeasureMode && tearMeasurementDraftPoints.length === 1) {
        const nextPoint = getRelativeAnnotationPoint(event)
        setTearMeasureHoverPoint(nextPoint)
      }
      return
    }

    const deltaX = event.clientX - interaction.startClientX
    const deltaY = event.clientY - interaction.startClientY
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      interaction.hasMoved = true
      interaction.suppressClick = true
    }

    if (interaction.mode === 'pan') {
      setTearReviewPan(clampTearReviewPan({
        x: interaction.startPanX + deltaX,
        y: interaction.startPanY + deltaY
      }))
      return
    }

    if (interaction.mode === 'point') {
      const nextPoint = getRelativeAnnotationPoint(event)
      if (!nextPoint) {
        return
      }
      updateTearOverlayPoints(interaction.pointIndex, nextPoint)
    }
  }

  const endTearOverlayInteraction = async () => {
    const interaction = tearInteractionRef.current
    if (!interaction.mode && isTearMeasureMode) {
      setTearMeasureHoverPoint(null)
      return
    }
    tearInteractionRef.current = {
      mode: null,
      pointIndex: null,
      startClientX: 0,
      startClientY: 0,
      startPanX: 0,
      startPanY: 0,
      hasMoved: false,
      latestPoints: null,
      suppressClick: interaction.suppressClick
    }

    if (interaction.mode !== 'point' || !interaction.hasMoved) {
      return
    }

    if (!isTearMeasureMode) {
      return
    }

    const latestPoints = Array.isArray(interaction.latestPoints)
      ? interaction.latestPoints.slice(0, 2)
      : []
    if (latestPoints.length < 2 || latestPoints.some((point) => !point)) {
      return
    }

    try {
      setIsMeasuringTearMeniscus(true)
      setTearMeasureHoverPoint(null)
      await commitTearMeasurement(latestPoints, {
        successMessage: (result) => `Tear meniscus measured: ${result?.tmh_label || result?.label || '--'}`
      })
    } catch (error) {
      console.error('Tear meniscus measurement error:', error)
      const errorMessage = error?.response?.data?.error || 'Failed to measure tear meniscus.'
      showToastMessage(errorMessage)
    } finally {
      setIsMeasuringTearMeniscus(false)
    }
  }

  const requestEnhancedImage = async (sourceImageData, { signal } = {}) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/enhance`, {
        ...(buildImageTransportPayload(sourceImageData))
      }, { signal })

      return response?.data?.result || null
    } catch (error) {
      if (signal?.aborted || error?.code === 'ERR_CANCELED' || axios.isCancel(error)) throw error
      if (isImageData(sourceImageData)) {
        const enhancedImageData = await enhanceImageDataUrlInBrowser(sourceImageData)
        return {
          enhanced_image_data: enhancedImageData,
          method: 'Image_processing.py (browser fallback)'
        }
      }

      throw error
    }
  }

  const cancelPendingAutoEnhance = () => {
    autoEnhanceControllerRef.current?.abort()
    autoEnhanceControllerRef.current = null
    if (autoEnhanceTimeoutRef.current) {
      clearTimeout(autoEnhanceTimeoutRef.current)
      autoEnhanceTimeoutRef.current = null
    }
    autoEnhanceRequestTokenRef.current += 1
  }

  const scheduleAutoEnhance = (originalImageData) => {
    cancelPendingAutoEnhance()
    setPendingUploadContext((previousContext) => (
      previousContext?.originalImageData === originalImageData
        ? { ...previousContext, enhancementStatus: 'pending' }
        : previousContext
    ))
    // Import/load the real models while the person reviews their selected image.
    if (activeTestSectionRef.current === 'meibography') void warmMeibographyModel()
    updateMeibographyWorkflow({
      stage: 'auto-enhance-pending',
      title: 'Auto-enhance queued',
      detail: 'Preparing the uploaded image for review.',
      visiblePreviewKeys: []
    })

    const requestToken = autoEnhanceRequestTokenRef.current
    autoEnhanceTimeoutRef.current = setTimeout(async () => {
      autoEnhanceTimeoutRef.current = null
      const controller = new AbortController()
      autoEnhanceControllerRef.current = controller

      try {
        updateMeibographyWorkflow({
          stage: 'auto-enhancing',
          title: 'Auto-enhancing image...',
          detail: 'Preparing the enhanced image before eyelid detection.',
          visiblePreviewKeys: []
        })
        const result = await requestEnhancedImage(originalImageData, { signal: controller.signal })
        if (!isMountedRef.current || autoEnhanceRequestTokenRef.current !== requestToken) {
          return
        }

        const currentContext = pendingUploadContextRef.current
        if (!currentContext || currentContext.originalImageData !== originalImageData || currentContext.analysisType) {
          return
        }

        if (!isImageData(result?.enhanced_image_data)) {
          throw new Error('Auto-enhancement did not return a processed image. Retry enhancement before eyelid detection.')
        }
        const enhancedImageDataUrl = result.enhanced_image_data

        if (activeTestSectionRef.current !== 'tear-meniscus') {
          setReviewSnapshot(enhancedImageDataUrl)
        }
        setPendingUploadContext((previousContext) => {
          if (!previousContext || previousContext.originalImageData !== originalImageData || previousContext.analysisType) {
            return previousContext
          }

          return {
            ...previousContext,
            sourceImageData: enhancedImageDataUrl,
            originalImageData,
            enhancementStatus: 'complete'
          }
        })
        updateMeibographyWorkflow({
          stage: 'ready',
          title: '',
          detail: '',
          visiblePreviewKeys: ['source']
        })
        showToastMessage('Auto enhancement applied.')
      } catch (error) {
        if (!isMountedRef.current || autoEnhanceRequestTokenRef.current !== requestToken) {
          return
        }

        console.error('Scheduled auto enhancement error:', error)
        const errorMessage = error?.response?.data?.error || 'Failed to auto enhance image.'
        setPendingUploadContext((previousContext) => (
          previousContext?.originalImageData === originalImageData
            ? { ...previousContext, enhancementStatus: 'failed' }
            : previousContext
        ))
        updateMeibographyWorkflow({
          stage: 'auto-enhance-error',
          title: 'Auto enhancement failed',
          detail: errorMessage,
          visiblePreviewKeys: []
        })
        showToastMessage(errorMessage)
      } finally {
        if (autoEnhanceControllerRef.current === controller) autoEnhanceControllerRef.current = null
      }
    }, AUTO_ENHANCE_DELAY_MS)
  }

  const cancelMeibographyPlayback = () => {
    analysisControllerRef.current?.abort()
    analysisControllerRef.current = null
    meibographyPlaybackTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId))
    meibographyPlaybackTimeoutsRef.current = []
    meibographyPlaybackTokenRef.current += 1
  }

  const playMeibographyDetectionSequence = async ({
    sourceImage,
    eyelidBoundaryImage,
    finalImage,
    analysisDetail
  }) => {
    const playbackToken = meibographyPlaybackTokenRef.current
    if (meibographyPlaybackTokenRef.current !== playbackToken || !isMountedRef.current) return false
    // Results already arrived from inference. Show them immediately; previews remain
    // available for inspection without delaying the user with a staged playback.
    if (isImageData(finalImage)) setReviewSnapshot(finalImage)
    const visiblePreviewKeys = []
    if (isImageData(sourceImage)) visiblePreviewKeys.push('source')
    if (isImageData(eyelidBoundaryImage)) visiblePreviewKeys.push('eyelid')
    if (isImageData(finalImage)) visiblePreviewKeys.push('meibo')
    updateMeibographyWorkflow({
      stage: 'complete', title: 'Analysis complete',
      detail: analysisDetail || 'Coverage, dropout, and grade are ready.',
      visiblePreviewKeys
    })
    return true
  }

  const requestMeibographyAnalysis = async (sourceImageData) => {
    console.info('Starting meibography analysis...', {
      eye: currentEye,
      lid: currentLid,
      patientId: selectedPatient || null
    })
    const manual = getManualEyelidPayload()
    const key = [selectedPatient, sourceImageData, currentEye, currentLid, brightness, contrast,
      manual.manual_eyelid_closed, JSON.stringify(manual.manual_eyelid_points)]
    return analysisRequestCacheRef.current.load(key, async () => {
      const controller = new AbortController()
      analysisControllerRef.current = controller
      try {
        const response = await axios.post(buildApiUrl('/api/predict'), {
          ...buildImageTransportPayload(sourceImageData),
          eye: currentEye, lid: currentLid, source_lid: pendingUploadContext?.sourceLid,
          brightness, contrast, ...manual, compact_response: true
        }, { signal: controller.signal, timeout: 120000 })
        return response?.data?.result || null
      } finally {
        if (analysisControllerRef.current === controller) analysisControllerRef.current = null
      }
    })
  }

  const handleStartTearMeasurement = () => {
    setTearMeasureActionMode('measure')
    if (!reviewSnapshot) {
      showToastMessage('Capture or upload an image first.')
      return
    }

    cancelMeibographyPlayback()
    handleSectionChange('tear-meniscus', { forceLowerLid: true })
    setIsAnnotateMode(false)
    setAnnotationPoints([])
    setIsAnnotationClosed(false)

    const candidatePoints = tearMeasurementDraftPoints.length > 0
      ? tearMeasurementDraftPoints.slice(0, 2)
      : (currentTearMeasurement ? [currentTearMeasurement.topPoint, currentTearMeasurement.bottomPoint].filter(Boolean) : [])

    setTearMeasurementDraftPoints(candidatePoints)
    setIsTearMeasureMode(true)
    showToastMessage(
      candidatePoints.length === 1
        ? 'Bottom point pending. Place the second point to measure TMH.'
        : candidatePoints.length === 2
          ? 'Measure mode active. Drag the points or click to place them again.'
          : 'Click the top edge, then the bottom edge of the tear meniscus.'
    )
  }

  const handleZoomInTearReview = () => {
    setTearReviewZoom((previousZoom) => {
      const nextZoom = Math.min(MAX_TEAR_REVIEW_ZOOM, previousZoom + TEAR_REVIEW_ZOOM_STEP)
      setTearReviewPan((previousPan) => clampTearReviewPan(previousPan, nextZoom))
      return nextZoom
    })
  }

  const handleZoomOutTearReview = () => {
    setTearReviewZoom((previousZoom) => {
      const nextZoom = Math.max(MIN_TEAR_REVIEW_ZOOM, previousZoom - TEAR_REVIEW_ZOOM_STEP)
      setTearReviewPan((previousPan) => clampTearReviewPan(previousPan, nextZoom))
      return nextZoom
    })
  }

  const handleResetTearReviewZoom = () => {
    setTearReviewZoom(MIN_TEAR_REVIEW_ZOOM)
    setTearReviewPan({ x: 0, y: 0 })
  }

  const handleClearTearMeasurement = () => {
    setTearMeasureActionMode('clear')
    setTearMeasurementDraftPoints([])
    setIsTearMeasureMode(false)
    clearCurrentEyeTearMeasurement()
    showToastMessage(`Cleared tear meniscus measurement for the ${currentEye} eye.`)
  }

  const handleAnalyzeMeibography = async () => {
    const uploadContext = pendingUploadContextRef.current || pendingUploadContext
    if (!reviewSnapshot || !uploadContext) {
      showToastMessage('Capture or upload an image first.')
      return
    }

    if (uploadContext.enhancementStatus !== 'complete' || !isImageData(uploadContext.sourceImageData)) {
      if (uploadContext.enhancementStatus === 'failed' && isImageData(uploadContext.originalImageData)) {
        scheduleAutoEnhance(uploadContext.originalImageData)
        showToastMessage('Retrying auto-enhancement. Eyelid detection will be available when it finishes.')
      } else {
        showToastMessage('Please wait for auto-enhancement to finish before eyelid detection.')
      }
      return
    }

    const sourceLid = uploadContext.sourceLid
    if (sourceLid && sourceLid !== currentLid) {
      const promptMessage = getLidMismatchPrompt(sourceLid)
      resetMeibographyWorkflow()
      updateMeibographyWorkflow({
        stage: 'lid-mismatch',
        title: `Select ${formatLidLabel(sourceLid)} Lid`,
        detail: promptMessage,
        visiblePreviewKeys: ['source']
      })
      showToastMessage(promptMessage)
      return
    }

    cancelMeibographyPlayback()
    const analysisToken = meibographyPlaybackTokenRef.current
    const resultKey = getImageKey(currentEye, currentLid)

    try {
      setIsAnalyzingMeibography(true)
      updateMeibographyWorkflow({
        stage: 'detecting-eyelid',
        title: 'Detecting eyelid...',
        detail: 'Starting eyelid detection on the enhanced image.',
        visiblePreviewKeys: meibographyWorkflow.visiblePreviewKeys.includes('source')
          ? meibographyWorkflow.visiblePreviewKeys
          : ['source']
      })
      const sourceImageData = uploadContext.sourceImageData
      const result = await requestMeibographyAnalysis(sourceImageData)
      if (!isMountedRef.current || meibographyPlaybackTokenRef.current !== analysisToken) {
        return
      }
      console.info('Meibography analysis completed successfully.', {
        glandCount: result?.gland_count, durationMs: result?.analysis_duration_ms
      })
      const sourceStageImage = isImageData(result?.source_image_data)
        ? result.source_image_data
        : sourceImageData
      const eyelidBoundaryImage = isImageData(result?.eyelid_boundary_image_data)
        ? result.eyelid_boundary_image_data
        : ''
      const glandProgressionImages = Array.isArray(result?.gland_progression_image_data)
        ? result.gland_progression_image_data.filter((image) => isImageData(image))
        : []
      const annotatedImage = isImageData(result?.meibomian_evaluation_image_data)
        ? result.meibomian_evaluation_image_data
        : isImageData(result?.annotated_image_data)
        ? result.annotated_image_data
        : reviewSnapshot
      const originalPreviewImage = pendingUploadContext?.originalImageData || sourceStageImage
      const analysisDetail = buildMeibographyAnalysisDetail(result)

      setAnnotationPoints([])
      setIsAnnotationClosed(false)
      setIsAnnotateMode(false)
      setTearMeasurementDraftPoints([])
      setIsTearMeasureMode(false)

      setMeibographyResults((previousResults) => ({
        ...previousResults,
        [resultKey]: {
          summary: result?.summary || '',
          coveragePct: Number(result?.coverage_pct ?? 0),
          dropoutPct: Number(result?.dropout_pct ?? 0),
          grade: result?.grade || 'N/A',
          glandCount: Number(result?.gland_count ?? 0),
          probabilityMean: Number(result?.probability_mean ?? 0),
          probabilityMax: Number(result?.probability_max ?? 0),
          eyelidSide: result?.eyelid_side || currentLid,
          sourceImage: originalPreviewImage,
          eyelidBoundaryImage,
          glandProgressionImages,
          meibomianEvaluationImage: result?.meibomian_evaluation_image_data || annotatedImage,
          annotatedImage,
          analyzedAt: new Date().toISOString()
        }
      }))

      setPendingUploadContext({
        sourceImageData,
        originalImageData: pendingUploadContext?.originalImageData || sourceImageData,
        sourceLid: result?.detected_lid || result?.eyelid_side || pendingUploadContext?.sourceLid || null,
        analysisType: 'meibography',
        enhancementStatus: 'complete'
      })
      const playbackCompleted = await playMeibographyDetectionSequence({
        sourceImage: sourceStageImage,
        eyelidBoundaryImage,
        glandProgressionImages,
        finalImage: annotatedImage,
        analysisDetail
      })
      if (playbackCompleted && isMountedRef.current && meibographyPlaybackTokenRef.current === analysisToken) {
        showToastMessage(result?.summary || `Meibography analysis completed for the ${currentEye} eye ${currentLid} lid.`)
      }
    } catch (error) {
      console.error('Meibography analysis error:', error)
      if (!isMountedRef.current || meibographyPlaybackTokenRef.current !== analysisToken || error?.code === 'ERR_CANCELED') return
      const errorMessage = error?.response?.data?.error || 'Failed to analyze meibography.'
      updateMeibographyWorkflow({
        stage: 'analysis-error',
        title: 'Meibography analysis failed',
        detail: errorMessage
      })
      showToastMessage(errorMessage)
    } finally {
      if (isMountedRef.current && meibographyPlaybackTokenRef.current === analysisToken) setIsAnalyzingMeibography(false)
    }
  }

  const handleAnnotationCanvasClick = async (event) => {
    if (tearInteractionRef.current.suppressClick) {
      tearInteractionRef.current.suppressClick = false
      return
    }

    const nextPoint = getRelativeAnnotationPoint(event)
    if (!nextPoint) {
      return
    }

    if (isTearMeasureMode) {
      const nextPoints = tearMeasurementDraftPoints.length >= 2
        ? [nextPoint]
        : [...tearMeasurementDraftPoints, nextPoint].slice(0, 2)
      setTearMeasurementDraftPoints(nextPoints)
      setTearMeasureHoverPoint(nextPoints.length === 1 ? nextPoint : null)

      if (nextPoints.length < 2) {
        showToastMessage('Top marker placed. Now click the bottom edge.')
        return
      }
      try {
        setIsMeasuringTearMeniscus(true)
        setTearMeasureHoverPoint(null)
        await commitTearMeasurement(nextPoints, {
          successMessage: (result) => `Tear meniscus measured: ${result?.tmh_label || result?.label || '--'}`
        })
      } catch (error) {
        console.error('Tear meniscus measurement error:', error)
        const errorMessage = error?.response?.data?.error || 'Failed to measure tear meniscus.'
        showToastMessage(errorMessage)
      } finally {
        setIsMeasuringTearMeniscus(false)
      }
      return
    }

    if (!isAnnotateMode) {
      return
    }

    // Start a new polygon after a completed one.
    if (isAnnotationClosed) {
      setAnnotationPoints([nextPoint])
      setIsAnnotationClosed(false)
      return
    }

    if (annotationPoints.length >= 3) {
      const firstPoint = annotationPoints[0]
      const closeDistance = Math.hypot(nextPoint.x - firstPoint.x, nextPoint.y - firstPoint.y)
      if (closeDistance < 0.03) {
        setIsAnnotationClosed(true)
        return
      }
    }

    setAnnotationPoints((previousPoints) => [...previousPoints, nextPoint])
  }

  const handleAnnotationDoubleClick = (event) => {
    event.preventDefault()
    if (annotationPoints.length >= 3) {
      setIsAnnotationClosed(true)
    }
  }

  const handleAnnotateToggle = () => {
    if (!reviewSnapshot) {
      showToastMessage('Capture an image first to annotate.')
      return
    }
    cancelMeibographyPlayback()
    setIsTearMeasureMode(false)
    setTearMeasurementDraftPoints([])
    setIsAnnotateMode((previousState) => !previousState)
  }

  const handleCapture = async () => {
    const videoElement = videoRef.current

    if (isServerCameraMode) {
      try {
        const captureResponse = await axios.post(buildApiUrl('/api/upload'), {
          patient_id: selectedPatient || null,
          eye: currentEye,
          lid: currentLid,
          brightness,
          contrast
        })

        const snapshotPath = captureResponse?.data?.image_url
        if (!snapshotPath) {
          throw new Error('No image URL returned from backend capture.')
        }

        const snapshotSource = buildApiUrl(snapshotPath)
        setAnnotationPoints([])
        setIsAnnotationClosed(false)
        setIsAnnotateMode(false)
        setTearMeasurementDraftPoints([])
        setIsTearMeasureMode(false)
        clearCurrentEyeTearMeasurement()
        clearCurrentMeibographyResult()
        setPendingUploadContext({
          sourceImageData: snapshotSource,
          originalImageData: snapshotSource,
          sourceLid: null,
          analysisType: '',
          enhancementStatus: 'pending'
        })
        resetMeibographyWorkflow()
        setReviewSnapshot(snapshotSource)
        scheduleAutoEnhance(snapshotSource)
        showToastMessage('Snapshot captured from backend camera.')
      } catch (error) {
        console.error('Server camera capture error:', error)
        showToastMessage(error?.response?.data?.error || 'Failed to capture snapshot from backend camera.')
      }
      return
    }

    if (!videoElement || !videoElement.srcObject || !cameraReady) {
      showToastMessage('Enable camera before capture.')
      return
    }

    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      showToastMessage('Camera is not ready yet.')
      return
    }

    try {
      cancelMeibographyPlayback()
      const videoTrack = videoElement.srcObject.getVideoTracks?.()[0]
      let snapshotDataUrl = null

      if (videoTrack && typeof ImageCapture !== 'undefined') {
        try {
          const imageCapture = new ImageCapture(videoTrack)
          const photoBlob = await imageCapture.takePhoto()
          snapshotDataUrl = await blobToDataUrl(photoBlob)
        } catch (stillCaptureError) {
          console.warn('Falling back to video-frame capture:', stillCaptureError)
        }
      }

      if (!snapshotDataUrl) {
        const canvas = document.createElement('canvas')
        canvas.width = videoElement.videoWidth
        canvas.height = videoElement.videoHeight

        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Unable to create image context.')
        }

        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
        snapshotDataUrl = canvas.toDataURL('image/png')
      }

      setAnnotationPoints([])
      setIsAnnotationClosed(false)
      setIsAnnotateMode(false)
      setTearMeasurementDraftPoints([])
      setIsTearMeasureMode(false)
      clearCurrentEyeTearMeasurement()
      clearCurrentMeibographyResult()
      setPendingUploadContext({
        sourceImageData: snapshotDataUrl,
        originalImageData: snapshotDataUrl,
        sourceLid: null,
        analysisType: '',
        enhancementStatus: 'pending'
      })
      resetMeibographyWorkflow()
      setReviewSnapshot(snapshotDataUrl)
      scheduleAutoEnhance(snapshotDataUrl)
      showToastMessage('Snapshot captured. Preparing the image.')
    } catch (error) {
      console.error('Capture error:', error)
      showToastMessage('Failed to capture snapshot.')
    }
  }

  const handleDeleteSnapshot = () => {
    cancelPendingAutoEnhance()
    cancelMeibographyPlayback()
    setAnnotationPoints([])
    setIsAnnotationClosed(false)
    setIsAnnotateMode(false)
    setTearMeasurementDraftPoints([])
    setIsTearMeasureMode(false)
    clearCurrentEyeTearMeasurement()
    clearCurrentMeibographyResult()
    setPendingUploadContext(null)
    setReviewSnapshot(null)
    resetMeibographyWorkflow()
    showToastMessage('Snapshot deleted.')
  }

  const renderAnnotatedSnapshot = async (baseSnapshot) => {
    if (!isAnnotateMode || annotationPoints.length < 2) {
      return baseSnapshot
    }

    return new Promise((resolve) => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')

        if (!context) {
          resolve(baseSnapshot)
          return
        }

        context.drawImage(image, 0, 0)
        context.lineWidth = Math.max(2, image.width * 0.003)
        context.strokeStyle = '#3b82f6'
        context.fillStyle = 'rgba(59,130,246,0.22)'

        context.beginPath()
        context.moveTo(annotationPoints[0].x * image.width, annotationPoints[0].y * image.height)
        for (let pointIndex = 1; pointIndex < annotationPoints.length; pointIndex += 1) {
          const point = annotationPoints[pointIndex]
          context.lineTo(point.x * image.width, point.y * image.height)
        }

        if (isAnnotationClosed && annotationPoints.length >= 3) {
          context.closePath()
          context.fill()
        }
        context.stroke()

        annotationPoints.forEach((point, pointIndex) => {
          context.beginPath()
          context.fillStyle = pointIndex === 0 ? '#f97316' : '#3b82f6'
          context.arc(point.x * image.width, point.y * image.height, Math.max(3, image.width * 0.005), 0, Math.PI * 2)
          context.fill()
        })

        const labelAnchor = annotationPoints[0]
        if (labelAnchor) {
          const labelText = 'Eyelid'
          const labelFontSize = Math.max(14, image.width * 0.018)
          const labelPaddingX = Math.max(8, image.width * 0.01)
          const labelHeight = labelFontSize + 10
          context.font = `700 ${labelFontSize}px Arial`
          const labelWidth = context.measureText(labelText).width + labelPaddingX * 2
          const rawX = labelAnchor.x * image.width + image.width * 0.015
          const rawY = labelAnchor.y * image.height - labelHeight - image.height * 0.012
          const labelX = Math.max(8, Math.min(image.width - labelWidth - 8, rawX))
          const labelY = Math.max(8, rawY)

          context.fillStyle = 'rgba(15, 52, 84, 0.9)'
          context.fillRect(labelX, labelY, labelWidth, labelHeight)
          context.fillStyle = '#ffffff'
          context.fillText(labelText, labelX + labelPaddingX, labelY + labelHeight - 8)
        }

        resolve(canvas.toDataURL('image/png'))
      }
      image.onerror = () => resolve(baseSnapshot)
      image.src = baseSnapshot
    })
  }

  const isImageData = (value) => typeof value === 'string' && value.startsWith('data:image/')
  const buildImageTransportPayload = (sourceImage) => (
    isImageData(sourceImage)
      ? { image_data: sourceImage }
      : { image_url: sourceImage }
  )
  const getManualEyelidPayload = () => {
    if (isAnnotationClosed && annotationPoints.length >= 3) {
      const mappedPoints = mapOverlayPointsToImage(annotationPoints)
      return {
        manual_eyelid_points: mappedPoints,
        manual_eyelid_closed: true
      }
    }
    return {
      manual_eyelid_points: [],
      manual_eyelid_closed: false
    }
  }

  const handleSaveSnapshot = async () => {
    if (!reviewSnapshot) {
      return
    }

    cancelPendingAutoEnhance()
    cancelMeibographyPlayback()
    const targetKey = getImageKey(currentEye, currentLid)
    const snapshotToSave = await renderAnnotatedSnapshot(reviewSnapshot)
    let finalSnapshot = snapshotToSave
    const sourceImageForServer = pendingUploadContext?.sourceImageData || snapshotToSave

    try {
      const manualEyelidPayload = getManualEyelidPayload()
      await axios.post(buildApiUrl('/api/upload'), {
        patient_id: selectedPatient || null,
        eye: currentEye,
        lid: currentLid,
        brightness,
        contrast,
        ...(buildImageTransportPayload(sourceImageForServer)),
        ...manualEyelidPayload
      })
    } catch (error) {
      console.error('Capture save error:', error)
    }

    // One slot per eye/lid: saving to the same key overwrites the previous image for that slot.
    dispatchImage({
      type: 'SET_SLOT',
      key: targetKey,
      value: finalSnapshot
    })

    setAnnotationPoints([])
    setIsAnnotationClosed(false)
    setIsAnnotateMode(false)
    setTearMeasurementDraftPoints([])
    setIsTearMeasureMode(false)
    setPendingUploadContext(null)
    setReviewSnapshot(null)
    resetMeibographyWorkflow()
    showToastMessage(
      pendingUploadContext?.analysisType === 'meibography'
        ? `Saved with meibography analysis for the ${currentEye} eye ${currentLid} lid.`
        : `Saved to ${currentEye} eye ${currentLid} lid.`
    )
  }

  const handleUndoImage = () => {
    if (!imageState.undoStack.length) {
      showToastMessage('Nothing to undo.')
      return
    }
    dispatchImage({ type: 'UNDO' })
    showToastMessage('Undid last image change.')
  }

  const handleRedoImage = () => {
    if (!imageState.redoStack.length) {
      showToastMessage('Nothing to redo.')
      return
    }
    dispatchImage({ type: 'REDO' })
    showToastMessage('Redid image change.')
  }

  const handleResetCurrentImage = () => {
    const activeKey = getImageKey(currentEye, currentLid)
    if (!imageState.images[activeKey]) {
      showToastMessage('No image to reset in this slot.')
      return
    }
    dispatchImage({
      type: 'RESET_SLOT',
      key: activeKey
    })
    clearCurrentMeibographyResult()
    resetMeibographyWorkflow()
    showToastMessage(`Reset ${currentEye} eye ${currentLid} lid image.`)
  }

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const fileReader = new FileReader()
    fileReader.onload = () => resolve(fileReader.result)
    fileReader.onerror = () => reject(new Error('Unable to read selected image.'))
    fileReader.readAsDataURL(file)
  })

  const handleOpenManualImagePicker = () => {
    manualImageInputRef.current?.click()
  }

  const handleManualImageSelected = async (event, { sample = null } = {}) => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''

    if (!selectedFile) {
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      showToastMessage('Please choose a valid image file.')
      return
    }

    if (selectedFile.size > 8 * 1024 * 1024) {
      showToastMessage('This image is too large. Choose a photo smaller than 8 MB.')
      return
    }

    try {
      setIsManualImageProcessing(true)
      cancelMeibographyPlayback()
      const selectedImageDataUrl = await readFileAsDataUrl(selectedFile)
      if (typeof selectedImageDataUrl !== 'string') {
        throw new Error('Invalid file payload.')
      }

      if (!isMountedRef.current || (sample && activeTestSectionRef.current !== 'meibography')) return false
      const targetLid = sample?.lid || currentLid
      if (sample?.lid) setCurrentLid(sample.lid)
      setLoadedSample(sample)
      setAnnotationPoints([])
      setIsAnnotationClosed(false)
      setIsAnnotateMode(false)
      setTearMeasurementDraftPoints([])
      setIsTearMeasureMode(false)
      clearCurrentEyeTearMeasurement()
      clearCurrentMeibographyResult(currentEye, targetLid)
      resetMeibographyWorkflow()
      setReviewSnapshot(selectedImageDataUrl)
      setPendingUploadContext({
        sourceImageData: selectedImageDataUrl,
        originalImageData: selectedImageDataUrl,
        sourceLid: sample?.lid || null,
        analysisType: '',
        enhancementStatus: 'pending'
      })
      scheduleAutoEnhance(selectedImageDataUrl)
      showToastMessage(sample ? `${sample.label} loaded. Preparing the image.` : 'Image uploaded. Preparing the image.')
      return true
    } catch (error) {
      console.error('Manual image load error:', error)
      const errorMessage = error?.response?.data?.error || 'Failed to load the selected image.'
      showToastMessage(errorMessage)
      return false
    } finally {
      setIsManualImageProcessing(false)
    }
  }

  const handleLoadSampleImage = async (sample) => {
    const url = `${import.meta.env.BASE_URL}${sample.src.replace(/^\//, '')}`
    const response = await fetch(url, { credentials: 'omit' })
    if (!response.ok) throw new Error('The sample image could not be downloaded. Please try again.')
    const blob = await response.blob()
    if (!isMountedRef.current || activeTestSectionRef.current !== 'meibography') return
    const file = new File([blob], sample.filename, { type: blob.type || 'image/png' })
    const loaded = await handleManualImageSelected({ target: { files: [file], value: '' } }, { sample })
    if (!loaded) throw new Error('The sample image could not be opened. Please try again.')
  }

  const clearBlinkRecordingTimers = () => {
    clearInterval(blinkRecordingTimerRef.current)
    clearTimeout(blinkRecordingStopTimeoutRef.current)
    clearTimeout(blinkLiveAnalysisIntervalRef.current)
    blinkRecordingTimerRef.current = null
    blinkRecordingStopTimeoutRef.current = null
    blinkLiveAnalysisIntervalRef.current = null
    isRecordingBlinkCounterRef.current = false
    blinkLiveLoopTokenRef.current += 1
  }

  const resetLiveBlinkMetrics = () => {
    blinkTrackingStateRef.current = createBlinkTrackingState()
    blinkLivePendingRequestRef.current = false
    blinkLiveErrorShownRef.current = false
    setLiveBlinkMetrics({ totalBlinks: 0, bpmOverall: 0, faceFound: false })
  }

  const ensureLocalBlinkLandmarker = async () => {
    if (localBlinkLandmarkerRef.current) return localBlinkLandmarkerRef.current
    if (!localBlinkLandmarkerInitPromiseRef.current) {
      localBlinkLandmarkerInitPromiseRef.current = createLocalBlinkLandmarker()
        .then((landmarker) => {
          if (!isMountedRef.current || activeTestSectionRef.current !== 'blink-rate') {
            landmarker.close()
            throw new Error('Blink session was cancelled.')
          }
          localBlinkLandmarkerRef.current = landmarker
          return landmarker
        })
        .finally(() => { localBlinkLandmarkerInitPromiseRef.current = null })
    }
    return localBlinkLandmarkerInitPromiseRef.current
  }

  const analyzeBlinkFrameLive = async (loopToken = blinkLiveLoopTokenRef.current) => {
    if (loopToken !== blinkLiveLoopTokenRef.current || !isRecordingBlinkCounterRef.current) return
    if (blinkLivePendingRequestRef.current) return
    const started = performance.now()
    try {
      blinkLivePendingRequestRef.current = true
      let result
      if (isServerCameraMode) {
        const response = await axios.post(`${API_BASE_URL}/api/blink-counter/frame`, { use_server_camera: true }, { timeout: 5000 })
        result = response?.data?.result
      } else {
        const video = videoRef.current
        if (!video?.videoWidth || video.readyState < 2 || document.hidden) return
        const landmarker = localBlinkLandmarkerRef.current
        if (!landmarker) return
        const rawResult = landmarker.detectForVideo(video, performance.now())
        result = extractBlinkFrameResultFromLocalLandmarker(rawResult, video.videoWidth, video.videoHeight)
      }
      if (loopToken !== blinkLiveLoopTokenRef.current || !isRecordingBlinkCounterRef.current) return
      const elapsed = Math.min(BLINK_RECORDING_DURATION_SECONDS, (Date.now() - blinkRecordingStartedAtRef.current) / 1000)
      const tracking = updateBlinkTracking(blinkTrackingStateRef.current, result, elapsed)
      // The count is sampled at 20fps, while React only redraws four times/second
      // or when the count/tracking status changes.
      if (started - blinkLastUiUpdateRef.current >= 250 || tracking.totalBlinks !== blinkLastUiCountRef.current || tracking.faceFound !== blinkLastUiFaceRef.current) {
        blinkLastUiUpdateRef.current = started
        blinkLastUiCountRef.current = tracking.totalBlinks
        blinkLastUiFaceRef.current = tracking.faceFound
        setLiveBlinkMetrics({
          totalBlinks: tracking.totalBlinks,
          bpmOverall: Number(((tracking.totalBlinks / Math.max(1, elapsed)) * 60).toFixed(1)),
          faceFound: tracking.faceFound
        })
      }
    } catch (error) {
      if (!blinkLiveErrorShownRef.current && loopToken === blinkLiveLoopTokenRef.current) {
        blinkLiveErrorShownRef.current = true
        showToastMessage('Eye tracking paused. Keep your face in view, or use the simple calculator below.')
      }
    } finally {
      blinkLivePendingRequestRef.current = false
      if (loopToken === blinkLiveLoopTokenRef.current && isRecordingBlinkCounterRef.current) {
        const delay = Math.max(0, (isServerCameraMode ? 100 : BLINK_LIVE_ANALYSIS_INTERVAL_MS) - (performance.now() - started))
        blinkLiveAnalysisIntervalRef.current = setTimeout(() => analyzeBlinkFrameLive(loopToken), delay)
      }
    }
  }

  const finishBlinkSession = () => {
    if (!isRecordingBlinkCounterRef.current) return
    const duration = Math.min(BLINK_RECORDING_DURATION_SECONDS, Math.max(1, (Date.now() - blinkRecordingStartedAtRef.current) / 1000))
    const result = buildLocalBlinkResult(blinkTrackingStateRef.current, duration)
    blinkRecordingDurationRef.current = duration
    clearBlinkRecordingTimers()
    setIsRecordingBlinkCounter(false)
    setBlinkRecordingSecondsLeft(0)
    setBlinkCounterResult(result)
    const recorder = blinkRecorderRef.current
    if (recorder?.state !== 'inactive' && recorder?.state) recorder.stop()
    else blinkRecorderCleanupRef.current?.()
    localBlinkLandmarkerRef.current?.close?.()
    localBlinkLandmarkerRef.current = null
    showToastMessage(result.quality ? 'All done! Your blink count is ready.' : result.interpretation)
  }

  const handleStartBlinkRecording = async () => {
    if (isRecordingBlinkCounter || isAnalyzingBlinkCounter) return
    if (!cameraReady) {
      showToastMessage('Allow camera access to start, or try the simple calculator below.')
      return
    }
    setIsAnalyzingBlinkCounter(true)
    try {
      if (!isServerCameraMode) {
        showToastMessage('Getting the blink counter ready. This may take a moment the first time.')
        await ensureLocalBlinkLandmarker()
      }
      if (!isMountedRef.current || activeTestSectionRef.current !== 'blink-rate') return
      resetLiveBlinkMetrics()
      const sessionGeneration = ++blinkSessionGenerationRef.current
      setBlinkVideoFile(null)
      setBlinkCounterResult(null)
      blinkRecorderRef.current = null

      // Recording is optional: live analysis still works in browsers without a recorder.
      if (typeof MediaRecorder !== 'undefined') {
        let recordingStream = streamRef.current
        if (isServerCameraMode) {
          const image = backendBlinkStreamImageRef.current
          if (!image?.naturalWidth) throw new Error('Camera is still loading.')
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, BLINK_LIVE_CAPTURE_WIDTH / image.naturalWidth)
          canvas.width = Math.round(image.naturalWidth * scale)
          canvas.height = Math.round(image.naturalHeight * scale)
          const context = canvas.getContext('2d')
          if (context && canvas.captureStream) {
            const draw = () => context.drawImage(image, 0, 0, canvas.width, canvas.height)
            draw()
            const drawTimer = setInterval(draw, 50)
            recordingStream = canvas.captureStream(20)
            blinkRecorderCleanupRef.current = () => {
              clearInterval(drawTimer)
              recordingStream.getTracks().forEach((track) => track.stop())
              blinkRecorderCleanupRef.current = null
            }
          }
        }
        if (recordingStream) {
          const candidates = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4']
          const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type))
          try {
            const recorder = new MediaRecorder(recordingStream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 600000 })
            const chunks = []
            recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data) }
            recorder.onstop = () => {
              blinkRecorderCleanupRef.current?.()
              if (!isMountedRef.current || activeTestSectionRef.current !== 'blink-rate' || blinkSessionGenerationRef.current !== sessionGeneration || !chunks.length) return
              const actualType = recorder.mimeType || mimeType || 'video/webm'
              const extension = actualType.includes('mp4') ? 'mp4' : 'webm'
              setBlinkVideoFile(new File(chunks, `blink_session_${Date.now()}.${extension}`, { type: actualType }))
            }
            recorder.onerror = () => { blinkRecorderCleanupRef.current?.() }
            blinkRecorderRef.current = recorder
            recorder.start(1000)
          } catch {
            blinkRecorderCleanupRef.current?.()
          }
        }
      }
      blinkRecordingStartedAtRef.current = Date.now()
      blinkRecordingEndsAtRef.current = Date.now() + BLINK_RECORDING_DURATION_SECONDS * 1000
      blinkRecordingDurationRef.current = BLINK_RECORDING_DURATION_SECONDS
      isRecordingBlinkCounterRef.current = true
      setIsRecordingBlinkCounter(true)
      setBlinkRecordingSecondsLeft(BLINK_RECORDING_DURATION_SECONDS)
      blinkLiveLoopTokenRef.current += 1
      analyzeBlinkFrameLive(blinkLiveLoopTokenRef.current)
      blinkRecordingTimerRef.current = setInterval(() => {
        const remaining = Math.max(0, blinkRecordingEndsAtRef.current - Date.now())
        setBlinkRecordingSecondsLeft(Math.ceil(remaining / 1000))
        if (!remaining) finishBlinkSession()
      }, 250)
      blinkRecordingStopTimeoutRef.current = setTimeout(finishBlinkSession, BLINK_RECORDING_DURATION_SECONDS * 1000)
      showToastMessage('Look at the camera and blink normally. We will finish in 30 seconds.')
    } catch (error) {
      blinkRecorderCleanupRef.current?.()
      clearBlinkRecordingTimers()
      localBlinkLandmarkerRef.current?.close?.()
      localBlinkLandmarkerRef.current = null
      showToastMessage(error.message === 'Blink session was cancelled.' ? error.message : 'Camera counting could not start. You can still use the simple calculator below.')
    } finally {
      setIsAnalyzingBlinkCounter(false)
    }
  }

  const handleAnalyzeBlinkCounter = async () => {
    if (!blinkVideoFile || isRecordingBlinkCounter || isAnalyzingBlinkCounter) return
    try {
      setIsAnalyzingBlinkCounter(true)
      if (isGuestSession()) {
        const controller = new AbortController()
        blinkVideoAnalysisAbortRef.current = controller
        setBlinkVideoProgress(0)
        const { analyzeBlinkVideo } = await import('../features/blink/analyzeVideo.js')
        const result = await analyzeBlinkVideo(blinkVideoFile, {
          signal: controller.signal,
          onProgress: progress => { if (!controller.signal.aborted && isMountedRef.current) setBlinkVideoProgress(progress) }
        })
        if (controller.signal.aborted || !isMountedRef.current) return
        setBlinkCounterResult(result)
        showToastMessage(result.quality ? 'Your recording has been checked on your device.' : result.interpretation)
        return
      }
      const formData = new FormData()
      formData.append('video', blinkVideoFile)
      formData.append('session_duration_seconds', String(blinkRecordingDurationRef.current))
      const response = await axios.post(`${API_BASE_URL}/api/blink-counter/analyze`, formData, { timeout: 120000 })
      const result = response?.data?.result || {}
      setBlinkCounterResult({
        totalBlinks: result.total_blinks ?? 0, bpmOverall: result.bpm_overall,
        bpmFaceOnly: result.bpm_face_only, sessionDurationSeconds: result.session_duration_seconds,
        faceDetectedSeconds: result.face_detected_seconds, noFaceSeconds: result.no_face_seconds,
        analyzedDurationSeconds: result.analyzed_duration_seconds, blinkTimestamps: result.blink_timestamps || [],
        interpretation: result.interpretation, interpretationBand: result.interpretation_band,
        modelName: result.model_name, earThreshold: result.ear_threshold, minClosedFrames: result.min_closed_frames,
        sessionMode: result.session_mode, resolution: result.resolution, fps: result.fps, quality: result.quality
      })
      showToastMessage('Your recording has been checked again.')
    } catch (error) {
      if (error.name !== 'AbortError' && isMountedRef.current) showToastMessage(error?.response?.data?.error || error.message || 'Recording recheck is unavailable. Your on-device result is still shown.')
    } finally {
      blinkVideoAnalysisAbortRef.current = null
      if (isMountedRef.current) {
        setIsAnalyzingBlinkCounter(false)
        setBlinkVideoProgress(null)
      }
    }
  }

  const handleClearBlinkCounter = () => {
    blinkVideoAnalysisAbortRef.current?.abort()
    blinkSessionGenerationRef.current += 1
    const recorder = blinkRecorderRef.current
    if (recorder) {
      recorder.onstop = null
      recorder.ondataavailable = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    blinkRecorderRef.current = null
    blinkRecorderCleanupRef.current?.()
    clearBlinkRecordingTimers()
    localBlinkLandmarkerRef.current?.close?.()
    localBlinkLandmarkerRef.current = null
    resetLiveBlinkMetrics()
    setBlinkVideoFile(null)
    setBlinkCounterResult(null)
    setIsRecordingBlinkCounter(false)
    setBlinkRecordingSecondsLeft(BLINK_RECORDING_DURATION_SECONDS)
    showToastMessage('Ready for a new blink count.')
  }

  const handleManualBlinkCalculation = (count, duration) => {
    if (isRecordingBlinkCounter || isAnalyzingBlinkCounter) return
    const bpm = Number(((count / duration) * 60).toFixed(1))
    setBlinkCounterResult({
      totalBlinks: count, bpmOverall: bpm, bpmFaceOnly: null,
      sessionDurationSeconds: duration, analyzedDurationSeconds: duration,
      faceDetectedSeconds: null, noFaceSeconds: null, blinkTimestamps: [],
      interpretation: `${bpm} blinks per minute, calculated from your count.`,
      interpretationBand: 'MANUAL', modelName: 'Manual calculator', sessionMode: 'manual', quality: true
    })
    showToastMessage('Your blink rate is ready.')
  }

  const handleBlinkVideoUpload = (file) => {
    if (isRecordingBlinkCounter || isAnalyzingBlinkCounter) return
    if (!/^video\/(mp4|webm|quicktime)$/.test(file.type) && !/\.(mp4|webm|mov)$/i.test(file.name)) {
      showToastMessage('Choose an MP4, WebM or MOV recording.')
      return
    }
    if (!file.size || file.size > 32 * 1024 * 1024) {
      showToastMessage('Choose a recording smaller than 32 MB.')
      return
    }
    setBlinkVideoFile(file)
    setBlinkCounterResult(null)
    showToastMessage('Recording ready. Select Analyze recording to see your result.')
  }

  const handleDeqResponseChange = (index, value) => {
    setDeqResponses((previousResponses) => previousResponses.map((entry, responseIndex) => (
      responseIndex === index ? Number(value) : entry
    )))
  }

  const handleOsdiResponseChange = (index, value) => {
    setOsdiResponses((previousResponses) => previousResponses.map((entry, responseIndex) => (
      responseIndex === index ? String(value) : entry
    )))
  }

  const handleContrastTestNameChange = (value) => {
    setContrastSensitivity((previousValue) => ({
      ...previousValue,
      testName: value
    }))
  }

  const handleContrastValueChange = (rowKey, columnKey, value) => {
    setContrastSensitivity((previousValue) => ({
      ...previousValue,
      rows: {
        ...previousValue.rows,
        [rowKey]: {
          ...previousValue.rows[rowKey],
          [columnKey]: value
        }
      }
    }))
  }

  const handlePosteriorSegmentChange = (eye, field, value) => {
    setPosteriorSegment((previousValue) => ({
      ...previousValue,
      [eye]: {
        ...previousValue[eye],
        [field]: value
      }
    }))
  }

  const buildReportPdfDocument = async () => {
    const { jsPDF } = await loadJsPdfModule()
    const documentPdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = documentPdf.internal.pageSize.getWidth()
    const pageHeight = documentPdf.internal.pageSize.getHeight()
    const margin = 14
    const sectionGap = 8
    const contentWidth = pageWidth - margin * 2
    const panelFill = [244, 245, 247]
    const borderColor = [221, 226, 232]
    const doctorName = getAuthUser()
    let currentY = 18

    const ensureSpace = (requiredHeight) => {
      if (currentY + requiredHeight > pageHeight - margin) {
        documentPdf.addPage()
        currentY = margin
      }
    }

    const drawTextBlock = (text, x, y, width, fontSize = 10, lineHeight = 4.2) => {
      const safeText = text && text.trim() ? text : 'No analysis provided.'
      documentPdf.setFontSize(fontSize)
      const wrapped = documentPdf.splitTextToSize(safeText, width)
      documentPdf.text(wrapped, x, y)
      return wrapped.length * lineHeight
    }

    const drawPanel = (x, y, width, height, radius = 3) => {
      documentPdf.setFillColor(...panelFill)
      documentPdf.setDrawColor(...borderColor)
      documentPdf.roundedRect(x, y, width, height, radius, radius, 'FD')
    }

    const drawLabelValue = (x, y, label, value) => {
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(label, x, y)
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.text(String(value || 'N/A'), x, y + 7)
    }

    const drawGauge = (x, y, width, score, options = {}) => {
      const { reverse = false, valueColor = [214, 143, 0] } = options
      const clampedScore = Math.max(0, Math.min(100, Number(score || 0)))
      const segmentWidth = width / 4
      const colors = [
        [132, 204, 22],
        [250, 204, 21],
        [249, 115, 22],
        [255, 59, 0]
      ]

      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(9)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(reverse ? '100 80 60 40 20 0' : '0 20 40 60 80 100', x, y - 4)

      colors.forEach((color, index) => {
        documentPdf.setFillColor(...color)
        documentPdf.roundedRect(x + segmentWidth * index, y, segmentWidth, 6, 1.3, 1.3, 'F')
      })

      const markerX = reverse
        ? x + (width * (100 - clampedScore)) / 100
        : x + (width * clampedScore) / 100
      documentPdf.setDrawColor(0, 0, 0)
      documentPdf.setLineWidth(0.8)
      documentPdf.setFillColor(34, 34, 34)
      documentPdf.triangle(markerX, y - 1, markerX - 2, y + 5.5, markerX + 2, y + 5.5, 'F')

      documentPdf.setFontSize(11)
      documentPdf.setTextColor(...valueColor)
      documentPdf.text(`${Math.round(clampedScore)} (%)`, x + width / 2, y + 14, { align: 'center' })
    }

    const drawImageSlot = (x, y, width, height, dataUrl, label) => {
      documentPdf.setDrawColor(180, 190, 205)
      documentPdf.roundedRect(x, y, width, height, 2, 2)

      if (dataUrl) {
        try {
          const format = dataUrl.includes('image/jpeg') ? 'JPEG' : 'PNG'
          documentPdf.addImage(dataUrl, format, x + 1, y + 1, width - 2, height - 2, undefined, 'FAST')
        } catch (error) {
          documentPdf.setFontSize(9)
          documentPdf.setTextColor(120, 120, 120)
          documentPdf.text('Image error', x + width / 2, y + height / 2, { align: 'center' })
        }
      } else {
        documentPdf.setFontSize(9)
        documentPdf.setTextColor(120, 120, 120)
        documentPdf.text('No image', x + width / 2, y + height / 2, { align: 'center' })
      }

      documentPdf.setFontSize(9)
      documentPdf.setTextColor(55, 65, 81)
      documentPdf.text(label, x + width / 2, y + height + 5, { align: 'center' })
    }

    const drawEyeImageColumn = (x, y, prefix, title) => {
      const columnWidth = (contentWidth - 16) / 2
      const slotWidth = (columnWidth - 6) / 2
      const slotHeight = 33

      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(11)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(title, x + columnWidth / 2, y, { align: 'center' })

      drawImageSlot(x, y + 6, slotWidth, slotHeight, images[`${prefix}_Upper`], 'Upper')
      drawImageSlot(x + slotWidth + 6, y + 6, slotWidth, slotHeight, images[`${prefix}_Lower`], 'Lower')
      return slotHeight + 16
    }

    const drawDualGaugeSection = (title, leftValue, rightValue, options = {}) => {
      ensureSpace(40)
      drawPanel(margin + 12, currentY, contentWidth - 24, 34)
      const gaugeWidth = 44
      drawGauge(margin + 20, currentY + 14, gaugeWidth, leftValue, options)
      drawGauge(pageWidth - margin - 20 - gaugeWidth, currentY + 14, gaugeWidth, rightValue, options)
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(title, pageWidth / 2, currentY + 20, { align: 'center' })
      currentY += 42
    }

    const drawDualValueSection = (title, leftValue, rightValue) => {
      ensureSpace(36)
      drawPanel(margin + 12, currentY, contentWidth - 24, 30)
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(title, pageWidth / 2, currentY + 10, { align: 'center' })

      documentPdf.setFontSize(10)
      documentPdf.setTextColor(99, 115, 129)
      documentPdf.text('Left Eye', margin + 24, currentY + 21)
      documentPdf.text('Right Eye', pageWidth - margin - 24, currentY + 21, { align: 'right' })

      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(13)
      documentPdf.setTextColor(31, 78, 121)
      documentPdf.text(leftValue, margin + 24, currentY + 27)
      documentPdf.text(rightValue, pageWidth - margin - 24, currentY + 27, { align: 'right' })
      currentY += 38
    }

    const drawSingleValueSection = (title, value) => {
      ensureSpace(30)
      drawPanel(margin + 12, currentY, contentWidth - 24, 24)
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(title, pageWidth / 2, currentY + 9, { align: 'center' })
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(13)
      documentPdf.setTextColor(31, 78, 121)
      documentPdf.text(String(value || 'Not recorded'), pageWidth / 2, currentY + 18, { align: 'center' })
      currentY += 32
    }

    const drawDeqSection = (averageScore, deqScore) => {
      ensureSpace(36)
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(140, 140, 140)
      documentPdf.text('DEQ Report', margin + 12, currentY)
      currentY += 8

      documentPdf.setFillColor(225, 232, 255)
      documentPdf.setDrawColor(214, 220, 245)
      documentPdf.roundedRect(margin + 12, currentY, contentWidth - 24, 26, 2, 2, 'FD')
      documentPdf.setFontSize(12)
      documentPdf.text('Average DEQ Score', pageWidth / 2 - 30, currentY + 10, { align: 'center' })
      documentPdf.text('DEQ Score', pageWidth / 2 + 30, currentY + 10, { align: 'center' })
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(16)
      documentPdf.setTextColor(67, 97, 238)
      documentPdf.text(String(averageScore), pageWidth / 2 - 30, currentY + 21, { align: 'center' })
      documentPdf.text(String(deqScore), pageWidth / 2 + 30, currentY + 21, { align: 'center' })
      currentY += 34
    }

    const drawOsdiSection = (score, band) => {
      ensureSpace(36)
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(140, 140, 140)
      documentPdf.text('OSDI Report', margin + 12, currentY)
      currentY += 8

      documentPdf.setFillColor(241, 245, 249)
      documentPdf.setDrawColor(214, 220, 245)
      documentPdf.roundedRect(margin + 12, currentY, contentWidth - 24, 26, 2, 2, 'FD')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text('OSDI Score', pageWidth / 2 - 30, currentY + 10, { align: 'center' })
      documentPdf.text('Interpretation', pageWidth / 2 + 30, currentY + 10, { align: 'center' })
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(16)
      documentPdf.setTextColor(31, 111, 139)
      documentPdf.text(String(score), pageWidth / 2 - 30, currentY + 21, { align: 'center' })
      documentPdf.text(String(band), pageWidth / 2 + 30, currentY + 21, { align: 'center' })
      currentY += 34
    }

    const drawContrastSection = () => {
      ensureSpace(94)
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(13)
      documentPdf.setTextColor(140, 140, 140)
      documentPdf.text(`Contrast Sensitivity ( ${contrastSummary.test_name || 'GLAUCOMA'} )`, margin + 10, currentY)
      currentY += 8

      documentPdf.setFillColor(225, 232, 255)
      documentPdf.setDrawColor(214, 220, 245)
      documentPdf.roundedRect(margin + 10, currentY, contentWidth - 20, 24, 2, 2, 'FD')

      const leftCenter = margin + 48
      const rightCenter = pageWidth - margin - 48
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text('OD AULCSF', leftCenter, currentY + 8, { align: 'center' })
      documentPdf.text('OS AULCSF', rightCenter, currentY + 8, { align: 'center' })
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(11)
      documentPdf.setTextColor(132, 132, 132)
      documentPdf.text('Pre-op', leftCenter - 12, currentY + 16, { align: 'center' })
      documentPdf.text('Post-op', leftCenter + 12, currentY + 16, { align: 'center' })
      documentPdf.text('Pre-op', rightCenter - 12, currentY + 16, { align: 'center' })
      documentPdf.text('Post-op', rightCenter + 12, currentY + 16, { align: 'center' })
      documentPdf.setFont('helvetica', 'bold')
      documentPdf.setTextColor(67, 97, 238)
      documentPdf.text(String(contrastSummary.rows?.od_pre?.aulcsf ?? '0'), leftCenter - 12, currentY + 22, { align: 'center' })
      documentPdf.text(String(contrastSummary.rows?.od_post?.aulcsf ?? '0'), leftCenter + 12, currentY + 22, { align: 'center' })
      documentPdf.text(String(contrastSummary.rows?.os_pre?.aulcsf ?? '0'), rightCenter - 12, currentY + 22, { align: 'center' })
      documentPdf.text(String(contrastSummary.rows?.os_post?.aulcsf ?? '0'), rightCenter + 12, currentY + 22, { align: 'center' })
      currentY += 30

      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(11)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text('Ages 20–55', margin + 18, currentY + 5)
      documentPdf.text('Ages 56–75', margin + 58, currentY + 5)
      documentPdf.text('Pre-op', margin + 110, currentY + 5)
      documentPdf.text('Post-op', margin + 145, currentY + 5)
      documentPdf.setDrawColor(200, 205, 214)
      for (let offset = 0; offset < 8; offset += 1) {
        documentPdf.line(margin + 4 + offset, currentY - 3, margin + 4 + offset, currentY + 7)
      }
      documentPdf.setFillColor(218, 224, 240)
      documentPdf.rect(margin + 47, currentY - 3, 8, 10, 'F')
      documentPdf.setDrawColor(67, 97, 238)
      documentPdf.setLineDashPattern([1, 1], 0)
      documentPdf.line(margin + 98, currentY + 2, margin + 108, currentY + 2)
      documentPdf.setLineDashPattern([], 0)
      documentPdf.setLineWidth(1.2)
      documentPdf.line(margin + 133, currentY + 2, margin + 143, currentY + 2)

      const chartX = margin + 10
      const chartY = currentY + 12
      const chartWidth = contentWidth - 20
      const chartHeight = 46
      documentPdf.setFillColor(249, 250, 252)
      documentPdf.setDrawColor(230, 233, 239)
      documentPdf.rect(chartX, chartY, chartWidth, chartHeight, 'FD')
      documentPdf.setFillColor(228, 233, 245)
      documentPdf.setDrawColor(228, 233, 245)
      documentPdf.triangle(chartX + 12, chartY + 34, chartX + chartWidth / 2, chartY + 16, chartX + chartWidth - 12, chartY + 34, 'F')

      documentPdf.setDrawColor(200, 205, 214)
      for (let offset = 0; offset <= 6; offset += 1) {
        const lineX = chartX + 12 + offset * 9
        documentPdf.line(lineX, chartY + 4, lineX, chartY + 34)
      }
      documentPdf.setDrawColor(55, 55, 55)
      documentPdf.line(chartX + 12, chartY + 38, chartX + chartWidth - 12, chartY + 38)
      const tickMarks = ['3', '6', '12', '18']
      tickMarks.forEach((tick, index) => {
        const tickX = chartX + 20 + index * 28
        documentPdf.line(tickX, chartY + 36, tickX, chartY + 40)
        documentPdf.setFontSize(10)
        documentPdf.text(tick, tickX, chartY + 44, { align: 'center' })
      })
      ;['A', 'B', 'C', 'D'].forEach((label, index) => {
        const pointX = chartX + 20 + index * 28
        const pointY = [chartY + 32, chartY + 26, chartY + 30, chartY + 34][index]
        documentPdf.setFillColor(67, 97, 238)
        documentPdf.circle(pointX, pointY, 3, 'F')
        documentPdf.setTextColor(255, 255, 255)
        documentPdf.setFontSize(8)
        documentPdf.text(label, pointX, pointY + 1, { align: 'center' })
      })
      documentPdf.setTextColor(140, 140, 140)
      documentPdf.setFontSize(9)
      documentPdf.text('Spatial Frequency (Cycles / Degree)', chartX + chartWidth / 2, chartY + chartHeight - 6, { align: 'center' })
      currentY += 64
    }

    const drawPosteriorSegmentSection = (leftPosterior, rightPosterior) => {
      const leftText = `Left Eye: ${leftPosterior.impression}\n${leftPosterior.report || 'No report recorded.'}\n${leftPosterior.recommendation || 'No recommendation recorded.'}`
      const rightText = `Right Eye: ${rightPosterior.impression}\n${rightPosterior.report || 'No report recorded.'}\n${rightPosterior.recommendation || 'No recommendation recorded.'}`
      const sectionWidth = contentWidth - 24
      const textWidth = sectionWidth - 12
      const leftLines = documentPdf.splitTextToSize(leftText, textWidth)
      const rightLines = documentPdf.splitTextToSize(rightText, textWidth)
      const leftHeight = Math.max(24, 12 + leftLines.length * 4)
      const rightHeight = Math.max(24, 12 + rightLines.length * 4)

      ensureSpace(leftHeight + rightHeight + 14)
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(12)
      documentPdf.setTextColor(140, 140, 140)
      documentPdf.text('Posterior Segment', margin + 12, currentY)
      currentY += 8

      drawPanel(margin + 12, currentY, sectionWidth, leftHeight)
      documentPdf.setFont('helvetica', 'normal')
      documentPdf.setFontSize(10)
      documentPdf.setTextColor(0, 0, 0)
      documentPdf.text(leftLines, margin + 18, currentY + 10)
      currentY += leftHeight + 6

      drawPanel(margin + 12, currentY, sectionWidth, rightHeight)
      documentPdf.text(rightLines, margin + 18, currentY + 10)
      currentY += rightHeight + 8
    }

    const now = new Date()
    const tearMeniscusValues = {
      left: Number(tearMeasurements.left?.tmhMm || 0),
      right: Number(tearMeasurements.right?.tmhMm || 0)
    }
    const hasValidBlinkResult = blinkCounterResult?.bpmOverall != null && blinkCounterResult?.quality !== false
    const blinkRate = Number(blinkCounterResult?.bpmOverall)
    const totalBlinkCount = Number(blinkCounterResult?.totalBlinks || 0)
    const deqSummary = clinicalResults.deq || summarizeDeqResponses(deqResponses)
    const osdiSummary = clinicalResults.osdi || summarizeOsdiResponses(osdiResponses, osdiDuration, osdiComments)
    const contrastSummary = clinicalResults.contrast || summarizeContrastSensitivity(contrastSensitivity)
    const posteriorSummary = clinicalResults.posterior || summarizePosteriorSegment(posteriorSegment)
    const bulbarRednessLabel = getBulbarRednessLabel(selectedBulbarRednessId) || 'Not recorded'
    const formattedDate = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(now).replace(/\//g, '-')
    const formattedTime = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(now)
    const patientName = selectedPatientData?.full_name || 'Not selected'
    const patientSex = String(selectedPatientData?.gender || 'N/A').toUpperCase()

    documentPdf.setFont('helvetica', 'bold')
    documentPdf.setFontSize(17)
    documentPdf.setTextColor(0, 0, 0)
    documentPdf.text('COMPREHENSIVE REPORT', pageWidth / 2, currentY, { align: 'center' })
    currentY += 10

    ensureSpace(64)
    drawPanel(margin + 12, currentY, contentWidth - 24, 58)
    drawLabelValue(margin + 20, currentY + 12, 'Patient Name', patientName)
    drawLabelValue(pageWidth / 2 + 2, currentY + 12, 'Doctor Name', doctorName)
    drawLabelValue(margin + 20, currentY + 30, 'Sex', patientSex)
    drawLabelValue(pageWidth / 2 + 2, currentY + 30, 'Date', formattedDate)
    drawLabelValue(margin + 20, currentY + 48, 'Time', formattedTime)
    currentY += 68

    ensureSpace(24)
    drawPanel(margin + 12, currentY, contentWidth - 24, 18)
    documentPdf.setFont('helvetica', 'normal')
    documentPdf.setFontSize(12)
    documentPdf.text('Left Eye (O.S)', margin + 24, currentY + 11)
    documentPdf.text('Right Eye (O.D)', pageWidth - margin - 24, currentY + 11, { align: 'right' })
    currentY += 26

    ensureSpace(32)
    drawPanel(margin + 12, currentY, contentWidth - 24, 26)
    documentPdf.setFont('helvetica', 'bold')
    documentPdf.setFontSize(13)
    documentPdf.setTextColor(0, 0, 0)
    documentPdf.text('Meibography Images', pageWidth / 2, currentY + 16, { align: 'center' })
    currentY += 34

    ensureSpace(62)
    drawPanel(margin + 12, currentY, contentWidth - 24, 56)
    const leftColumnX = margin + 18
    const rightColumnX = pageWidth / 2 + 4
    drawEyeImageColumn(leftColumnX, currentY + 9, 'L', 'Left Eye (O.S)')
    drawEyeImageColumn(rightColumnX, currentY + 9, 'R', 'Right Eye (O.D)')
    currentY += 64

    drawDualValueSection(
      'Tear Meniscus',
      tearMeasurements.left ? `${tearMeniscusValues.left.toFixed(2)} mm` : 'Not measured',
      tearMeasurements.right ? `${tearMeniscusValues.right.toFixed(2)} mm` : 'Not measured'
    )
    for (const eye of ['left', 'right']) {
      for (const lid of ['upper', 'lower']) {
        const result = meibographyResults[getImageKey(eye, lid)]
        if (result) drawSingleValueSection(`Meibography - ${eye} ${lid}`, `Coverage ${Number(result.coveragePct).toFixed(1)}% | Dropout ${Number(result.dropoutPct).toFixed(1)}% | ${result.grade}`)
      }
    }
    drawSingleValueSection('Blink Rate (whole session)', hasValidBlinkResult ? `${blinkRate.toFixed(1)} blinks/min` : 'Not measured')
    drawSingleValueSection('Total Blinks', hasValidBlinkResult ? String(totalBlinkCount) : 'Not recorded')
    if (hasValidBlinkResult) drawSingleValueSection('Blink Counting Method', blinkCounterResult.sessionMode === 'manual' ? 'Manual count' : 'Camera count')
    drawSingleValueSection('Bulbar Redness Analysis', bulbarRednessLabel)
    const completed = buildCompletedTests()
    if (completed.includes(TEST_SECTION_LABELS.deq)) drawDeqSection(deqSummary.average_score, deqSummary.total_score)
    else drawSingleValueSection('DEQ', 'Not completed')
    if (completed.includes(TEST_SECTION_LABELS.osdi)) drawOsdiSection(osdiSummary.osdi_score, osdiSummary.interpretation)
    else drawSingleValueSection('OSDI', 'Not completed')
    if (completed.includes(TEST_SECTION_LABELS['contrast-sensitivity'])) drawContrastSection()
    else drawSingleValueSection('Contrast Sensitivity', 'Not recorded')
    if (completed.includes(TEST_SECTION_LABELS['posterior-segment'])) drawPosteriorSegmentSection(posteriorSummary.left, posteriorSummary.right)
    else drawSingleValueSection('Posterior Segment', 'Not recorded')

    if (isGuestSession()) {
      for (let page = 1; page <= documentPdf.getNumberOfPages(); page += 1) {
        documentPdf.setPage(page)
        documentPdf.setFont('helvetica', 'bold')
        documentPdf.setFontSize(9)
        documentPdf.setTextColor(120, 95, 50)
        documentPdf.text('GUEST SESSION - TEST RESULTS AND USER-ENTERED MEASUREMENTS', pageWidth / 2, documentPdf.internal.pageSize.getHeight() - 6, { align: 'center' })
      }
    }

    const safeStamp = now.toISOString().replace(/[:.]/g, '-')
    return { documentPdf, safeStamp }
  }

  const handleDownloadReport = async () => {
    try {
      if (['deq', 'osdi', 'posterior-segment'].includes(activeTestSection)) submittedTestSectionsRef.current.add(activeTestSection)
      const { documentPdf, safeStamp } = await buildReportPdfDocument()
      documentPdf.save(`meibography-report-${safeStamp}.pdf`)
      showToastMessage('PDF report downloaded.')
    } catch (error) {
      console.error('Download report error:', error)
      showToastMessage(error?.message || 'Failed to generate PDF report.')
    }
  }

  const handleSaveReport = async () => {
    if (!selectedPatient) {
      showToastMessage('Select a patient before saving report.')
      return
    }

    try {
      setIsSavingReport(true)
      if (['deq', 'osdi', 'posterior-segment'].includes(activeTestSection)) submittedTestSectionsRef.current.add(activeTestSection)
      const savedAssessment = await syncAssessment({ silent: false })
      const reportAssessmentPayload = buildAssessmentPayload()
      if (hasPersistableAssessmentData(reportAssessmentPayload) && !savedAssessment) {
        showToastMessage('Save patient test data before generating the report.')
        return
      }
      const { documentPdf, safeStamp } = await buildReportPdfDocument()
      const pdfBlob = documentPdf.output('blob')
      const formData = new FormData()
      formData.append('patient_id', selectedPatient)
      formData.append('left_analysis', reportAssessmentPayload.left_analysis)
      formData.append('right_analysis', reportAssessmentPayload.right_analysis)
      formData.append('session_data', JSON.stringify(reportAssessmentPayload.session_data))
      formData.append('completed_tests', JSON.stringify(reportAssessmentPayload.completed_tests))
      if (savedAssessment?.id) {
        formData.append('assessment_id', String(savedAssessment.id))
      }
      formData.append('kind', 'report')
      formData.append('file', pdfBlob, `meibography-report-${safeStamp}.pdf`)

      await axios.post(buildApiUrl('/api/results'), formData)

      if (savedAssessment?.id) {
        setAssessmentId(savedAssessment.id)
      }
      setAssessmentStatus('reported')
      lastSyncedAssessmentFingerprintRef.current = buildAssessmentFingerprint(reportAssessmentPayload)
      showToastMessage('Report saved to dashboard.')
    } catch (error) {
      console.error('Save report error:', error)
      const errorMessage = error?.response?.data?.error || error?.message || 'Failed to save report.'
      showToastMessage(errorMessage)
    } finally {
      setIsSavingReport(false)
    }
  }

  const showToastMessage = (message) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current)
    }

    setToastMessage(message)
    setShowToast(true)
    toastTimeoutRef.current = setTimeout(() => {
      setShowToast(false)
    }, 3000)
  }

  const openAnalysisPreviewModal = (item) => {
    if (!item?.image) {
      return
    }

    setAnalysisPreviewModal({
      title: item.title || 'Preview',
      image: item.image
    })
  }

  const closeAnalysisPreviewModal = () => {
    setAnalysisPreviewModal(null)
  }

  const handleSelectEye = (nextEye) => {
    cancelMeibographyPlayback()
    resetMeibographyWorkflow()
    setCurrentEye(nextEye)
  }

  const handleSelectLid = (nextLid) => {
    cancelMeibographyPlayback()
    resetMeibographyWorkflow()
    setCurrentLid(nextLid)
  }

  const selectedPatientData = patients.find((patient) => patient.id === parseInt(selectedPatient, 10))
  const toCssFilterPercent = (value) => Math.max(0, Math.min(200, Math.round(Number(value || 0) * 2)))
  const previewFilter = `brightness(${toCssFilterPercent(brightness)}%) contrast(${toCssFilterPercent(contrast)}%)`

  const currentImageKey = getImageKey(currentEye, currentLid)
  const currentMeibographyResult = meibographyResults[currentImageKey] || null
  const isAutoEnhancementComplete = Boolean(
    pendingUploadContext?.enhancementStatus === 'complete' &&
    isImageData(pendingUploadContext?.sourceImageData)
  )
  const canStartMeibographyAnalysis = Boolean(
    reviewSnapshot && pendingUploadContext && !isAnalyzingMeibography &&
    (isAutoEnhancementComplete || pendingUploadContext.enhancementStatus === 'failed')
  )
  const currentTearMeasurement = tearMeasurements[currentEye]
  const tearOverlayPoints = isTearMeasureMode
    ? tearMeasurementDraftPoints
    : (currentTearMeasurement ? [currentTearMeasurement.topPoint, currentTearMeasurement.bottomPoint] : [])
  const isTearReviewActive = activeTestSection === 'tear-meniscus' && Boolean(reviewSnapshot)
  const reviewStageZoom = isTearReviewActive ? tearReviewZoom : 1
  const showMeasuredTearIndicator = Boolean(!isTearMeasureMode && currentTearMeasurement && tearOverlayPoints.length === 2)
  const shouldShowEyeSelectorOverlay = !reviewSnapshot || !pendingUploadContext
  const shouldRenderOverlay = Boolean(
    reviewSnapshot &&
    (
      isAnnotateMode ||
      isTearReviewActive
    )
  )
  const leftEyeStatus = images.L_Upper && images.L_Lower ? 'completed' : 'pending'
  const rightEyeStatus = images.R_Upper && images.R_Lower ? 'completed' : 'pending'
  const canUndoImage = imageState.undoStack.length > 0
  const canRedoImage = imageState.redoStack.length > 0
  const canResetImage = Boolean(images[currentImageKey])
  const authUser = getAuthUser()
  const isAdditionalTestSection = ADDITIONAL_TEST_SECTIONS.includes(activeTestSection)
  const deqSummary = clinicalResults.deq || summarizeDeqResponses(deqResponses)
  const osdiSummary = clinicalResults.osdi || summarizeOsdiResponses(osdiResponses, osdiDuration, osdiComments)
  const contrastSummary = clinicalResults.contrast || summarizeContrastSensitivity(contrastSensitivity)
  const posteriorSummary = clinicalResults.posterior || summarizePosteriorSegment(posteriorSegment)
  const activePosteriorSummary = posteriorSummary[currentEye] || { impression: 'Normal', report: '', recommendation: '', summary: '' }
  const activePreviewKeys = meibographyWorkflow.visiblePreviewKeys
  const meibographyPreviewItems = (
    [
      {
        key: 'source',
        title: 'Original',
        image: pendingUploadContext?.originalImageData || currentMeibographyResult?.sourceImage || ''
      },
      {
        key: 'eyelid',
        title: 'Eyelid',
        image: currentMeibographyResult?.eyelidBoundaryImage || ''
      },
      {
        key: 'meibo',
        title: 'Glands',
        image: currentMeibographyResult?.meibomianEvaluationImage || ''
      }
    ]
  )
    .filter((item) => activePreviewKeys.includes(item.key) && Boolean(item.image))
  const getMeibographyPreviewCardState = (key) => {
    switch (meibographyWorkflow.stage) {
      case 'detecting-eyelid':
        return key === 'source' ? 'is-active' : 'is-pending'
      case 'detecting-glands':
        if (key === 'source') return 'is-complete'
        return key === 'eyelid' ? 'is-active' : 'is-pending'
      case 'analyzing-results':
        if (key === 'meibo') return 'is-active'
        return 'is-complete'
      case 'complete':
      case 'ready':
        return 'is-complete'
      default:
        return key === 'source' ? 'is-active' : 'is-pending'
    }
  }
  const getMeibographyPreviewCardLabel = (key) => {
    const state = getMeibographyPreviewCardState(key)
    if (state === 'is-active') {
      return 'Processing'
    }
    if (state === 'is-complete') {
      return 'Ready'
    }
    return 'Waiting'
  }
  const tearMeniscusPreviewItems = [
    currentTearMeasurement?.annotatedImage
      ? {
          key: 'tear-overlay',
          title: 'Measurement Overlay',
          image: currentTearMeasurement.annotatedImage
        }
      : null,
    currentTearMeasurement?.diagramImage
      ? {
          key: 'tear-diagram',
          title: 'Clinical Diagram',
          image: currentTearMeasurement.diagramImage
        }
      : null
  ].filter(Boolean)
  const analyzeMeibographyButtonLabel = (() => {
    if (pendingUploadContext?.enhancementStatus === 'failed') {
      return 'Retry auto-enhance'
    }
    if (pendingUploadContext?.enhancementStatus === 'pending') {
      return meibographyWorkflow.stage === 'auto-enhancing' ? 'Auto-enhancing...' : 'Auto-enhance required'
    }
    if (!isAutoEnhancementComplete) {
      return 'Auto-enhance required'
    }
    if (meibographyWorkflow.stage === 'complete') {
      return 'Analysis ready'
    }
    if (meibographyWorkflow.stage === 'detecting-eyelid') {
      return 'Detecting eyelid...'
    }
    if (meibographyWorkflow.stage === 'detecting-glands') {
      return 'Detecting glands...'
    }
    if (meibographyWorkflow.stage === 'analyzing-results') {
      return 'Calculating analysis...'
    }
    if (isAnalyzingMeibography) {
      return 'Analyzing...'
    }
    return 'Analyze'
  })()
  const completedTestLabels = buildCompletedTests()
  const busyTitle = isSavingReport ? 'Saving your report' : isAnalyzingMeibography ? 'Analyzing your eyelid image' : isMeasuringTearMeniscus ? 'Measuring your tear markers' : (isManualImageProcessing || meibographyWorkflow.stage === 'auto-enhancing') ? 'Preparing your image' : isAnalyzingBlinkCounter ? (blinkVideoProgress === null ? 'Preparing your blink results' : `Checking your recording · ${blinkVideoProgress}%`) : isStartingCamera ? 'Opening your camera' : ''
  return (
    <div data-section={activeTestSection} className={`meibography-container ${isAdditionalTestSection ? 'meibography-container-no-side-panel' : ''}`}>
      <div className="meibography-sidebar">
        <div className="meibography-header">
          <div className="meibography-header-title">
            <button
              type="button"
              className="meibography-back-button"
              onClick={() => navigate(patientId ? `/patients/${patientId}` : '/tools')}
              aria-label="Back to eye tests"
            >
              <ChevronLeft className="meibography-back-btn" />
            </button>
            <div className="meibography-header-copy">
              <h1 className="meibography-title">Eye tests</h1>
            </div>
          </div>

          <div className="meibography-patient-section">
            <div className="meibography-patient-label">
              <label htmlFor="patient-select" className="meibography-patient-label-text">Choose a person</label>
              <Link to="/patients/new" className="meibography-add-patient-link">Add a person</Link>
            </div>
            <select
              id="patient-select"
              value={selectedPatient}
              onChange={(event) => setSelectedPatient(event.target.value)}
              className="meibography-patient-select"
            >
              <option value="">Select a patient</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.full_name} - {patient.mobile}
                </option>
              ))}
            </select>
          </div>

          {selectedPatientData && (
            <div className="meibography-patient-card">
              <div className="meibography-patient-avatar">
                {selectedPatientData.full_name.charAt(0)}
              </div>
              <div className="meibography-patient-info">
                <div className="meibography-patient-name">{selectedPatientData.full_name}</div>
                <div className="meibography-patient-details">
                  {selectedPatientData.age}/{selectedPatientData.gender}
                </div>
              </div>
            </div>
          )}
        </div>

        <nav className="meibography-nav">
          <ul className="meibography-nav-list">
            {TEST_CATALOG.map(test => <li key={test.id} className="meibography-nav-item">
              <button type="button" className={`meibography-nav-link meibography-nav-button ${activeTestSection === test.id ? 'active' : ''}`} aria-current={activeTestSection === test.id ? 'page' : undefined} onClick={() => handleSectionChange(test.id, { forceLowerLid: test.id === 'tear-meniscus' })}>
                <test.icon size={17} strokeWidth={1.7} aria-hidden="true" />
                <span>{test.title}<small className="exam-nav-description">{test.clinical}</small></span>
                {completedTestLabels.includes(TEST_SECTION_LABELS[test.id]) && <Check className="exam-nav-completed" size={15} aria-label="Result ready" />}
              </button>
            </li>)}
          </ul>
        </nav>
      </div>

      <div className="meibography-main">
        <div className="meibography-top-header">
          <div className="meibography-brand">
            <img src={eyeLogo} alt="Meibography logo" className="meibography-logo" />
            <div className="meibography-brand-copy">
              <Link to="/tools" className="meibography-brand-chip">MeiboPix · All eye tests</Link>
            </div>
          </div>
          <div className="meibography-user-section">
            <Bell className="meibography-bell-icon" />
            <div className="meibography-user-avatar">{authUser.charAt(0).toUpperCase()}</div>
            <span className="meibography-greeting">Hello, {authUser}</span>
          </div>
        </div>

        <section className="exam-guide" aria-label="How to use this test">
          <div className="exam-guide-top"><div><span className="exam-kicker">YOUR EYE CARE SESSION</span><h2>{TEST_CATALOG.find(test => test.id === activeTestSection)?.title}</h2><p>{TEST_CATALOG.find(test => test.id === activeTestSection)?.description}</p></div>{isGuestSession() && <span className="exam-demo-label">Guest session · All 8 tests</span>}</div>
          <ol>{TEST_CATALOG.find(test => test.id === activeTestSection)?.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
          <div className="exam-session-status"><span><span className={`exam-status-dot ${completedTestLabels.length ? 'has-results' : ''}`} />{completedTestLabels.length ? `${completedTestLabels.length} of 8 test results ready` : 'Ready for your first result'}</span><Link to="/tests"><FileText size={14} />View saved results</Link></div>
        </section>
        {busyTitle && <LoadingState compact title={busyTitle} detail={isAnalyzingMeibography ? 'Results appear as soon as analysis finishes.' : 'Keep this session open while this step finishes.'} />}

        {activeTestSection === 'meibography' && <SampleImagesGallery onLoad={handleLoadSampleImage} activeSampleId={reviewSnapshot ? loadedSample?.id : null} busy={isManualImageProcessing || isAnalyzingMeibography} />}

        {activeTestSection === 'blink-rate' ? (
          <>
            <div className="meibography-action-toolbar meibography-review-toolbar">
              <button type="button" className="secondary-action" onClick={() => cameraReady ? stopCameraStream(true) : startCameraStream()} disabled={isStartingCamera || isRecordingBlinkCounter || isAnalyzingBlinkCounter}><Camera size={16} /> {isStartingCamera ? 'Opening camera…' : cameraReady ? 'Turn camera off' : 'Turn camera on'}</button>
              <BlinkSessionSegmentedControl
                className="meibography-blink-segmented-control"
                value={blinkSessionActionMode}
                onChange={setBlinkSessionActionMode}
                onStartSession={handleStartBlinkRecording}
                onAnalyze={handleAnalyzeBlinkCounter}
                onClear={handleClearBlinkCounter}
                isRecording={isRecordingBlinkCounter}
                isAnalyzing={isAnalyzingBlinkCounter}
                secondsLeft={blinkRecordingSecondsLeft}
                canStart={Boolean(cameraReady && !isRecordingBlinkCounter && !isAnalyzingBlinkCounter)}
                canAnalyze={Boolean(blinkVideoFile && !isAnalyzingBlinkCounter && !isRecordingBlinkCounter)}
                canClear={Boolean(blinkVideoFile || blinkCounterResult || isRecordingBlinkCounter)}
              />
            </div>

            <div className="meibography-content">
              <div className="blink-counter-workspace">
                <div className="blink-counter-card">
                  <div className="blink-counter-header">
                    <h3 className="blink-counter-title">Let’s count your blinks</h3>
                    <p className="blink-counter-subtitle">
                      1. Look at the camera. 2. Press Count my blinks. 3. Blink normally for 30 seconds. Your result appears by itself.
                    </p>
                  </div>

                  <div className="blink-counter-preview-shell">
                    {isServerCameraMode ? (
                      <img
                        ref={backendBlinkStreamImageRef}
                        src={`${buildApiUrl('/api/camera/stream')}?v=${serverCameraStreamNonce}`}
                        alt="Backend camera stream"
                        className="blink-counter-preview-video"
                        style={{ filter: 'none', WebkitFilter: 'none' }}
                      />
                    ) : (
                      <video
                        key="blink-rate-camera-feed"
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="blink-counter-preview-video"
                        style={{ filter: 'none', WebkitFilter: 'none' }}
                      />
                    )}
                    {!cameraReady && (
                      <div className="blink-counter-placeholder">
                        {cameraError || 'Camera is not ready. Enable camera access to record blink rate.'}
                      </div>
                    )}
                  </div>

                  {(blinkVideoFile || isRecordingBlinkCounter) && (
                    <div className="blink-counter-file-meta">
                      {isRecordingBlinkCounter
                        ? `${blinkRecordingSecondsLeft} seconds left. ${liveBlinkMetrics.faceFound ? 'Face found — keep blinking normally.' : 'Move your face into view.'}`
                        : 'Your count is ready. You can start again any time.'}
                    </div>
                  )}

                  {(isRecordingBlinkCounter || blinkCounterResult) && (
                    <div className="blink-counter-inline-summary">
                      <div className="blink-counter-inline-metric">
                        <span>Total Blinks</span>
                        <strong>{isRecordingBlinkCounter ? liveBlinkMetrics.totalBlinks : blinkCounterResult.totalBlinks}</strong>
                      </div>
                      <div className="blink-counter-inline-metric">
                        <span>Blinks per minute</span>
                        <strong>{isRecordingBlinkCounter ? liveBlinkMetrics.bpmOverall : blinkCounterResult.bpmOverall ?? '—'}</strong>
                      </div>
                      <div className="blink-counter-inline-metric">
                        <span>Face Time</span>
                        <strong>{isRecordingBlinkCounter || blinkCounterResult.faceDetectedSeconds == null ? '—' : `${blinkCounterResult.faceDetectedSeconds}s`}</strong>
                      </div>
                      <div className="blink-counter-inline-metric">
                        <span>Interpretation</span>
                        <strong>{isRecordingBlinkCounter ? 'Recording live session' : blinkCounterResult.interpretation}</strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : isAdditionalTestSection ? (
          <div className="meibography-content">
            <Suspense fallback={<PanelFallback />}>
              <AdditionalTestsPanel
                activeSection={activeTestSection}
                currentEye={currentEye}
                onSelectEye={setCurrentEye}
                deqResponses={deqResponses}
                onChangeDeqResponse={handleDeqResponseChange}
                deqResult={deqSummary}
                osdiResponses={osdiResponses}
                onChangeOsdiResponse={handleOsdiResponseChange}
                osdiDuration={osdiDuration}
                onChangeOsdiDuration={setOsdiDuration}
                osdiComments={osdiComments}
                onChangeOsdiComments={setOsdiComments}
                osdiResult={osdiSummary}
                selectedBulbarRednessId={selectedBulbarRednessId}
                onSelectBulbarRedness={setSelectedBulbarRednessId}
                contrastSensitivity={contrastSensitivity}
                onChangeContrastTestName={handleContrastTestNameChange}
                onChangeContrastValue={handleContrastValueChange}
                contrastResult={contrastSummary}
                posteriorSegment={posteriorSegment}
                onChangePosteriorSegment={handlePosteriorSegmentChange}
                selectedPatientData={selectedPatientData}
                posteriorResult={posteriorSummary}
                cameraVideoRef={videoRef}
                cameraReady={cameraReady}
                cameraError={cameraError}
                isStartingCamera={isStartingCamera}
                isServerCameraMode={isServerCameraMode}
                serverCameraStreamSrc={`${buildApiUrl('/api/camera/stream')}?v=${serverCameraStreamNonce}`}
                onEnableCamera={startCameraStream}
                onStopCamera={() => stopCameraStream(true)}
                onDownloadReport={handleDownloadReport}
                onSaveReport={handleSaveReport}
                isSavingReport={isSavingReport}
              />
            </Suspense>
            {false && (
            <div className="clinical-module-stage">
              <div className="clinical-module-stage-card">
                <span className="clinical-module-stage-label">
                  {activeTestSection === 'deq' ? 'DEQ' : activeTestSection === 'osdi' ? 'OSDI' : activeTestSection === 'contrast-sensitivity' ? 'Contrast Sensitivity' : 'Posterior Segment'}
                </span>
                <h2 className="clinical-module-stage-title">
                  {activeTestSection === 'deq' && 'Dry eye symptom questionnaire'}
                  {activeTestSection === 'osdi' && 'Ocular surface disease review'}
                  {activeTestSection === 'contrast-sensitivity' && 'Contrast sensitivity AULCSF table'}
                  {activeTestSection === 'posterior-segment' && `Posterior findings for ${currentEye === 'left' ? 'left' : 'right'} eye`}
                </h2>
                <p className="clinical-module-stage-subtitle">
                  {activeTestSection === 'deq' && `Current DEQ total: ${deqSummary.total_score} · ${deqSummary.interpretation}`}
                  {activeTestSection === 'osdi' && `Current OSDI score: ${osdiSummary.osdi_score} · ${osdiSummary.interpretation}`}
                  {activeTestSection === 'contrast-sensitivity' && `OD Δ ${contrastSummary.comparisons?.od_delta_aulcsf ?? '--'} · OS Δ ${contrastSummary.comparisons?.os_delta_aulcsf ?? '--'}`}
                  {activeTestSection === 'posterior-segment' && `${activePosteriorSummary.impression} · ${activePosteriorSummary.report || 'No posterior findings entered yet.'}`}
                </p>
              </div>
            </div>
            )}
          </div>
        ) : (
          <>
            {!reviewSnapshot && <div className="meibography-action-toolbar exam-camera-actions"><button type="button" className="secondary-action" onClick={() => cameraReady ? stopCameraStream(true) : startCameraStream()} disabled={isStartingCamera}><Camera size={16} />{isStartingCamera ? 'Opening camera…' : cameraReady ? 'Turn camera off' : 'Turn camera on'}</button><button type="button" className="primary-action" onClick={handleOpenManualImagePicker} disabled={isManualImageProcessing}><Upload size={16} />Upload an image</button><span>Use a clear eye image, up to 8 MB.</span></div>}
            <div className="meibography-content meibography-live-workspace">
          <div className="meibography-camera-container-full">
            <div id="camera-feed-area" className="meibography-camera-preview-full">
              {shouldShowEyeSelectorOverlay && (
                <div className="meibography-camera-eye-selector ocular-eye-selector" id="eye-selector-toggle">
                  {[
                    { id: 'left', label: 'Left Eye' },
                    { id: 'right', label: 'Right Eye' }
                  ].map((eye) => (
                    <button
                      key={eye.id}
                      type="button"
                      id={`eye-toggle-${eye.id}`}
                      className={`ocular-eye-selector-btn ${currentEye === eye.id ? 'active' : ''}`}
                      onClick={() => handleSelectEye(eye.id)}
                    >
                      <Eye className="ocular-eye-icon" />
                      <span>{eye.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <div
                className="meibography-review-stage"
                style={{ transform: `translate(${tearReviewPan.x}px, ${tearReviewPan.y}px) scale(${reviewStageZoom})` }}
              >
                {isServerCameraMode ? (
                  <img
                    id="live-camera-feed"
                    src={`${buildApiUrl('/api/camera/stream')}?v=${serverCameraStreamNonce}`}
                    alt="Backend camera stream"
                    className="meibography-camera-img-full"
                    style={{
                      filter: 'none',
                      visibility: reviewSnapshot ? 'hidden' : 'visible'
                    }}
                  />
                ) : (
                  <video
                    id="live-camera-feed"
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="meibography-camera-img-full"
                    style={{
                      filter: previewFilter,
                      visibility: reviewSnapshot ? 'hidden' : 'visible'
                    }}
                  />
                )}
                {reviewSnapshot && (
                  <img
                    id="captured-review-image"
                    ref={reviewImageRef}
                    src={reviewSnapshot}
                    alt="Temporary captured snapshot"
                    className="meibography-camera-img-full meibography-preview-overlay meibography-review-image"
                    style={{ filter: 'none' }}
                  />
                )}

                {shouldRenderOverlay && (
                <div
                  id="annotation-layer"
                  ref={annotationLayerRef}
                  className="meibography-annotation-layer"
                  onClick={handleAnnotationCanvasClick}
                  onDoubleClick={isAnnotateMode ? handleAnnotationDoubleClick : undefined}
                  onPointerDown={isTearReviewActive ? handleTearOverlayPointerDown : undefined}
                  onPointerMove={isTearReviewActive ? handleTearOverlayPointerMove : undefined}
                  onPointerUp={isTearReviewActive ? endTearOverlayInteraction : undefined}
                  onPointerLeave={isTearReviewActive ? endTearOverlayInteraction : undefined}
                  onPointerCancel={isTearReviewActive ? endTearOverlayInteraction : undefined}
                  style={{
                    pointerEvents: isAnnotateMode || isTearMeasureMode || isTearReviewActive ? 'auto' : 'none',
                    cursor: isAnnotateMode || isTearMeasureMode
                      ? 'crosshair'
                      : (isTearReviewActive ? 'grab' : 'default'),
                    touchAction: 'none'
                  }}
                >
                  <svg className="meibography-annotation-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {isAnnotateMode && annotationPoints.length > 1 && !isAnnotationClosed && (
                      <polyline
                        points={annotationPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="0.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                    {isAnnotateMode && annotationPoints.length > 2 && isAnnotationClosed && (
                      <polygon
                        points={annotationPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')}
                        fill="rgba(59,130,246,0.18)"
                        stroke="#3b82f6"
                        strokeWidth="0.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                    {isAnnotateMode && annotationPoints.length > 0 && (() => {
                      const labelPosition = getAnnotationLabelPosition(annotationPoints)
                      if (!labelPosition) {
                        return null
                      }

                      return (
                        <g>
                          <rect
                            x={labelPosition.x}
                            y={labelPosition.y}
                            width="18"
                            height="6"
                            rx="2"
                            fill="rgba(15, 52, 84, 0.92)"
                          />
                          <text
                            x={labelPosition.x + 9}
                            y={labelPosition.y + 4}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="#ffffff"
                            fontSize="2.2"
                            fontWeight="700"
                          >
                            Eyelid
                          </text>
                        </g>
                      )
                    })()}
                    {isAnnotateMode && annotationPoints.map((point, pointIndex) => (
                      <circle
                        key={`${point.x}-${point.y}-${pointIndex}`}
                        cx={point.x * 100}
                        cy={point.y * 100}
                        r="0.9"
                        fill={pointIndex === 0 ? '#f97316' : '#3b82f6'}
                      />
                    ))}

                    {tearOverlayPoints.length > 0 && (
                      <>
                        {isTearMeasureMode && tearOverlayPoints.length === 1 && tearMeasureHoverPoint && (
                          <>
                            <line
                              x1={tearOverlayPoints[0].x * 100}
                              y1={tearOverlayPoints[0].y * 100}
                              x2={tearMeasureHoverPoint.x * 100}
                              y2={tearMeasureHoverPoint.y * 100}
                              stroke="rgba(15, 23, 42, 0.7)"
                              strokeWidth="0.18"
                              strokeLinecap="round"
                            />
                            <line
                              x1={tearOverlayPoints[0].x * 100}
                              y1={tearOverlayPoints[0].y * 100}
                              x2={tearMeasureHoverPoint.x * 100}
                              y2={tearMeasureHoverPoint.y * 100}
                              stroke="rgba(255,255,255,0.9)"
                              strokeWidth="0.1"
                              strokeLinecap="round"
                            />
                          </>
                        )}
                        {tearOverlayPoints.length === 2 && (
                          <>
                            <line
                              x1={tearOverlayPoints[0].x * 100}
                              y1={tearOverlayPoints[0].y * 100}
                              x2={tearOverlayPoints[1].x * 100}
                              y2={tearOverlayPoints[1].y * 100}
                              stroke="rgba(15, 23, 42, 0.7)"
                              strokeWidth="0.18"
                              strokeLinecap="round"
                            />
                            <line
                              x1={tearOverlayPoints[0].x * 100}
                              y1={tearOverlayPoints[0].y * 100}
                              x2={tearOverlayPoints[1].x * 100}
                              y2={tearOverlayPoints[1].y * 100}
                              stroke="rgba(255,255,255,0.9)"
                              strokeWidth="0.1"
                              strokeLinecap="round"
                            />
                          </>
                        )}
                        {tearOverlayPoints.map((point, pointIndex) => (
                          <g key={`tear-${pointIndex}-${point.x}-${point.y}`}>
                            <circle
                              data-tear-point-index={pointIndex}
                              cx={point.x * 100}
                              cy={point.y * 100}
                              r={showMeasuredTearIndicator ? '0.24' : '0.2'}
                              fill="#ffffff"
                            />
                            <circle
                              data-tear-point-index={pointIndex}
                              cx={point.x * 100}
                              cy={point.y * 100}
                              r={showMeasuredTearIndicator ? '0.18' : '0.15'}
                              fill={pointIndex === 0 ? '#f97316' : '#22c55e'}
                            />
                            {showMeasuredTearIndicator && (
                              <text
                                data-tear-point-index={pointIndex}
                                x={Math.min(97, point.x * 100 + 0.62)}
                                y={Math.max(4, point.y * 100 + 0.16)}
                                fill={pointIndex === 0 ? '#f97316' : '#22c55e'}
                                fontSize="1.2"
                                fontWeight="800"
                                stroke="rgba(15, 23, 42, 0.9)"
                                strokeWidth="0.12"
                                paintOrder="stroke"
                              >
                                {pointIndex === 0 ? 'D' : 'C'}
                              </text>
                            )}
                          </g>
                        ))}
                        {currentTearMeasurement && !isTearMeasureMode && (
                          <g>
                            <rect
                              x={Math.min(80, ((currentTearMeasurement.topPoint?.x || 0) * 100) + 2)}
                              y={Math.max(4, (((currentTearMeasurement.topPoint?.y || 0) * 100) + ((currentTearMeasurement.bottomPoint?.y || 0) * 100)) / 2 - 5)}
                              width="18"
                              height="6"
                              rx="2"
                              fill="rgba(12, 43, 24, 0.92)"
                            />
                            <text
                              x={Math.min(89, ((currentTearMeasurement.topPoint?.x || 0) * 100) + 11)}
                              y={Math.max(8, (((currentTearMeasurement.topPoint?.y || 0) * 100) + ((currentTearMeasurement.bottomPoint?.y || 0) * 100)) / 2 - 1)}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fill="#ffffff"
                              fontSize="2.1"
                              fontWeight="700"
                            >
                              {currentTearMeasurement.label}
                            </text>
                          </g>
                        )}
                      </>
                    )}
                  </svg>
                  <div className="meibography-annotation-hint">
                    {isTearMeasureMode
                      ? `Click ${tearMeasurementDraftPoints.length === 0 ? 'the top edge' : 'the bottom edge'} of the tear meniscus. Drag markers to refine.`
                      : isTearReviewActive
                        ? 'Drag D/C markers to refine. Drag the image to pan while zoomed.'
                      : 'Click along the eyelid to mark its boundary. Double-click or click the first point to close.'}
                  </div>
                </div>
              )}

              </div>

              {isTearReviewActive && (
                <div className="meibography-tear-zoom-controls">
                  <button
                    type="button"
                    className="meibography-tear-zoom-btn"
                    onClick={handleZoomOutTearReview}
                    disabled={tearReviewZoom <= MIN_TEAR_REVIEW_ZOOM}
                    aria-label="Zoom out tear meniscus review"
                  >
                    <ZoomOut />
                  </button>
                  <div className="meibography-tear-zoom-value">
                    {Math.round(tearReviewZoom * 100)}%
                  </div>
                  <button
                    type="button"
                    className="meibography-tear-zoom-btn"
                    onClick={handleZoomInTearReview}
                    disabled={tearReviewZoom >= MAX_TEAR_REVIEW_ZOOM}
                    aria-label="Zoom in tear meniscus review"
                  >
                    <ZoomIn />
                  </button>
                  <button
                    type="button"
                    className="meibography-tear-zoom-btn reset"
                    onClick={handleResetTearReviewZoom}
                    disabled={tearReviewZoom === MIN_TEAR_REVIEW_ZOOM}
                    aria-label="Reset tear meniscus zoom"
                  >
                    <RotateCcw />
                  </button>
                </div>
              )}

              <div className="meibography-camera-brackets meibography-bracket-tl"></div>
              <div className="meibography-camera-brackets meibography-bracket-tr"></div>
              <div className="meibography-camera-brackets meibography-bracket-bl"></div>
              <div className="meibography-camera-brackets meibography-bracket-br"></div>

              {cameraError && (
                <div id="camera-error-banner" className="meibography-camera-error">
                  {cameraError}
                </div>
              )}
            </div>
          </div>

              {!reviewSnapshot ? (
                <div id="capture-action-controls" className="meibography-action-toolbar meibography-bottom-toolbar">
                  <div className="meibography-active-target-pill" id="active-selection-indicator">
                    Active: {currentEye === 'left' ? 'Left Eye' : 'Right Eye'} |{' '}
                    {currentLid === 'upper' ? 'Upper Lid' : 'Lower Lid'}
                    {' '}| {currentEye === 'left' ? leftEyeStatus : rightEyeStatus}
                  </div>

                  <div className="meibography-settings-container-inline">
                    <div className="settings-inline-content">
                      <button
                        type="button"
                        className="meibography-settings-icon-inline"
                        onClick={() => setShowSettings((previousValue) => !previousValue)}
                        aria-label="Toggle preprocessing controls"
                      >
                        <Settings />
                      </button>
                      {showSettings && (
                        <div className="settings-inline-panel">
                          <div className="inline-setting-item">
                            <Sun className="inline-setting-icon" />
                            <span className="inline-setting-label">B</span>
                            <input
                              type="range"
                              name="capture-brightness"
                              min="0"
                              max="100"
                              value={brightness}
                              onChange={(event) => handleBrightnessChange(Number(event.target.value))}
                              className="inline-setting-slider"
                            />
                            <span className="inline-setting-value">{brightness}</span>
                          </div>
                          <div className="inline-setting-item">
                            <Contrast className="inline-setting-icon" />
                            <span className="inline-setting-label">C</span>
                            <input
                              type="range"
                              name="capture-contrast"
                              min="0"
                              max="100"
                              value={contrast}
                              onChange={(event) => handleContrastChange(Number(event.target.value))}
                              className="inline-setting-slider"
                            />
                            <span className="inline-setting-value">{contrast}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <SegmentedActionControl
                    className="meibography-capture-segmented-control"
                    ariaLabel="Choose how to add the next image"
                    value={captureActionMode}
                    onChange={setCaptureActionMode}
                    options={[
                      {
                        value: 'capture',
                        label: 'Capture Image',
                        icon: Camera,
                        onClick: handleCapture
                      },
                      {
                        value: 'upload',
                        label: isManualImageProcessing ? 'Processing...' : 'Upload Image',
                        icon: Upload,
                        disabled: isManualImageProcessing,
                        onClick: handleOpenManualImagePicker
                      }
                    ]}
                  />
                  <input
                    id="manual-image-input"
                    ref={manualImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleManualImageSelected}
                    style={{ display: 'none' }}
                  />
                </div>
              ) : (
                <div id="review-action-controls" className="meibography-action-toolbar meibography-review-toolbar meibography-bottom-toolbar">
                  {activeTestSection === 'tear-meniscus' ? (
                    <>
                      <TearMeasureSegmentedControl
                        className="meibography-tear-segmented-control"
                        value={tearMeasureActionMode}
                        onChange={setTearMeasureActionMode}
                        onMeasure={handleStartTearMeasurement}
                        onClear={handleClearTearMeasurement}
                        isMeasuring={isMeasuringTearMeniscus}
                        canMeasure={Boolean(reviewSnapshot)}
                        canClear={Boolean(currentTearMeasurement || tearMeasurementDraftPoints.length || isTearMeasureMode)}
                      />
                    </>
                  ) : (
                    <>
                      <div className="meibography-settings-container-inline">
                        <div className="settings-inline-content">
                          <button
                            type="button"
                            className="meibography-settings-icon-inline"
                            onClick={() => setShowSettings((previousValue) => !previousValue)}
                            aria-label="Toggle preprocessing controls"
                          >
                            <Settings />
                          </button>
                          {showSettings && (
                            <div className="settings-inline-panel">
                              <div className="inline-setting-item">
                                <Sun className="inline-setting-icon" />
                                <span className="inline-setting-label">B</span>
                                <input
                                  type="range"
                                  name="review-brightness"
                                  min="0"
                                  max="100"
                                  value={brightness}
                                  onChange={(event) => handleBrightnessChange(Number(event.target.value))}
                                  className="inline-setting-slider"
                                />
                                <span className="inline-setting-value">{brightness}</span>
                              </div>
                              <div className="inline-setting-item">
                                <Contrast className="inline-setting-icon" />
                                <span className="inline-setting-label">C</span>
                                <input
                                  type="range"
                                  name="review-contrast"
                                  min="0"
                                  max="100"
                                  value={contrast}
                                  onChange={(event) => handleContrastChange(Number(event.target.value))}
                                  className="inline-setting-slider"
                                />
                                <span className="inline-setting-value">{contrast}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <SegmentedActionControl
                        className="meibography-review-segmented-control"
                        ariaLabel="Review actions"
                        value={reviewActionMode}
                        onChange={setReviewActionMode}
                        options={[
                          {
                            value: 'analyze',
                            label: analyzeMeibographyButtonLabel,
                            icon: BarChart3,
                            disabled: !canStartMeibographyAnalysis,
                            onClick: handleAnalyzeMeibography
                          },
                          {
                            value: 'annotate',
                            label: isAnnotateMode ? 'Annotating' : 'Annotate',
                            icon: PencilLine,
                            onClick: handleAnnotateToggle
                          },
                          {
                            value: 'delete',
                            label: 'Delete',
                            icon: Trash2,
                            tone: 'danger',
                            onClick: handleDeleteSnapshot
                          },
                          {
                            value: 'save',
                            label: 'Save',
                            icon: Save,
                            onClick: handleSaveSnapshot
                          }
                        ]}
                      />
                    </>
                  )}
                </div>
              )}

              {activeTestSection === 'meibography' && meibographyPreviewItems.length > 0 && (
                <div className="meibography-analysis-preview-grid">
                  {meibographyPreviewItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`meibography-analysis-preview-card ${getMeibographyPreviewCardState(item.key)}`}
                      onClick={() => openAnalysisPreviewModal(item)}
                    >
                      <div className="meibography-analysis-preview-title">
                        <span>{item.title}</span>
                        <span className={`meibography-analysis-preview-badge ${getMeibographyPreviewCardState(item.key)}`}>
                          {getMeibographyPreviewCardLabel(item.key)}
                        </span>
                      </div>
                      <img
                        src={item.image}
                        alt={`${currentEye === 'left' ? 'Left Eye' : 'Right Eye'} ${currentLid} ${item.title}`}
                        className="meibography-analysis-preview-image"
                      />
                    </button>
                  ))}
                </div>
              )}

              {activeTestSection === 'tear-meniscus' && tearMeniscusPreviewItems.length > 0 && (
                <div className="meibography-analysis-preview-grid tear-meniscus-preview-grid">
                  {tearMeniscusPreviewItems.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="meibography-analysis-preview-card"
                      onClick={() => openAnalysisPreviewModal(item)}
                    >
                      <div className="meibography-analysis-preview-title">{item.title}</div>
                      <img
                        src={item.image}
                        alt={`${currentEye === 'left' ? 'Left Eye' : 'Right Eye'} ${item.title}`}
                        className="meibography-analysis-preview-image"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {activeTestSection === 'blink-rate' ? (
        <Suspense fallback={<PanelFallback />}>
          <BlinkCounterPanel
            onVideoUpload={handleBlinkVideoUpload}
            videoName={blinkVideoFile?.name || ''}
            blinkResult={blinkCounterResult}
            liveBlinkMetrics={liveBlinkMetrics}
            isRecording={isRecordingBlinkCounter}
            isAnalyzing={isAnalyzingBlinkCounter}
            canAnalyze={Boolean(blinkVideoFile)}
            onManualCalculate={handleManualBlinkCalculation}
            hasSession={Boolean(blinkVideoFile || blinkCounterResult)}
            onAnalyze={handleAnalyzeBlinkCounter}
            onClear={handleClearBlinkCounter}
            onDownloadReport={handleDownloadReport}
            onSaveReport={handleSaveReport}
            isSavingReport={isSavingReport}
          />
        </Suspense>
      ) : isAdditionalTestSection ? null : (
        <OcularAnalysisPanel
          activeSection={activeTestSection}
          images={images}
          currentEye={currentEye}
          currentLid={currentLid}
          showEyeSelector={false}
          onSelectEye={handleSelectEye}
          onSelectLid={handleSelectLid}
          meibographyResults={meibographyResults}
          tearMeasurements={tearMeasurements}
          tearMeasurementDraftPoints={tearMeasurementDraftPoints}
          isTearMeasureMode={isTearMeasureMode}
          isMeasuringTear={isMeasuringTearMeniscus}
          showTearPreview={false}
          onStartTearMeasurement={handleStartTearMeasurement}
          onClearTearMeasurement={handleClearTearMeasurement}
          canMeasureTear={Boolean(reviewSnapshot)}
          onDownloadReport={handleDownloadReport}
          onSaveReport={handleSaveReport}
          isSavingReport={isSavingReport}
          onUndoImage={handleUndoImage}
          onRedoImage={handleRedoImage}
          onResetImage={handleResetCurrentImage}
          canUndoImage={canUndoImage}
          canRedoImage={canRedoImage}
          canResetImage={canResetImage}
        />
      )}

      {analysisPreviewModal && (
        <div className="meibography-analysis-modal" onClick={closeAnalysisPreviewModal}>
          <div className="meibography-analysis-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-preview-title" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="meibography-analysis-modal-close"
              onClick={closeAnalysisPreviewModal}
              aria-label="Close image preview"
            >
              Close
            </button>
            <div id="analysis-preview-title" className="meibography-analysis-modal-title">{analysisPreviewModal.title}</div>
            <img
              src={analysisPreviewModal.image}
              alt={analysisPreviewModal.title}
              className="meibography-analysis-modal-image"
            />
          </div>
        </div>
      )}

      {showToast && (
        <div id="capture-toast" className="meibography-toast">
          {toastMessage}
        </div>
      )}
    </div>
  )
}

export default MeibographyStandalone

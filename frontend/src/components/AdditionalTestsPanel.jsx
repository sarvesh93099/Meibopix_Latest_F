// Renders the non-meibography clinical panels such as DEQ, OSDI, bulbar redness, and contrast tests.
import React, { useEffect, useRef, useState } from 'react'
import { ImagePlus, Upload } from 'lucide-react'
import CameraToggleSegmentedControl from './CameraToggleSegmentedControl'
import ReportSegmentedControl from './ReportSegmentedControl'
import eyeLogo from '../assets/eye-logo.svg'
import bulbarVerySlight from '../assets/Bulbur_Images/very_slight.png'
import bulbarSlight from '../assets/Bulbur_Images/slight.png'
import bulbarModerate from '../assets/Bulbur_Images/moderate.png'
import bulbarSevere from '../assets/Bulbur_Images/severe.png'

// Shared choice lists keep the questionnaire copy and scoring inputs in one place.
const EYE_OPTIONS = [
  { id: 'left', label: 'Left Eye' },
  { id: 'right', label: 'Right Eye' }
]

const DEQ_SECTIONS = [
  {
    id: 'discomfort',
    title: '1. Questions about EYE DISCOMFORT',
    items: [
      {
        key: 0,
        prompt: 'a. During a typical day in the past month, how often did your eyes feel discomfort?',
        options: [
          { value: 0, label: 'Never' },
          { value: 1, label: 'Rarely' },
          { value: 2, label: 'Sometimes' },
          { value: 3, label: 'Frequently' },
          { value: 4, label: 'Constantly' }
        ]
      },
      {
        key: 1,
        prompt: 'b. When your eyes feel discomfort, how intense was this feeling of discomfort at the end of the day, within two hours of going to bed?',
        options: [
          { value: 0, label: 'Never have it' },
          { value: 1, label: 'Not intense at all' },
          { value: 2, label: 'Slightly intense' },
          { value: 3, label: 'Moderately intense' },
          { value: 4, label: 'Very intense' }
        ]
      }
    ]
  },
  {
    id: 'dryness',
    title: '2. Questions about EYE DRYNESS:',
    items: [
      {
        key: 2,
        prompt: 'a. During a typical day in the past month, how often did your eyes feel dry?',
        options: [
          { value: 0, label: 'Never' },
          { value: 1, label: 'Rarely' },
          { value: 2, label: 'Sometimes' },
          { value: 3, label: 'Frequently' },
          { value: 4, label: 'Constantly' }
        ]
      },
      {
        key: 3,
        prompt: 'b. When your eyes felt dry, how intense was this feeling of dryness at the end of the day, within two hours of going to bed?',
        options: [
          { value: 0, label: 'Never have it' },
          { value: 1, label: 'Not intense at all' },
          { value: 2, label: 'Slightly intense' },
          { value: 3, label: 'Moderately intense' },
          { value: 4, label: 'Very intense' }
        ]
      }
    ]
  },
  {
    id: 'watery',
    title: '3. Questions about WATERY EYES:',
    items: [
      {
        key: 4,
        prompt: 'a. During a typical day in the past month, how often did your eyes look or feel excessively watery?',
        options: [
          { value: 0, label: 'Never' },
          { value: 1, label: 'Rarely' },
          { value: 2, label: 'Sometimes' },
          { value: 3, label: 'Frequently' },
          { value: 4, label: 'Constantly' }
        ]
      }
    ]
  }
]

const OSDI_QUESTIONS = [
  'Eyes that are sensitive to light?',
  'Eyes that feel gritty?',
  'Painful or sore eyes?',
  'Blurred vision?',
  'Poor vision?',
  'Reading?',
  'Driving at night?',
  'Working with a computer or bank machine (ATM)?',
  'Watching TV?',
  'Windy conditions?',
  'Places or areas with low humidity (very dry)?',
  'Areas that are air conditioned?'
]

const OSDI_SECTIONS = [
  {
    id: 'symptoms',
    title: 'HAVE YOU EXPERIENCED ANY OF THE FOLLOWING DURING THE LAST WEEK:',
    subtotalLabel: 'Subtotal score for answers 1 to 5:',
    items: OSDI_QUESTIONS.slice(0, 5).map((question, index) => ({
      key: index,
      prompt: `${index + 1}. ${question}`,
      options: ['4', '3', '2', '1', '0']
    }))
  },
  {
    id: 'function',
    title: 'HAVE PROBLEMS WITH YOUR EYES LIMITED YOU IN PERFORMING ANY OF THE FOLLOWING DURING THE LAST WEEK:',
    subtotalLabel: 'Subtotal score for answers 6 to 9:',
    items: OSDI_QUESTIONS.slice(5, 9).map((question, index) => ({
      key: index + 5,
      prompt: `${index + 6}. ${question}`,
      options: ['4', '3', '2', '1', '0', 'NA']
    }))
  },
  {
    id: 'environment',
    title: 'HAVE YOUR EYES FELT UNCOMFORTABLE IN ANY OF THE FOLLOWING SITUATIONS DURING THE LAST WEEK:',
    subtotalLabel: 'Subtotal score for answers 10 to 12:',
    items: OSDI_QUESTIONS.slice(9, 12).map((question, index) => ({
      key: index + 9,
      prompt: `${index + 10}. ${question}`,
      options: ['4', '3', '2', '1', '0', 'NA']
    }))
  }
]

const DEQ_RESPONSE_OPTIONS = [
  { value: 0, label: '0 · Never / None' },
  { value: 1, label: '1 · Rarely / Slight' },
  { value: 2, label: '2 · Sometimes / Moderate' },
  { value: 3, label: '3 · Frequently / Marked' },
  { value: 4, label: '4 · Constantly / Severe' }
]

const OSDI_PRIMARY_OPTIONS = [
  { value: '0', label: '0 · None of the time' },
  { value: '1', label: '1 · Some of the time' },
  { value: '2', label: '2 · Half of the time' },
  { value: '3', label: '3 · Most of the time' },
  { value: '4', label: '4 · All of the time' }
]

const OSDI_SECONDARY_OPTIONS = [
  ...OSDI_PRIMARY_OPTIONS,
  { value: 'NA', label: 'NA · Not applicable' }
]

const CONTRAST_TEST_OPTIONS = ['Cataract', 'Glaucoma', 'Lasik', 'Diabetic Retinopathy']
const CONTRAST_COLUMNS = ['A', 'B', 'C', 'D']
const CONTRAST_ROWS = [
  { key: 'od_pre', label: 'OD PRE-OP' },
  { key: 'od_post', label: 'OD POST-OP' },
  { key: 'os_pre', label: 'OS PRE-OP' },
  { key: 'os_post', label: 'OS POST-OP' }
]
const BULBAR_REDNESS_REFERENCES = [
  { id: 'very-slight', title: '1. VERY SLIGHT', className: 'bulbar-redness-card very-slight', imageSrc: bulbarVerySlight },
  { id: 'slight', title: '2. SLIGHT', className: 'bulbar-redness-card slight', imageSrc: bulbarSlight },
  { id: 'moderate', title: '3. MODERATE', className: 'bulbar-redness-card moderate', imageSrc: bulbarModerate },
  { id: 'severe', title: '4. SEVERE', className: 'bulbar-redness-card severe', imageSrc: bulbarSevere }
]

const formatMetric = (value, digits = 1) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : '0'
}

const formatAulcsf = (value) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue.toFixed(3) : 'N/A'
}

const formatDelta = (value) => {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return 'Pending full row entry'
  }
  if (numericValue > 0) {
    return `Improved by ${numericValue.toFixed(3)}`
  }
  if (numericValue < 0) {
    return `Reduced by ${Math.abs(numericValue).toFixed(3)}`
  }
  return 'No change'
}

const getTodayIsoDate = () => new Date().toISOString().slice(0, 10)

const createPosteriorFrontendState = () => ({
  clinicName: 'Sakec',
  organization: 'cibil bank of asia',
  phone: '90876544',
  email: 'talegaonkarsarveertyhs@gmail.com',
  fullName: '',
  age: '',
  gain: '',
  sex: 'Male',
  address: '',
  uhid: '',
  reference: '',
  date: getTodayIsoDate(),
  images: [null, null]
})

const readFileAsDataUrl = (file) => (
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Unable to read file.'))
    }
    reader.onerror = () => reject(new Error('Unable to read file.'))
    reader.readAsDataURL(file)
  })
)

// This panel switches between several auxiliary test UIs while reusing one patient/session context.
const AdditionalTestsPanel = ({
  activeSection,
  currentEye = 'left',
  onSelectEye = () => {},
  deqResponses = [],
  onChangeDeqResponse = () => {},
  deqResult = null,
  osdiResponses = [],
  onChangeOsdiResponse = () => {},
  osdiDuration = '',
  onChangeOsdiDuration = () => {},
  osdiComments = '',
  onChangeOsdiComments = () => {},
  osdiResult = null,
  contrastSensitivity = { testName: 'Glaucoma', rows: {} },
  onChangeContrastTestName = () => {},
  onChangeContrastValue = () => {},
  contrastResult = null,
  posteriorSegment = {
    left: { impression: 'Normal', report: '', recommendation: '' },
    right: { impression: 'Normal', report: '', recommendation: '' }
  },
  onChangePosteriorSegment = () => {},
  selectedPatientData = null,
  selectedBulbarRednessId = '',
  onSelectBulbarRedness = () => {},
  posteriorResult = null,
  cameraVideoRef = null,
  cameraReady = false,
  cameraError = '',
  isStartingCamera = false,
  isServerCameraMode = false,
  serverCameraStreamSrc = '',
  onEnableCamera = () => {},
  onStopCamera = () => {},
  onDownloadReport = () => {},
  onSaveReport = () => {},
  isSavingReport = false
}) => {
  const [showContrastWorkflow, setShowContrastWorkflow] = useState(activeSection !== 'contrast-sensitivity')
  const [posteriorFrontend, setPosteriorFrontend] = useState(createPosteriorFrontendState)
  const activePosterior = posteriorSegment[currentEye] || { impression: 'Normal', report: '', recommendation: '' }
  const activePosteriorResult = posteriorResult?.[currentEye] || activePosterior
  const contrastRows = contrastSensitivity?.rows || {}
  const contrastComparisons = contrastResult?.comparisons || {}
  const posteriorUploadRefs = useRef([])

  useEffect(() => {
    if (activeSection === 'contrast-sensitivity') {
      setShowContrastWorkflow(false)
    } else {
      setShowContrastWorkflow(true)
    }
  }, [activeSection])

  useEffect(() => {
    if (!selectedPatientData) {
      return
    }

    setPosteriorFrontend((previousValue) => {
      const nextValue = { ...previousValue }
      let changed = false

      if (!previousValue.fullName && selectedPatientData.full_name) {
        nextValue.fullName = selectedPatientData.full_name
        changed = true
      }

      if (!previousValue.age && selectedPatientData.age !== undefined && selectedPatientData.age !== null) {
        nextValue.age = String(selectedPatientData.age)
        changed = true
      }

      if ((!previousValue.sex || previousValue.sex === 'Male') && selectedPatientData.gender) {
        nextValue.sex = selectedPatientData.gender
        changed = true
      }

      return changed ? nextValue : previousValue
    })
  }, [selectedPatientData])

  const renderEyeToggle = () => (
    <div className="clinical-test-eye-toggle">
      {EYE_OPTIONS.map((eye) => (
        <button
          key={eye.id}
          type="button"
          className={`clinical-test-eye-btn ${currentEye === eye.id ? 'active' : ''}`}
          onClick={() => onSelectEye(eye.id)}
        >
          {eye.label}
        </button>
      ))}
    </div>
  )

  const renderSelectQuestionList = (questions, responses, onChangeResponse, resolver) => (
    <div className="clinical-test-question-list">
      {questions.map((question, index) => (
        <div key={question} className="clinical-test-question">
          <label className="clinical-test-question-label">{question}</label>
          <select
            name={`clinical-question-${index}`}
            className="clinical-test-select"
            value={responses[index] ?? resolver(index)[0].value}
            onChange={(event) => onChangeResponse(index, event.target.value)}
          >
            {resolver(index).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )

  const handlePosteriorFrontendChange = (field, value) => {
    setPosteriorFrontend((previousValue) => ({
      ...previousValue,
      [field]: value
    }))
  }

  const handlePosteriorImagePick = async (slotIndex, event) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const imageData = await readFileAsDataUrl(file)
      setPosteriorFrontend((previousValue) => {
        const nextImages = [...previousValue.images]
        while (nextImages.length <= slotIndex && nextImages.length < 6) {
          nextImages.push(null)
        }
        nextImages[slotIndex] = imageData
        return {
          ...previousValue,
          images: nextImages
        }
      })
    } catch (error) {
      console.error('Posterior upload failed:', error)
    } finally {
      event.target.value = ''
    }
  }

  const handleAddPosteriorImage = () => {
    setPosteriorFrontend((previousValue) => {
      if (previousValue.images.length >= 6) {
        return previousValue
      }
      return {
        ...previousValue,
        images: [...previousValue.images, null]
      }
    })
  }

  const renderPosteriorUploadSlot = (imageSrc, slotIndex) => (
    <button
      key={`posterior-image-${slotIndex}`}
      type="button"
      className={`posterior-frontend-upload-slot ${imageSrc ? 'has-image' : ''}`}
      onClick={() => posteriorUploadRefs.current[slotIndex]?.click()}
    >
      <input
        ref={(element) => {
          posteriorUploadRefs.current[slotIndex] = element
        }}
        type="file"
        name={`posterior-image-${slotIndex}`}
        accept="image/*"
        className="posterior-frontend-upload-input"
        onChange={(event) => handlePosteriorImagePick(slotIndex, event)}
      />
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`Posterior upload ${slotIndex + 1}`}
          className="posterior-frontend-upload-preview"
        />
      ) : (
        <div className="posterior-frontend-upload-placeholder">
          <ImagePlus className="posterior-frontend-upload-art" />
          <Upload className="posterior-frontend-upload-icon" />
          <span>Upload Eye Image</span>
        </div>
      )}
    </button>
  )

  const renderPosteriorFrontend = () => (
    <div className="posterior-frontend-layout">
      <div className="posterior-frontend-card">
        <div className="posterior-frontend-letterhead">
          <img src={eyeLogo} alt="Letterhead" className="posterior-frontend-logo" />
          <div className="posterior-frontend-letterhead-copy">
            <h2 className="posterior-frontend-title">{posteriorFrontend.clinicName}</h2>
            <p>{posteriorFrontend.organization}</p>
            <p>Phone : {posteriorFrontend.phone}</p>
            <p>Email : {posteriorFrontend.email}</p>
          </div>
        </div>
        <button type="button" className="posterior-frontend-link">Choose a different letterhead</button>
      </div>

      <div className="posterior-frontend-card posterior-frontend-form-card">
        {renderEyeToggle()}
        <div className="posterior-frontend-grid">
          <div className="posterior-frontend-field posterior-frontend-field-wide">
            <label>Full Name</label>
            <input
              type="text"
              name="posterior-full-name"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.fullName}
              onChange={(event) => handlePosteriorFrontendChange('fullName', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field">
            <label>Age</label>
            <input
              type="text"
              name="posterior-age"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.age}
              onChange={(event) => handlePosteriorFrontendChange('age', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field">
            <label>Gain</label>
            <input
              type="text"
              name="posterior-gain"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.gain}
              onChange={(event) => handlePosteriorFrontendChange('gain', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field">
            <label>Sex</label>
            <select
              name="posterior-sex"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.sex}
              onChange={(event) => handlePosteriorFrontendChange('sex', event.target.value)}
            >
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="posterior-frontend-field posterior-frontend-field-wide">
            <label>Address</label>
            <input
              type="text"
              name="posterior-address"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.address}
              onChange={(event) => handlePosteriorFrontendChange('address', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field">
            <label>UHID</label>
            <input
              type="text"
              name="posterior-uhid"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.uhid}
              placeholder="Eg. 009900"
              onChange={(event) => handlePosteriorFrontendChange('uhid', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field">
            <label>Ref :</label>
            <input
              type="text"
              name="posterior-reference"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.reference}
              onChange={(event) => handlePosteriorFrontendChange('reference', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field">
            <label>Date</label>
            <input
              type="date"
              name="posterior-date"
              className="clinical-test-input posterior-frontend-input"
              value={posteriorFrontend.date}
              onChange={(event) => handlePosteriorFrontendChange('date', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field posterior-frontend-field-wide">
            <label>Report</label>
            <textarea
              name="posterior-report"
              className="clinical-test-textarea posterior-frontend-textarea"
              value={activePosterior.report}
              onChange={(event) => onChangePosteriorSegment(currentEye, 'report', event.target.value)}
            />
          </div>

          <div className="posterior-frontend-field posterior-frontend-field-wide">
            <label>Impression</label>
            <textarea
              name="posterior-impression"
              className="clinical-test-textarea posterior-frontend-textarea posterior-frontend-textarea-short"
              value={activePosterior.impression}
              onChange={(event) => onChangePosteriorSegment(currentEye, 'impression', event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="posterior-frontend-card">
        <div className="posterior-frontend-upload-grid">
          {posteriorFrontend.images.map((imageSrc, slotIndex) => renderPosteriorUploadSlot(imageSrc, slotIndex))}
        </div>
        <button
          type="button"
          className="posterior-frontend-add-btn"
          onClick={handleAddPosteriorImage}
          disabled={posteriorFrontend.images.length >= 6}
        >
          + Add More Images
        </button>
        <div className="posterior-frontend-note">
          Note: You can upload up to 6 images, with a maximum of 2 images per page.
        </div>
        <div className="posterior-frontend-footer">
          <p>For appointments, call or whatsapp on : 87654987657</p>
          <p>Timings : 7.87</p>
          <button type="button" className="posterior-frontend-link">Choose a different footer</button>
        </div>
      </div>
    </div>
  )

  const renderDeqQuestionnaire = () => (
    <div className="deq-questionnaire">
      <div className="deq-questionnaire-header">
        <h2 className="deq-questionnaire-title">DRY EYE QUESTIONNAIRE (DEQ-5)</h2>
      </div>

      <div className="clinical-test-summary-grid deq-summary-grid">
        <div className="clinical-test-summary-card"><span>Total Score</span><strong>{deqResult?.total_score ?? 0}</strong></div>
        <div className="clinical-test-summary-card"><span>Average Score</span><strong>{formatMetric(deqResult?.average_score ?? 0)}</strong></div>
        <div className="clinical-test-summary-card"><span>Interpretation</span><strong>{deqResult?.interpretation || 'Normal'}</strong></div>
      </div>

      <div className="deq-questionnaire-sections">
        {DEQ_SECTIONS.map((section) => (
          <section key={section.id} className="deq-section">
            <h3 className="deq-section-title">{section.title}</h3>
            <div className="deq-question-list">
              {section.items.map((item) => {
                const selectedValue = Number(deqResponses[item.key] ?? 0)

                return (
                  <div key={item.key} className="deq-question-block">
                    <p className="deq-question-prompt">{item.prompt}</p>
                    <div className="deq-response-grid">
                      {item.options.map((option) => {
                        const isSelected = selectedValue === option.value

                        return (
                          <button
                            key={`${item.key}-${option.value}`}
                            type="button"
                            className={`deq-response-option ${isSelected ? 'active' : ''}`}
                            onClick={() => onChangeDeqResponse(item.key, option.value)}
                          >
                            <span className="deq-response-label">{option.label}</span>
                            <span className="deq-response-score-row">
                              <span className="deq-response-score">{option.value}</span>
                              <span className={`deq-response-checkbox ${isSelected ? 'active' : ''}`} aria-hidden="true">
                                {isSelected ? 'x' : ''}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )

  const renderContrastSetup = () => (
    <div className="contrast-setup">
      <p className="contrast-setup-copy">
        Select the test to be performed for contrast sensitivity, and then proceed with the test.
      </p>

      <div className="contrast-setup-options" role="radiogroup" aria-label="Contrast sensitivity test type">
        {CONTRAST_TEST_OPTIONS.map((option) => {
          const isSelected = (contrastSensitivity?.testName || 'Glaucoma') === option
          return (
            <label key={option} className={`contrast-setup-option ${isSelected ? 'active' : ''}`}>
              <input
                type="radio"
                name="contrast-test-type"
                value={option}
                checked={isSelected}
                onChange={(event) => onChangeContrastTestName(event.target.value)}
              />
              <span>{option}</span>
            </label>
          )
        })}
      </div>

      <div className="contrast-setup-actions">
        <button
          type="button"
          className="contrast-setup-proceed"
          onClick={() => setShowContrastWorkflow(true)}
        >
          Proceed
        </button>
        <button
          type="button"
          className="contrast-setup-skip"
          onClick={() => setShowContrastWorkflow(true)}
        >
          Skip
        </button>
      </div>
    </div>
  )

  const renderBulbarRednessReference = () => (
    <div className="bulbar-redness-reference">
        <div className="bulbar-redness-reference-shell">
          <div className="bulbar-redness-control-row">
            <CameraToggleSegmentedControl
              className="bulbar-redness-camera-segmented-control"
              cameraReady={cameraReady}
              isStartingCamera={isStartingCamera}
              onEnableCamera={onEnableCamera}
              onStopCamera={onStopCamera}
            />
          </div>

        <div className="bulbar-redness-camera-shell">
          <div className="bulbar-redness-camera-stage">
            {isServerCameraMode ? (
              <img
                src={serverCameraStreamSrc}
                alt="Live bulbar camera stream"
                className="bulbar-redness-camera-feed"
              />
            ) : (
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                className="bulbar-redness-camera-feed"
              />
            )}

            {!cameraReady && (
              <div className="bulbar-redness-camera-overlay">
                <div className="bulbar-redness-camera-target" aria-hidden="true" />
                <p className="bulbar-redness-camera-overlay-copy">
                  {cameraError || 'Enable the camera and place the eye in the center for manual grading.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bulbar-redness-gallery" role="radiogroup" aria-label="Bulbar redness reference">
          {BULBAR_REDNESS_REFERENCES.map((item) => {
            const isSelected = selectedBulbarRednessId === item.id

            return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-label={item.title}
              aria-checked={isSelected}
              className={`${item.className} ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectBulbarRedness(item.id)}
            >
              <img src={item.imageSrc} alt={item.title} className="bulbar-redness-card-image" />
            </button>
          )})}
        </div>

        <button
          type="button"
          className="bulbar-redness-save-btn"
          onClick={onSaveReport}
          disabled={isSavingReport || !selectedBulbarRednessId}
        >
          {isSavingReport ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )

  const renderOsdiQuestionnaire = () => {
    const subtotalValues = [
      osdiResult?.subtotal_a ?? 0,
      osdiResult?.subtotal_b ?? 0,
      osdiResult?.subtotal_c ?? 0
    ]
    const columnLabels = ['All of the time', 'Most of the time', 'Half of the time', 'Some of the time', 'None of the time']
    const columnLabelsWithNa = [...columnLabels, 'NA']

    return (
      <div className="osdi-questionnaire">
        <div className="osdi-questionnaire-header">
          <h2 className="osdi-questionnaire-title">Ocular Surface Disease Index (OSDI)</h2>
          <p className="osdi-questionnaire-copy">
            Ask your patient the following 12 questions, and circle the number in the box that best represents each answer. Then, fill in boxes A, B, C, D, and E according to the instructions beside each.
          </p>
        </div>

        <div className="osdi-section-list">
          {OSDI_SECTIONS.map((section, sectionIndex) => (
            <section key={section.id} className="osdi-section">
              <h3 className="osdi-section-title">{section.title}</h3>
              <div className={`osdi-grid-header ${section.items[0]?.options.includes('NA') ? 'has-na' : ''}`}>
                <span className="osdi-grid-header-spacer"></span>
                {(section.items[0]?.options.includes('NA') ? columnLabelsWithNa : columnLabels).map((label) => (
                  <span key={label} className="osdi-grid-column-title">{label}</span>
                ))}
              </div>

              <div className="osdi-row-list">
                {section.items.map((item) => {
                  const selectedValue = String(osdiResponses[item.key] ?? '0')

                  return (
                    <div key={item.key} className={`osdi-row ${item.options.includes('NA') ? 'has-na' : ''}`}>
                      <div className="osdi-row-question">{item.prompt}</div>
                      {item.options.map((option) => {
                        const isSelected = selectedValue === option

                        return (
                          <button
                            key={`${item.key}-${option}`}
                            type="button"
                            className={`osdi-choice-pill ${isSelected ? 'active' : ''}`}
                            onClick={() => onChangeOsdiResponse(item.key, option)}
                          >
                            <span className="osdi-choice-value">{option}</span>
                            <span className={`osdi-choice-circle ${isSelected ? 'active' : ''}`} aria-hidden="true"></span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              <div className="osdi-subtotal-row">
                <span className="osdi-subtotal-label">{section.subtotalLabel}</span>
                <span className="osdi-score-box">{subtotalValues[sectionIndex] ?? 0}</span>
              </div>
            </section>
          ))}
        </div>

        <div className="osdi-formula-panel">
          <div className="osdi-formula-line">
            <span>ADD SUBTOTALS A, B, AND C TO OBTAIN D</span>
            <span className="osdi-score-box">{osdiResult?.score_d ?? 0}</span>
          </div>
          <div className="osdi-formula-caption">(D = SUM OF SCORES FOR ALL QUESTIONS ANSWERED)</div>
          <div className="osdi-formula-line">
            <span>TOTAL NUMBER OF QUESTIONS ANSWERED</span>
            <span className="osdi-score-box">{osdiResult?.score_e ?? 0}</span>
          </div>
          <div className="osdi-formula-caption">(DO NOT INCLUDE QUESTIONS ANSWERED N/A)</div>
        </div>

        <div className="osdi-evaluation">
          <h3 className="osdi-evaluation-title">Evaluating the OSDI Score</h3>
          <p className="osdi-evaluation-copy">
            The OSDI is assessed on a scale of 0 to 100, with higher scores representing greater disability. The index demonstrates sensitivity and specificity in distinguishing between normal subjects and patients with dry eye disease.
          </p>
          <h3 className="osdi-evaluation-title">Assessing Your Patient Dry Eye Disease</h3>
          <p className="osdi-evaluation-copy">
            Use your answers D and E to compare the sum of scores for all questions answered and the number of questions answered. This lets you determine whether your patient score indicates normal, mild, moderate, or severe dry eye disease.
          </p>
        </div>

        <div className="osdi-score-summary">
          <div className="osdi-score-summary-card">
            <span>OSDI Score</span>
            <strong>{formatMetric(osdiResult?.osdi_score ?? 0)}</strong>
          </div>
          <div className="osdi-score-summary-card">
            <span>Interpretation</span>
            <strong>{osdiResult?.interpretation || 'Normal'}</strong>
          </div>
        </div>

        <div className="osdi-footer-fields">
          <div className="osdi-footer-field">
            <label>How long has the patient experienced dry eye?</label>
            <input
              type="text"
              name="osdi-duration"
              className="clinical-test-input osdi-footer-input"
              value={osdiDuration}
              onChange={(event) => onChangeOsdiDuration(event.target.value)}
            />
          </div>
          <div className="osdi-footer-field">
            <label>Eye Care Professional&apos;s Comments:</label>
            <input
              type="text"
              name="osdi-comments"
              className="clinical-test-input osdi-footer-input"
              value={osdiComments}
              onChange={(event) => onChangeOsdiComments(event.target.value)}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`clinical-test-panel ${activeSection === 'bulbar-redness' ? 'clinical-test-panel-centered' : ''}`}>
      <div className={`clinical-test-card ${activeSection === 'deq' ? 'clinical-test-card-deq' : ''} ${activeSection === 'osdi' ? 'clinical-test-card-osdi' : ''} ${activeSection === 'bulbar-redness' ? 'clinical-test-card-centered clinical-test-card-bulbar' : ''}`}>
        {activeSection === 'deq' && (
          renderDeqQuestionnaire()
        )}

        {activeSection === 'osdi' && (
          renderOsdiQuestionnaire()
        )}
        {false && (
          <>
            <div className="clinical-test-header">
              <div>
                <div className="clinical-test-label">OSDI</div>
                <h3 className="clinical-test-title">Ocular Surface Disease Index</h3>
                <p className="clinical-test-subtitle">Imported 12-question OSDI workflow with `D × 25 ÷ E` scoring and `NA` handling for activity and environment items.</p>
              </div>
            </div>
            <div className="clinical-test-summary-grid clinical-test-summary-grid-wide">
              <div className="clinical-test-summary-card"><span>Subtotal A</span><strong>{osdiResult?.subtotal_a ?? 0}</strong></div>
              <div className="clinical-test-summary-card"><span>Subtotal B</span><strong>{osdiResult?.subtotal_b ?? 0}</strong></div>
              <div className="clinical-test-summary-card"><span>Subtotal C</span><strong>{osdiResult?.subtotal_c ?? 0}</strong></div>
              <div className="clinical-test-summary-card"><span>Score D</span><strong>{osdiResult?.score_d ?? 0}</strong></div>
              <div className="clinical-test-summary-card"><span>Answered E</span><strong>{osdiResult?.score_e ?? 0}</strong></div>
              <div className="clinical-test-summary-card"><span>OSDI Score</span><strong>{formatMetric(osdiResult?.osdi_score ?? 0)}</strong></div>
            </div>
            <div className="clinical-test-note">{osdiResult?.interpretation || 'Normal'}</div>
            {renderSelectQuestionList(
              OSDI_QUESTIONS,
              osdiResponses,
              onChangeOsdiResponse,
              (index) => (index >= 5 ? OSDI_SECONDARY_OPTIONS : OSDI_PRIMARY_OPTIONS)
            )}
            <div className="clinical-test-fields-grid">
              <div className="clinical-test-field">
                <label>Dry eye duration</label>
                <input
                  type="text"
                  name="legacy-osdi-duration"
                  className="clinical-test-input"
                  value={osdiDuration}
                  onChange={(event) => onChangeOsdiDuration(event.target.value)}
                  placeholder="e.g. 6 months"
                />
              </div>
              <div className="clinical-test-field">
                <label>Clinician comments</label>
                <input
                  type="text"
                  name="legacy-osdi-comments"
                  className="clinical-test-input"
                  value={osdiComments}
                  onChange={(event) => onChangeOsdiComments(event.target.value)}
                  placeholder="Short clinical note"
                />
              </div>
            </div>
          </>
        )}

        {activeSection === 'contrast-sensitivity' && (
          <>
            {!showContrastWorkflow ? renderContrastSetup() : (
              <>
                <div className="clinical-test-header">
                  <div>
                    <div className="clinical-test-label">Contrast Sensitivity</div>
                    <h3 className="clinical-test-title">AULCSF workflow</h3>
                    <p className="clinical-test-subtitle">Imported A-D spatial-frequency entry with `AULCSF` calculation for OD/OS pre-op and post-op rows.</p>
                  </div>
                </div>
                <div className="clinical-test-field">
                  <label>Test type</label>
                  <select
                    name="contrast-test-type"
                    className="clinical-test-select"
                    value={contrastSensitivity?.testName || 'Glaucoma'}
                    onChange={(event) => onChangeContrastTestName(event.target.value)}
                  >
                    {CONTRAST_TEST_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="clinical-test-table">
                  <div className="clinical-test-table-header">
                    <span>Row</span>
                    {CONTRAST_COLUMNS.map((column) => (
                      <span key={column}>{column}</span>
                    ))}
                    <span>AULCSF</span>
                  </div>
                  {CONTRAST_ROWS.map((row) => {
                    const rowValues = contrastRows[row.key] || {}
                    const rowResult = contrastResult?.rows?.[row.key]
                    return (
                      <div key={row.key} className="clinical-test-table-row">
                        <span className="clinical-test-table-label">{row.label}</span>
                        {CONTRAST_COLUMNS.map((column) => (
                          <input
                            key={`${row.key}-${column}`}
                            type="number"
                            name={`contrast-${row.key}-${column.toLowerCase()}`}
                            step="0.1"
                            className="clinical-test-input clinical-test-table-input"
                            value={rowValues[column] ?? ''}
                            onChange={(event) => onChangeContrastValue(row.key, column, event.target.value)}
                            placeholder={column}
                          />
                        ))}
                        <strong className="clinical-test-table-metric">{formatAulcsf(rowResult?.aulcsf)}</strong>
                      </div>
                    )
                  })}
                </div>
                <div className="clinical-test-summary-grid">
                  <div className="clinical-test-summary-card"><span>OD Change</span><strong>{formatDelta(contrastComparisons.od_delta_aulcsf)}</strong></div>
                  <div className="clinical-test-summary-card"><span>OS Change</span><strong>{formatDelta(contrastComparisons.os_delta_aulcsf)}</strong></div>
                  <div className="clinical-test-summary-card"><span>Profile</span><strong>{contrastResult?.test_name || contrastSensitivity?.testName || 'Glaucoma'}</strong></div>
                </div>
              </>
            )}
          </>
        )}

        {activeSection === 'bulbar-redness' && (
          renderBulbarRednessReference()
        )}

        {activeSection === 'posterior-segment' && (
          renderPosteriorFrontend()
        )}

        {(activeSection !== 'contrast-sensitivity' || showContrastWorkflow) && activeSection !== 'bulbar-redness' && (
        <div className="clinical-test-actions">
          <ReportSegmentedControl
            className="report-segmented-control"
            onSaveReport={onSaveReport}
            onDownloadReport={onDownloadReport}
            isSavingReport={isSavingReport}
          />
        </div>
        )}
      </div>
    </div>
  )
}

export default AdditionalTestsPanel

// Shared constants, state helpers, and pure utilities for the meibography exam workspace.
import { boundImageHistory } from './imageHistory.js'

export const INITIAL_IMAGES = {
  L_Upper: null,
  L_Lower: null,
  R_Upper: null,
  R_Lower: null
}

export const getImageKey = (eye, lid) => {
  const eyePrefix = eye === 'left' ? 'L' : 'R'
  const lidSuffix = lid === 'upper' ? 'Upper' : 'Lower'
  return `${eyePrefix}_${lidSuffix}`
}

export const formatLidLabel = (lid) => (lid === 'upper' ? 'Upper' : 'Lower')

export const getLidMismatchPrompt = (lid) => {
  const targetLid = lid === 'upper' ? 'upper' : 'lower'
  return `This image is for the ${targetLid} lid. Select the ${targetLid} lid to continue.`
}

export const createImageState = (images = INITIAL_IMAGES) => ({
  images: { ...images },
  undoStack: [],
  redoStack: []
})

export {
  BLINK_ALLOWED_EXTENSIONS, BLINK_ALLOWED_MIME_PREFIX, BLINK_RECORDING_DURATION_SECONDS,
  BLINK_LIVE_ANALYSIS_INTERVAL_MS, BLINK_LIVE_CAPTURE_WIDTH, createLocalBlinkLandmarker,
  extractBlinkFrameResultFromLocalLandmarker, interpretBlinkBand, interpretBlinkRate
} from '../blink/blinkDetection.js'
export const MIN_TEAR_REVIEW_ZOOM = 1
export const MAX_TEAR_REVIEW_ZOOM = 5
export const TEAR_REVIEW_ZOOM_STEP = 0.25
export const TEAR_POINT_HIT_RADIUS = 0.035
export const AUTO_ENHANCE_DELAY_MS = 150
export const MEIBOGRAPHY_STAGE_DELAY_MS = 650
export const MEIBOGRAPHY_GLAND_STEP_DELAY_MS = 180
export const MEIBOGRAPHY_ANALYSIS_STAGE_DELAY_MS = 800
export const DEQ_RESPONSE_COUNT = 5
export const OSDI_RESPONSE_COUNT = 12
export const ADDITIONAL_TEST_SECTIONS = ['bulbar-redness', 'deq', 'osdi', 'contrast-sensitivity', 'posterior-segment']
export const CAMERA_AUTO_START_SECTIONS = ['meibography', 'tear-meniscus', 'blink-rate']
export const CAMERA_SESSION_SECTIONS = [...CAMERA_AUTO_START_SECTIONS, 'bulbar-redness']
export const TEST_SECTION_LABELS = {
  meibography: 'Meibography',
  'tear-meniscus': 'Tear Meniscus',
  'blink-rate': 'Blink Rate Evaluation',
  'bulbar-redness': 'Bulbar Redness Analysis',
  deq: 'DEQ',
  osdi: 'OSDI',
  'contrast-sensitivity': 'Contrast Sensitivity',
  'posterior-segment': 'Posterior Segment'
}

export const BULBAR_REDNESS_OPTIONS = [
  { id: 'very-slight', label: 'Very Slight' },
  { id: 'slight', label: 'Slight' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'severe', label: 'Severe' }
]

export const CONTRAST_SPATIAL_FREQUENCIES = [3, 6, 12, 18]

const INITIAL_CONTRAST_ROWS = {
  od_pre: { A: '', B: '', C: '', D: '' },
  od_post: { A: '', B: '', C: '', D: '' },
  os_pre: { A: '', B: '', C: '', D: '' },
  os_post: { A: '', B: '', C: '', D: '' }
}

export const createInitialContrastState = () => ({
  testName: 'Glaucoma',
  rows: {
    od_pre: { ...INITIAL_CONTRAST_ROWS.od_pre },
    od_post: { ...INITIAL_CONTRAST_ROWS.od_post },
    os_pre: { ...INITIAL_CONTRAST_ROWS.os_pre },
    os_post: { ...INITIAL_CONTRAST_ROWS.os_post }
  }
})

export const createInitialPosteriorSegmentState = () => ({
  left: { impression: 'Normal', report: '', recommendation: '' },
  right: { impression: 'Normal', report: '', recommendation: '' }
})

export const createInitialClinicalResults = () => ({
  deq: null,
  osdi: null,
  contrast: null,
  posterior: null
})

let jsPdfModulePromise = null

export const loadJsPdfModule = async () => {
  if (!jsPdfModulePromise) {
    jsPdfModulePromise = import('jspdf')
  }
  return jsPdfModulePromise
}


export const normalizeImageSlots = (images = {}) => ({
  ...INITIAL_IMAGES,
  ...(images || {})
})

export const getBulbarRednessLabel = (value) => (
  BULBAR_REDNESS_OPTIONS.find((option) => option.id === value)?.label || ''
)

export const createInitialMeibographyWorkflowState = () => ({
  stage: 'idle',
  title: '',
  detail: '',
  visiblePreviewKeys: []
})

export const buildMeibographyAnalysisDetail = (result) => {
  if (!result) {
    return 'Coverage, dropout, and grade will appear here after analysis.'
  }

  const coverage = Number(result?.coverage_pct ?? result?.coveragePct ?? 0).toFixed(1)
  const dropout = Number(result?.dropout_pct ?? result?.dropoutPct ?? 0).toFixed(1)
  const grade = result?.grade || 'N/A'
  return `Coverage ${coverage}% | Dropout ${dropout}% | ${grade}`
}

export const clampReportValue = (value, fallback = 0) => {
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : fallback
  return Math.max(0, Math.min(100, numericValue))
}

const loadImageFromDataUrl = (imageDataUrl) => (
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load the selected image.'))
    image.src = imageDataUrl
  })
)

export const blobToDataUrl = (blob) => (
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Unable to convert image blob.'))
    }
    reader.onerror = () => reject(new Error('Unable to read image blob.'))
    reader.readAsDataURL(blob)
  })
)

export const enhanceImageDataUrlInBrowser = async (imageDataUrl) => {
  const image = await loadImageFromDataUrl(imageDataUrl)
  const canvas = document.createElement('canvas')
  const sourceMaxDimension = Math.max(image.width, image.height)
  const scaleFactor = sourceMaxDimension < 1600
    ? Math.min(2, 1600 / Math.max(sourceMaxDimension, 1))
    : 1
  canvas.width = Math.max(1, Math.round(image.width * scaleFactor))
  canvas.height = Math.max(1, Math.round(image.height * scaleFactor))

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create enhancement context.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const frame = context.getImageData(0, 0, canvas.width, canvas.height)
  const { data, width, height } = frame
  const pixelCount = width * height
  const gray = new Float32Array(pixelCount)
  const claheLike = new Float32Array(pixelCount)
  const microBlur = new Float32Array(pixelCount)
  const macroBlur = new Float32Array(pixelCount)
  const enhancedLuminance = new Float32Array(pixelCount)
  const histogram = new Uint32Array(256)

  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    gray[index] = (0.299 * data[offset]) + (0.587 * data[offset + 1]) + (0.114 * data[offset + 2])
    claheLike[index] = Math.max(0, Math.min(255, Math.pow(gray[index] / 255, 0.9) * 255))
  }

  const applyKernelBlur = (source, target, kernelWeights) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0
        let weight = 0
        let kernelIndex = 0
        for (let ky = -1; ky <= 1; ky += 1) {
          const sampleY = Math.min(height - 1, Math.max(0, y + ky))
          for (let kx = -1; kx <= 1; kx += 1) {
            const sampleX = Math.min(width - 1, Math.max(0, x + kx))
            const kernelWeight = kernelWeights[kernelIndex]
            sum += source[(sampleY * width) + sampleX] * kernelWeight
            weight += kernelWeight
            kernelIndex += 1
          }
        }
        target[(y * width) + x] = sum / weight
      }
    }
  }

  applyKernelBlur(claheLike, microBlur, [1, 2, 1, 2, 4, 2, 1, 2, 1])
  applyKernelBlur(microBlur, macroBlur, [1, 2, 1, 2, 4, 2, 1, 2, 1])

  for (let index = 0; index < pixelCount; index += 1) {
    const fineDetail = claheLike[index] - microBlur[index]
    const ridgeDetail = microBlur[index] - macroBlur[index]
    const lifted = Math.max(
      0,
      Math.min(255, claheLike[index] + (fineDetail * 1.45) + (ridgeDetail * 0.65))
    )
    enhancedLuminance[index] = lifted
    histogram[Math.round(lifted)] += 1
  }

  let cumulative = 0
  const lowCutCount = pixelCount * 0.01
  const highCutCount = pixelCount * 0.995
  let lowBound = 0
  let highBound = 255
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value]
    if (cumulative >= lowCutCount) {
      lowBound = value
      break
    }
  }

  cumulative = 0
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value]
    if (cumulative >= highCutCount) {
      highBound = value
      break
    }
  }

  for (let index = 0; index < pixelCount; index += 1) {
    const luminance = enhancedLuminance[index]
    const stretched = highBound <= lowBound
      ? luminance
      : ((luminance - lowBound) / (highBound - lowBound)) * 255
    const gammaLifted = Math.pow(Math.max(0, Math.min(1, stretched / 255)), 0.9) * 255
    const output = Math.max(0, Math.min(255, Math.round((gray[index] * 0.08) + (gammaLifted * 0.92))))
    const delta = output - gray[index]
    const offset = index * 4
    data[offset] = Math.max(0, Math.min(255, Math.round(data[offset] + delta)))
    data[offset + 1] = Math.max(0, Math.min(255, Math.round(data[offset + 1] + delta)))
    data[offset + 2] = Math.max(0, Math.min(255, Math.round(data[offset + 2] + delta)))
  }

  context.putImageData(frame, 0, 0)
  return canvas.toDataURL('image/png')
}

export const summarizeDeqResponses = (responses = []) => {
  const total = responses.reduce((sum, value) => sum + Number(value || 0), 0)
  const average = responses.length ? total / responses.length : 0
  let interpretation = 'Normal'
  if (total <= 5) {
    interpretation = 'Normal'
  } else if (total <= 11) {
    interpretation = 'Mild Dry Eye'
  } else if (total <= 16) {
    interpretation = 'Moderate Dry Eye'
  } else {
    interpretation = 'Severe Dry Eye'
  }
  return {
    total_score: total,
    average_score: Number(average.toFixed(1)),
    interpretation
  }
}

export const summarizeOsdiResponses = (responses = [], duration = '', comments = '') => {
  const normalizedResponses = Array.from({ length: OSDI_RESPONSE_COUNT }, (_, index) => {
    const rawValue = responses[index] ?? '0'
    if (index >= 5 && String(rawValue).toUpperCase() === 'NA') {
      return null
    }
    return Number(rawValue || 0)
  })
  const subtotalA = normalizedResponses.slice(0, 5).reduce((sum, value) => sum + (value ?? 0), 0)
  const subtotalB = normalizedResponses.slice(5, 9).reduce((sum, value) => sum + (value ?? 0), 0)
  const subtotalC = normalizedResponses.slice(9).reduce((sum, value) => sum + (value ?? 0), 0)
  const scoreD = subtotalA + subtotalB + subtotalC
  const scoreE = normalizedResponses.filter((value) => value !== null).length
  const osdiScore = scoreE ? Number((((scoreD * 25) / scoreE)).toFixed(1)) : 0
  let interpretation = 'Normal'
  if (osdiScore <= 12) {
    interpretation = 'Normal'
  } else if (osdiScore <= 22) {
    interpretation = 'Mild Dry Eye'
  } else if (osdiScore <= 32) {
    interpretation = 'Moderate Dry Eye'
  } else {
    interpretation = 'Severe Dry Eye'
  }
  return {
    duration: duration || '--',
    comments: comments || '--',
    subtotal_a: subtotalA,
    subtotal_b: subtotalB,
    subtotal_c: subtotalC,
    score_d: scoreD,
    score_e: scoreE,
    osdi_score: osdiScore,
    interpretation
  }
}

export const calculateAulcsf = (values = []) => {
  if (values.some((value) => value === null)) {
    return null
  }

  const logFrequencies = CONTRAST_SPATIAL_FREQUENCIES.map((value) => Math.log10(value))
  const logValues = values.map((value) => Math.log10(Math.max(value, 0.01)))
  let area = 0
  for (let index = 0; index < logFrequencies.length - 1; index += 1) {
    area += ((logFrequencies[index + 1] - logFrequencies[index]) * (logValues[index] + logValues[index + 1])) / 2
  }
  return Number(area.toFixed(3))
}


export const summarizeContrastSensitivity = (contrastSensitivity = createInitialContrastState()) => {
  const rows = Object.entries(contrastSensitivity.rows || {}).reduce((summary, [rowKey, rowValues]) => {
    const normalizedValues = ['A', 'B', 'C', 'D'].reduce((columns, columnKey) => {
      const rawValue = rowValues?.[columnKey]
      const numericValue = rawValue === '' || rawValue === null || rawValue === undefined ? null : Number(rawValue)
      return {
        ...columns,
        [columnKey]: Number.isFinite(numericValue) ? numericValue : null
      }
    }, {})
    const aulcsf = calculateAulcsf(Object.values(normalizedValues))
    return {
      ...summary,
      [rowKey]: {
        values: normalizedValues,
        aulcsf
      }
    }
  }, {})

  const odPre = rows.od_pre?.aulcsf
  const odPost = rows.od_post?.aulcsf
  const osPre = rows.os_pre?.aulcsf
  const osPost = rows.os_post?.aulcsf

  return {
    test_name: contrastSensitivity.testName || 'Glaucoma',
    rows,
    comparisons: {
      od_delta_aulcsf: Number.isFinite(odPre) && Number.isFinite(odPost) ? Number((odPost - odPre).toFixed(3)) : null,
      os_delta_aulcsf: Number.isFinite(osPre) && Number.isFinite(osPost) ? Number((osPost - osPre).toFixed(3)) : null
    }
  }
}

export const summarizePosteriorSegment = (posteriorSegment = createInitialPosteriorSegmentState()) => (
  ['left', 'right'].reduce((summary, eye) => {
    const currentValue = posteriorSegment?.[eye] || {}
    const impression = String(currentValue.impression || currentValue.diagnosis || 'Normal').trim() || 'Normal'
    const report = String(currentValue.report || currentValue.findings || '').trim()
    const recommendation = String(currentValue.recommendation || '').trim()
    return {
      ...summary,
      [eye]: {
        impression,
        report,
        recommendation,
        summary: [impression, report, recommendation].filter(Boolean).join(' | ')
      }
    }
  }, {})
)

export const getAnnotationLabelPosition = (points = []) => {
  if (!points.length) {
    return null
  }

  const anchorPoint = points[0]
  return {
    x: Math.min(78, Math.max(6, anchorPoint.x * 100 + 3)),
    y: Math.min(18, Math.max(8, anchorPoint.y * 100 - 4))
  }
}

export const imageReducer = (state, action) => {
  switch (action.type) {
    case 'SET_SLOT': {
      const nextImages = {
        ...state.images,
        [action.key]: action.value
      }
      if (nextImages[action.key] === state.images[action.key]) {
        return state
      }
      return {
        images: nextImages,
        undoStack: boundImageHistory([...state.undoStack, state.images], nextImages),
        redoStack: []
      }
    }
    case 'RESET_SLOT': {
      if (!state.images[action.key]) {
        return state
      }
      return {
        images: {
          ...state.images,
          [action.key]: null
        },
        undoStack: boundImageHistory([...state.undoStack, state.images], { ...state.images, [action.key]: null }),
        redoStack: []
      }
    }
    case 'UNDO': {
      if (!state.undoStack.length) {
        return state
      }
      const previousImages = state.undoStack[state.undoStack.length - 1]
      return {
        images: previousImages,
        undoStack: boundImageHistory(state.undoStack.slice(0, -1), previousImages),
        redoStack: boundImageHistory([...state.redoStack, state.images], previousImages)
      }
    }
    case 'REDO': {
      if (!state.redoStack.length) {
        return state
      }
      const nextImages = state.redoStack[state.redoStack.length - 1]
      return {
        images: nextImages,
        undoStack: boundImageHistory([...state.undoStack, state.images], nextImages),
        redoStack: boundImageHistory(state.redoStack.slice(0, -1), nextImages)
      }
    }
    case 'REPLACE_ALL': {
      return createImageState(normalizeImageSlots(action.images))
    }
    default:
      return state
  }
}

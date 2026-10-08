import assert from 'node:assert/strict'

// Browser checks use CSS pixels. The last four sizes approximate a 1280/1440px
// desktop at 125% and 150% browser zoom, which also exercises layout breakpoints.
export const EXAM_LAYOUT_VIEWPORTS = [
  { width: 390, height: 844, label: 'phone' },
  { width: 768, height: 1024, label: 'portrait tablet' },
  { width: 1024, height: 768, label: 'landscape tablet' },
  { width: 1280, height: 720, label: 'small desktop' },
  { width: 1440, height: 900, label: 'desktop' },
  { width: 1920, height: 1080, label: 'large desktop' },
  { width: 1024, height: 576, label: '1280px desktop at 125% zoom' },
  { width: 853, height: 480, label: '1280px desktop at 150% zoom' },
  { width: 1152, height: 720, label: '1440px desktop at 125% zoom' },
  { width: 960, height: 600, label: '1440px desktop at 150% zoom' }
]

// This function is deliberately self-contained so CDP can evaluate its source
// in the browser without injecting a testing dependency into the application.
export function captureExamGeometry() {
  const rect = element => {
    if (!element) return null
    const bounds = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (!bounds.width || !bounds.height || style.display === 'none' || style.visibility === 'hidden') return null
    return {
      left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
      width: bounds.width, height: bounds.height,
      scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      scrollTop: element.scrollTop
    }
  }
  const describe = element => element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`
  const clippedText = element => {
    if (!element.matches('button')) return []
    return [...element.querySelectorAll('span')].filter(child => {
      const bounds = child.getBoundingClientRect()
      const style = getComputedStyle(child)
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden'
        && child.scrollWidth > child.clientWidth + 2
        && (/^(hidden|clip)$/.test(style.overflowX) || style.whiteSpace === 'nowrap')
    }).map(child => ({ text: child.textContent.trim(), width: child.clientWidth, requiredWidth: child.scrollWidth }))
  }
  const clipping = element => {
    const bounds = rect(element)
    if (!bounds) return []
    const failures = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const parentBounds = parent.getBoundingClientRect()
      const style = getComputedStyle(parent)
      const clipsX = /^(hidden|clip)$/.test(style.overflowX)
      const clipsY = /^(hidden|clip)$/.test(style.overflowY)
      if (clipsX && (bounds.left < parentBounds.left - 2 || bounds.right > parentBounds.right + 2)) {
        failures.push({ axis: 'horizontal', ancestor: describe(parent) })
      }
      if (clipsY && (bounds.top < parentBounds.top - 2 || bounds.bottom > parentBounds.bottom + 2)) {
        failures.push({ axis: 'vertical', ancestor: describe(parent) })
      }
    }
    return failures
  }
  const elements = {
    container: '.meibography-container', sidebar: '.meibography-sidebar',
    main: '.meibography-main', header: '.meibography-top-header', guide: '.exam-guide',
    toolbar: '.meibography-action-toolbar', content: '.meibography-content',
    panel: '.meibography-container > .ocular-analysis-panel',
    panelHeading: '.meibography-container > .ocular-analysis-panel .ocular-analysis-label',
    camera: '.blink-counter-preview-shell', cameraCard: '.blink-counter-card',
    media: '.blink-counter-preview-video', calculator: '.blink-manual-card'
  }
  const boxes = Object.fromEntries(Object.entries(elements).map(([key, selector]) => [key, rect(document.querySelector(selector))]))
  const controls = [...document.querySelectorAll([
    '.meibography-action-toolbar button', '.meibography-action-toolbar input',
    '.meibography-content button', '.meibography-content input', '.meibography-content select',
    '.meibography-content textarea', '.ocular-analysis-panel button',
    '.ocular-analysis-panel input', '.ocular-analysis-panel select',
    '.ocular-analysis-panel textarea', '#patient-select'
  ].join(','))].map(element => ({
    selector: describe(element), label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 80),
    bounds: rect(element), clipping: clipping(element), clippedText: clippedText(element)
  })).filter(control => control.bounds)
  const panelHeading = document.querySelector(elements.panelHeading)
  return {
    viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    boxes, controls,
    headingClipping: panelHeading ? clipping(panelHeading) : [],
    cameraClipping: document.querySelector(elements.camera) ? clipping(document.querySelector(elements.camera)) : []
  }
}

export const examGeometryExpression = `(${captureExamGeometry.toString()})()`

export function assertExamGeometry(snapshot, { section = 'blink-rate', label = '', tolerance = 2 } = {}) {
  const { viewport, document: documentSize, boxes, controls } = snapshot
  const context = `${label || `${viewport.width}x${viewport.height}`} ${section}`
  const check = (condition, message) => assert.ok(condition, `${context}: ${message}`)
  const describeBounds = bounds => JSON.stringify(bounds)
  check(documentSize.width <= viewport.width + tolerance, `page overflows horizontally (${documentSize.width}px > ${viewport.width}px)`)
  check(boxes.container && boxes.main && boxes.guide, 'exam workspace and instructions must render')
  for (const name of ['main', 'header', 'guide', 'toolbar', 'content', 'panel', 'camera', 'cameraCard', 'calculator']) {
    const bounds = boxes[name]
    if (!bounds) continue
    check(bounds.left >= -tolerance && bounds.right <= viewport.width + tolerance, `${name} extends past the screen: ${describeBounds(bounds)}`)
  }
  for (const control of controls) {
    check(control.bounds.left >= -tolerance && control.bounds.right <= viewport.width + tolerance,
      `control "${control.label || control.selector}" extends past the screen: ${describeBounds(control.bounds)}`)
    check(!control.clipping.length,
      `control "${control.label || control.selector}" is hidden by an ancestor: ${JSON.stringify(control.clipping)}`)
    check(!control.clippedText?.length,
      `control text is truncated: ${JSON.stringify(control.clippedText)}`)
  }
  check(!snapshot.headingClipping.length, `result heading is clipped: ${JSON.stringify(snapshot.headingClipping)}`)

  if (boxes.panel) {
    const sideBySide = boxes.panel.left >= boxes.main.right - tolerance
    if (sideBySide) {
      check(boxes.panel.top >= boxes.container.top - tolerance,
        'result panel starts above the workspace')
      check(boxes.panel.top <= boxes.container.top + 64,
        'result panel must start near the top of the workspace')
      check(boxes.panel.width >= 240, `result panel is too narrow to read (${boxes.panel.width}px)`)
    } else {
      check(boxes.panel.top >= boxes.main.bottom - tolerance,
        'stacked result panel overlaps the exam content')
      check(boxes.panel.width >= boxes.main.width * 0.85,
        `stacked result panel should use available width (${boxes.panel.width}px for ${boxes.main.width}px main area)`)
    }
    if (boxes.panelHeading) {
      check(boxes.panelHeading.top >= boxes.panel.top - tolerance,
        'result heading has scrolled above its panel')
    }
  }

  if (section === 'blink-rate') {
    check(boxes.panel && boxes.calculator, 'blink results and camera-free calculator must render')
    check(boxes.camera && boxes.media, 'camera preview must render')
    check(boxes.camera.width >= 180 && boxes.camera.height >= 120, 'camera preview must remain usable')
    check(boxes.camera.height <= Math.min(500, viewport.height * 0.65) + tolerance,
      `camera preview dominates the screen (${boxes.camera.height}px in a ${viewport.height}px viewport)`)
    check(boxes.media.left >= boxes.camera.left - tolerance && boxes.media.right <= boxes.camera.right + tolerance
      && boxes.media.top >= boxes.camera.top - tolerance && boxes.media.bottom <= boxes.camera.bottom + tolerance,
    `camera image extends past its frame: ${describeBounds(boxes.media)}`)
    check(!snapshot.cameraClipping.length, `camera frame is clipped: ${JSON.stringify(snapshot.cameraClipping)}`)
  }
  return { section, width: viewport.width, height: viewport.height, controlsChecked: controls.length }
}

import { scoreDemoDEQ, scoreDemoOSDI, summarizeDemoContrast, summarizeDemoPosterior } from './clinical.js'

const number = (value, places = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(places) : 'Unavailable'
const readable = (value) => String(value ?? '').replace(/[^\x20-\x7E\n]/g, ' ').trim()

// Reconstruct complete text results after a refresh releases the original PDF.
// Seeded examples and actual guest entries retain distinct labels.
export const buildGuestReportSections = (report) => {
  const data = report.session_data || {}
  const tests = report.completed_tests || []
  const sections = []
  const add = (title, lines) => {
    const content = lines.filter((line) => String(line || '').trim()).map(readable)
    if (content.length) sections.push({ title, lines: content })
  }
  add('Left eye summary', [report.left_analysis])
  add('Right eye summary', [report.right_analysis])
  Object.entries(data.meibographyResults || {}).forEach(([slot, result]) => {
    if (!result) return
    add(`Meibography - ${slot.replaceAll('_', ' ')}`, [
      result.summary, `Coverage: ${number(result.coveragePct)}% | Dropout: ${number(result.dropoutPct)}%`,
      `Grade: ${result.grade || 'Unavailable'} | Glands: ${result.glandCount ?? 'Unavailable'}`,
      result.measurementMethod ? `Method: ${result.measurementMethod}` : ''
    ])
  })
  Object.entries(data.tearMeasurements || {}).forEach(([eye, result]) => {
    if (!result) return
    add(`Tear meniscus - ${eye} eye`, [result.summary,
      `Height: ${number(result.tmhMm, 3)} mm | Distance: ${number(result.distancePixels)} px`,
      result.statusLabel, result.corneaWidthPixels ? `Corneal span: ${number(result.corneaWidthPixels)} px` : ''])
  })
  const blink = data.blinkCounterResult
  if (blink) add('Blink rate', [
    `Count: ${blink.totalBlinks ?? 0} | Duration: ${number(blink.sessionDurationSeconds)} seconds`,
    `Rate: ${blink.bpmOverall == null ? 'Unavailable' : `${number(blink.bpmOverall)} blinks/min`}`,
    blink.interpretation, `Method: ${blink.modelName || blink.sessionMode || 'Entered observation'}`
  ])
  const calculate = (key, fallback) => {
    if (data.clinicalResults?.[key]) return data.clinicalResults[key]
    try { return fallback() } catch { return null }
  }
  if (tests.includes('DEQ')) {
    const result = calculate('deq', () => scoreDemoDEQ({ responses: data.deqResponses }))
    if (result) add('DEQ', [`Score: ${result.total_score} | ${result.interpretation}`])
  }
  if (tests.includes('OSDI')) {
    const result = calculate('osdi', () => scoreDemoOSDI({ responses: data.osdiResponses, duration: data.osdiDuration, comments: data.osdiComments }))
    if (result) add('OSDI', [`Score: ${result.osdi_score} | ${result.interpretation}`, `Answered questions: ${result.score_e}`, data.osdiDuration, data.osdiComments])
  }
  if (data.bulbarRedness?.selectedId) add('Bulbar redness', [data.bulbarRedness.selectedLabel || `Selected grade: ${data.bulbarRedness.selectedId}`])
  if (tests.some((test) => /contrast/i.test(test))) {
    const result = calculate('contrast', () => summarizeDemoContrast(data.contrastSensitivity || {}))
    if (result) add('Contrast sensitivity', Object.values(result.rows || {}).map((row) => `${row.label}: ${Object.entries(row.values || {}).map(([column, value]) => `${column} ${value ?? 'N/A'}`).join(', ')} | AULCSF ${row.aulcsf ?? 'N/A'}`))
  }
  if (tests.some((test) => /posterior/i.test(test))) {
    const result = calculate('posterior', () => summarizeDemoPosterior(data.posteriorSegment || {}))
    if (result) add('Posterior segment', ['left', 'right'].map((eye) => `${eye} eye: ${result[eye]?.summary || 'No entry'}`))
  }
  return sections
}

export const downloadGuestSampleReport = async (report) => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF()
  let y = 24
  const write = (text, size = 11, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    pdf.setFontSize(size)
    const lines = pdf.splitTextToSize(readable(text), 170)
    for (const line of lines) {
      if (y > 274) { pdf.addPage(); y = 24 }
      pdf.text(line, 20, y)
      y += size * 0.45 + 2
    }
    y += 3
  }
  write(report.demo_sample ? 'MeiboPix - Sample report' : 'MeiboPix - Guest test results', 20, true)
  write(report.demo_sample ? 'FICTIONAL DEMONSTRATION - NOT FOR CLINICAL USE' : 'Guest session - test results and user-entered measurements', 10)
  write(`Name: ${report.patient?.full_name || 'Guest'} | Age: ${report.patient?.age ?? '-'} | Gender: ${report.patient?.gender || '-'}`)
  write(`Date: ${report.created_at ? new Date(report.created_at).toLocaleString() : 'Current session'}`)
  write(`Tests: ${(report.completed_tests || []).join(', ') || 'Eye assessment'}`)
  for (const section of buildGuestReportSections(report)) {
    write(section.title, 12, true)
    section.lines.forEach((line) => write(line))
  }
  pdf.save(`meibopix-${report.demo_sample ? 'sample' : 'guest'}-${report.id}.pdf`)
}

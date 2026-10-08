// Mirror the existing API's questionnaire/entry arithmetic without uploading guest data.
// These are demonstration calculations, not an automated diagnosis.
const round = (number, places = 1) => Number(number.toFixed(places))
const text = (value, fallback = '') => String(value ?? '').trim() || fallback
const parseResponse = (value, allowNA = false) => {
  if (allowNA && String(value).toUpperCase() === 'NA') return null
  if (value === null || value === undefined || value === '') throw new Error('Please answer every required question.')
  const score = Number(value)
  if (!Number.isInteger(score) || score < 0 || score > 4) throw new Error('Answers must be whole numbers from 0 to 4.')
  return score
}
const answers = (payload, count, allowNA = false) => {
  if (!Array.isArray(payload.responses) || payload.responses.length !== count) throw new Error(`Please provide ${count} answers.`)
  return payload.responses.map((value, index) => parseResponse(value, allowNA && index >= 5))
}

export const scoreDemoDEQ = (payload) => {
  const values = answers(payload, 5)
  const total = values.reduce((sum, value) => sum + value, 0)
  return { question_count: 5, total_score: total, average_score: round(total / 5), suggests_dry_eye: total >= 6, interpretation: total <= 5 ? 'Normal' : total <= 11 ? 'Mild Dry Eye' : total <= 16 ? 'Moderate Dry Eye' : 'Severe Dry Eye' }
}

export const scoreDemoOSDI = (payload) => {
  const values = answers(payload, 12, true)
  const sum = (items) => items.reduce((total, value) => total + (value ?? 0), 0)
  const scoreD = sum(values)
  const scoreE = values.filter((value) => value !== null).length
  const score = round(scoreD * 25 / scoreE)
  return { duration: text(payload.duration, '—'), comments: text(payload.comments, '—'), subtotal_a: sum(values.slice(0, 5)), subtotal_b: sum(values.slice(5, 9)), subtotal_c: sum(values.slice(9)), score_d: scoreD, score_e: scoreE, osdi_score: score, interpretation: score <= 12 ? 'Normal' : score <= 22 ? 'Mild Dry Eye' : score <= 32 ? 'Moderate Dry Eye' : 'Severe Dry Eye' }
}

export const summarizeDemoContrast = (payload) => {
  const labels = { od_pre: 'OD PRE-OP', od_post: 'OD POST-OP', os_pre: 'OS PRE-OP', os_post: 'OS POST-OP' }
  const columns = ['A', 'B', 'C', 'D']
  const frequencies = [3, 6, 12, 18]
  const rows = Object.fromEntries(Object.entries(labels).map(([key, label]) => {
    const values = Object.fromEntries(columns.map((column) => {
      const raw = payload.rows?.[key]?.[column]
      if (raw === '' || raw === null || raw === undefined) return [column, null]
      const number = Number(raw)
      if (!Number.isFinite(number) || number < 0) throw new Error('Contrast values must be zero or greater.')
      return [column, round(number, 3)]
    }))
    const numbers = Object.values(values)
    const area = numbers.some((value) => value === null) ? null : round(frequencies.slice(1).reduce((sum, frequency, index) => sum + (Math.log10(frequency) - Math.log10(frequencies[index])) * (Math.log10(Math.max(numbers[index], .01)) + Math.log10(Math.max(numbers[index + 1], .01))) / 2, 0), 3)
    return [key, { label, values, aulcsf: area }]
  }))
  const delta = (before, after) => before === null || after === null ? null : round(after - before, 3)
  return { test_name: text(payload.test_name || payload.testName, 'Glaucoma'), rows, comparisons: { od_delta_aulcsf: delta(rows.od_pre.aulcsf, rows.od_post.aulcsf), os_delta_aulcsf: delta(rows.os_pre.aulcsf, rows.os_post.aulcsf) }, spatial_frequencies: frequencies, columns }
}

export const summarizeDemoPosterior = (payload) => Object.fromEntries(['left', 'right'].map((eye) => {
  const data = payload[eye] || {}
  const impression = text(data.impression || data.diagnosis, 'Normal')
  const report = text(data.report || data.findings)
  const recommendation = text(data.recommendation)
  return [eye, { impression, report, recommendation, summary: [impression, report, recommendation].filter(Boolean).join(' · ') }]
}))

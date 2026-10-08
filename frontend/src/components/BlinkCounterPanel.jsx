import React, { useState } from 'react'
import { Upload } from 'lucide-react'
import ReportSegmentedControl from './ReportSegmentedControl'

const metric = (value, suffix = '') => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—'
  return `${Number(value)}${suffix}`
}

const BlinkCounterPanel = ({
  blinkResult = null, liveBlinkMetrics = null, isRecording = false, isAnalyzing = false,
  canAnalyze = false, hasSession = false, onAnalyze = () => {}, onClear = () => {},
  onDownloadReport = () => {}, onSaveReport = () => {}, isSavingReport = false,
  onManualCalculate = () => {}, onVideoUpload = () => {}, videoName = ''
}) => {
  const [manualCount, setManualCount] = useState('9')
  const [manualSeconds, setManualSeconds] = useState('30')
  const [inputError, setInputError] = useState('')
  const result = isRecording ? liveBlinkMetrics : blinkResult
  const calculate = (event) => {
    event.preventDefault()
    const count = Number(manualCount)
    const seconds = Number(manualSeconds)
    if (manualCount === '' || manualSeconds === '' || !Number.isInteger(count) || count < 0 || count > 1000 || !Number.isFinite(seconds) || seconds < 1 || seconds > 120) {
      setInputError('Enter 0–1000 blinks and 1–120 seconds.')
      return
    }
    setInputError('')
    onManualCalculate(count, seconds)
  }
  const status = isRecording
    ? liveBlinkMetrics?.faceFound ? 'Face found. Blink normally!' : 'Move your face into the picture.'
    : blinkResult?.interpretation || 'Ready when you are'
  const metrics = [
    { label: 'Blinks counted', value: metric(result?.totalBlinks) },
    { label: 'Blinks each minute', value: metric(result?.bpmOverall) },
    { label: 'Time counted', value: metric(blinkResult?.analyzedDurationSeconds, ' sec') },
    { label: 'Face in view', value: metric(blinkResult?.faceDetectedSeconds, ' sec') }
  ]

  return (
    <aside className="ocular-analysis-panel blink-counter-panel" aria-label="Your blink count">
      <div className="ocular-content">
        <div className="ocular-active-eye-card">
          <section className="ocular-analysis-section">
            <div className="ocular-analysis-header-row">
              <div>
                <div className="ocular-analysis-label">YOUR BLINK COUNT</div>
                <p className="blink-help-copy">Look at the camera. Blink as usual. Your result appears after 30 seconds.</p>
              </div>
            </div>
            <div className="ocular-analysis-metrics">
              {metrics.map((item) => (
                <div key={item.label} className="ocular-analysis-metric-card">
                  <span className="ocular-analysis-metric-label">{item.label}</span>
                  <strong className="ocular-analysis-metric-value">{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="ocular-analysis-result" role="status" aria-live="polite">
              <div className={`ocular-analysis-result-badge ${result ? 'has-result' : 'is-idle'}`}>{status}</div>
            </div>
            <p className="blink-help-copy">
              {blinkResult?.sessionMode === 'manual'
                ? 'This rate uses the number you entered.'
                : 'Good light and keeping both eyes in view help us count. Camera counting runs on your device.'}
            </p>
            <div className="ocular-tear-actions">
              <button type="button" className="ocular-tool-btn" onClick={onAnalyze} disabled={!canAnalyze || isAnalyzing || isRecording}>
                {isAnalyzing ? 'Checking recording…' : blinkResult ? 'Recheck recording' : 'Analyze recording'}
              </button>
              <button type="button" className="ocular-tool-btn danger" onClick={onClear} disabled={!hasSession || isAnalyzing}>Start again</button>
            </div>
          </section>

          <section className="blink-recording-upload">
            <label className="blink-video-upload"><Upload size={16} /><span>Upload a recording</span><input type="file" accept="video/mp4,video/webm,video/quicktime" aria-label="Upload a blink recording" disabled={isAnalyzing || isRecording} onChange={event => { const file = event.target.files?.[0]; if (file) onVideoUpload(file); event.target.value = '' }} /></label>
            <p className="blink-help-copy">{videoName || 'MP4, WebM or MOV · up to 32 MB and 2 minutes.'}</p>
          </section>

          <section className="blink-manual-card">
            <h3>No camera? Try the calculator</h3>
            <p className="blink-help-copy">Count your blinks, then enter the number. You can try the example already filled in.</p>
            <form onSubmit={calculate} className="blink-manual-form">
              <label htmlFor="blink-manual-count">How many blinks?
                <input id="blink-manual-count" type="number" inputMode="numeric" min="0" max="1000" step="1" value={manualCount} onChange={(event) => setManualCount(event.target.value)} required />
              </label>
              <label htmlFor="blink-manual-seconds">How many seconds?
                <input id="blink-manual-seconds" type="number" inputMode="numeric" min="1" max="120" value={manualSeconds} onChange={(event) => setManualSeconds(event.target.value)} required />
              </label>
              {inputError && <p className="blink-input-error" role="alert">{inputError}</p>}
              <button type="submit" className="ocular-tool-btn" disabled={isRecording || isAnalyzing}>Show my blink rate</button>
            </form>
          </section>
          <div className="ocular-report-actions">
            <ReportSegmentedControl className="report-segmented-control" onSaveReport={onSaveReport} onDownloadReport={onDownloadReport} isSavingReport={isSavingReport} canSave={Boolean(blinkResult?.quality)} canDownload={Boolean(blinkResult?.quality)} />
          </div>
        </div>
      </div>
    </aside>
  )
}

export default BlinkCounterPanel

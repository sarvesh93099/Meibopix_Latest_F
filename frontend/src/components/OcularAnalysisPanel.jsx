// Review workspace for captured eye images, overlays, tear measurements, and per-lid results.
import React from 'react'
import { Eye } from 'lucide-react'
import ReportSegmentedControl from './ReportSegmentedControl'

const EYE_OPTIONS = [
  { id: 'left', label: 'Left Eye', prefix: 'L' },
  { id: 'right', label: 'Right Eye', prefix: 'R' }
]

const LID_OPTIONS = [
  { id: 'upper', label: 'Upper Lid', suffix: 'Upper' },
  { id: 'lower', label: 'Lower Lid', suffix: 'Lower' }
]

// Keep the slot naming consistent with the backend report payload and saved image map.
const getResultKey = (eye, lid) => {
  const eyePrefix = eye === 'left' ? 'L' : 'R'
  const lidSuffix = lid === 'upper' ? 'Upper' : 'Lower'
  return `${eyePrefix}_${lidSuffix}`
}

const OcularAnalysisPanel = ({
  activeSection = 'meibography',
  images = {},
  currentEye = 'left',
  currentLid = 'upper',
  showEyeSelector = true,
  onSelectEye = () => {},
  onSelectLid = () => {},
  onDownloadReport = () => {},
  onSaveReport = () => {},
  isSavingReport = false,
  onUndoImage = () => {},
  onRedoImage = () => {},
  onResetImage = () => {},
  tearMeasurements = {},
  tearMeasurementDraftPoints = [],
  isTearMeasureMode = false,
  isMeasuringTear = false,
  showTearPreview = true,
  onStartTearMeasurement = () => {},
  onClearTearMeasurement = () => {},
  canMeasureTear = false,
  canUndoImage = false,
  canRedoImage = false,
  canResetImage = false,
  meibographyResults = {}
}) => {
  const activeEye = EYE_OPTIONS.find((eye) => eye.id === currentEye) || EYE_OPTIONS[0]
  const meibographyResult = meibographyResults[getResultKey(currentEye, currentLid)] || null
  const tearMeasurement = tearMeasurements[currentEye] || null
  const hasMeibographyResult = Boolean(meibographyResult)
  const tearPointsPlaced = tearMeasurementDraftPoints.length
  const tearDistanceLabel = tearMeasurement?.distanceLabel || 'No measurement'
  const tearTmhLabel = tearMeasurement?.label || 'No measurement'
  const tearStatusLabel = tearMeasurement
    ? (tearMeasurement.statusLabel || 'Measured')
    : (isTearMeasureMode ? `Selecting (${tearPointsPlaced}/2)` : 'Idle')
  const tearSummary = tearMeasurement
    ? [
        `TMH: ${tearMeasurement.label || '--'}`,
        tearMeasurement.distanceLabel ? `Pixel distance: ${tearMeasurement.distanceLabel}` : '',
        tearMeasurement.corneaWidthPixels ? `Cornea width baseline: ${Number(tearMeasurement.corneaWidthPixels).toFixed(1)} px` : '',
        tearMeasurement.measuredAt ? `Measured at: ${new Date(tearMeasurement.measuredAt).toLocaleString()}` : '',
        tearMeasurement.summary || '',
        'Capture a lower-lid image for the most representative tear meniscus reading.'
      ].filter(Boolean).join('\n')
    : 'Capture or upload an image, click Measure, then mark the top and bottom tear meniscus edges.'
  return (
    <div id="ocular-analysis-panel" className="ocular-analysis-panel">
      <div className="ocular-content">
        {showEyeSelector && activeSection !== 'tear-meniscus' && (
          <div className="ocular-eye-selector" id="eye-selector-toggle">
            {EYE_OPTIONS.map((eye) => (
              <button
                key={eye.id}
                id={`eye-toggle-${eye.id}`}
                className={`ocular-eye-selector-btn ${currentEye === eye.id ? 'active' : ''}`}
                onClick={() => onSelectEye(eye.id)}
              >
                <Eye className="ocular-eye-icon" />
                <span>{eye.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="ocular-active-eye-card">
          {activeSection !== 'tear-meniscus' && (
            <>
              <div className="ocular-active-eye-header">
                <Eye className="ocular-eye-icon" />
                <span className="ocular-eye-title">{activeEye.label}</span>
              </div>

              <div className="ocular-lid-controls" id="lid-control-group">
                {LID_OPTIONS.map((lid) => (
                  <button
                    key={lid.id}
                    id={`lid-toggle-${lid.id}`}
                    className={`ocular-lid-btn ${currentLid === lid.id ? 'active' : ''}`}
                    onClick={() => onSelectLid(lid.id)}
                  >
                    {lid.label.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="ocular-images-section">
                <div className="ocular-images-label">CAPTURED IMAGES</div>
                <div className="ocular-images-grid">
                  {LID_OPTIONS.map((lid) => {
                    const imageKey = `${activeEye.prefix}_${lid.suffix}`
                    const imageSrc = images[imageKey]

                    return (
                      <div key={imageKey} className="ocular-image-item">
                        <div
                          id={`capture-slot-${activeEye.id}-${lid.id}`}
                          className={`ocular-image-thumbnail ${imageSrc ? '' : 'is-empty'}`}
                        >
                          {imageSrc ? (
                            <img
                              src={imageSrc}
                              alt={`${activeEye.label} ${lid.label}`}
                              className="ocular-image-img"
                            />
                          ) : (
                            <span className="ocular-empty-placeholder">No image</span>
                          )}
                        </div>
                        <div className="ocular-image-caption">{lid.label}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="ocular-image-tools" id="image-history-controls">
                  <button
                    id="undo-image-btn"
                    className="ocular-tool-btn"
                    onClick={onUndoImage}
                    disabled={!canUndoImage}
                  >
                    Undo
                  </button>
                  <button
                    id="redo-image-btn"
                    className="ocular-tool-btn"
                    onClick={onRedoImage}
                    disabled={!canRedoImage}
                  >
                    Redo
                  </button>
                  <button
                    id="reset-image-btn"
                    className="ocular-tool-btn danger"
                    onClick={onResetImage}
                    disabled={!canResetImage}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </>
          )}

          {activeSection === 'tear-meniscus' ? (
            <div className="ocular-analysis-section" id="tear-meniscus-panel">
              <div className="ocular-analysis-header-row">
                <div>
                  <div className="ocular-analysis-label">TEAR MENISCUS</div>
                  <div className="ocular-analysis-subtitle">
                    Place two points on the review image to measure tear meniscus height and convert it to TMH in millimeters.
                  </div>
                </div>
              </div>

              <div className="ocular-analysis-metrics">
                <div className="ocular-analysis-metric-card">
                  <span className="ocular-analysis-metric-label">TMH</span>
                  <strong className="ocular-analysis-metric-value">{tearMeasurement ? tearTmhLabel : '--'}</strong>
                </div>
                <div className="ocular-analysis-metric-card">
                  <span className="ocular-analysis-metric-label">Pixel Distance</span>
                  <strong className="ocular-analysis-metric-value">{tearMeasurement ? tearDistanceLabel : (isTearMeasureMode ? '--' : '--')}</strong>
                </div>
              </div>

              <div className="ocular-analysis-result">
                <div className="ocular-analysis-result-label">Measurement Status</div>
                <div className={`ocular-analysis-result-badge ${tearMeasurement ? 'has-result' : 'is-idle'}`}>
                  {tearStatusLabel}
                </div>
              </div>

              {showTearPreview && Boolean(tearMeasurement?.annotatedImage || tearMeasurement?.diagramImage) && (
                <div className="ocular-analysis-preview-grid">
                  {tearMeasurement?.annotatedImage && (
                    <div className="ocular-analysis-preview-card">
                      <div className="ocular-analysis-preview-title">Measurement Overlay</div>
                      <img
                        src={tearMeasurement.annotatedImage}
                        alt={`${activeEye.label} tear meniscus measurement`}
                        className="ocular-analysis-preview-image"
                      />
                    </div>
                  )}
                  {tearMeasurement?.diagramImage && (
                    <div className="ocular-analysis-preview-card">
                      <div className="ocular-analysis-preview-title">Clinical Diagram</div>
                      <img
                        src={tearMeasurement.diagramImage}
                        alt={`${activeEye.label} tear meniscus diagram`}
                        className="ocular-analysis-preview-image"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="ocular-tear-actions">
                <button
                  type="button"
                  className="ocular-tool-btn danger"
                  onClick={onClearTearMeasurement}
                  disabled={!tearMeasurement && !tearMeasurementDraftPoints.length && !isTearMeasureMode}
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <div className="ocular-analysis-section" id="dryness-analysis-panel">
              <div className="ocular-analysis-header-row">
                <div>
                  <div className="ocular-analysis-label">MEIBOGRAPHY ANALYSIS</div>
                </div>
              </div>

              <div className="ocular-analysis-metrics">
                <div className="ocular-analysis-metric-card">
                  <span className="ocular-analysis-metric-label">Coverage</span>
                  <strong className="ocular-analysis-metric-value">
                    {hasMeibographyResult ? `${Number(meibographyResult.coveragePct || 0).toFixed(1)}%` : '--'}
                  </strong>
                </div>
                <div className="ocular-analysis-metric-card">
                  <span className="ocular-analysis-metric-label">Dropout</span>
                  <strong className="ocular-analysis-metric-value">
                    {hasMeibographyResult ? `${Number(meibographyResult.dropoutPct || 0).toFixed(1)}%` : '--'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <div className="ocular-report-actions">
            <ReportSegmentedControl
              className="report-segmented-control"
              onSaveReport={onSaveReport}
              onDownloadReport={onDownloadReport}
              isSavingReport={isSavingReport}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default OcularAnalysisPanel

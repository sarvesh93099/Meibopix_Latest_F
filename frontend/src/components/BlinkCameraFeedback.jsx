import React from 'react'
import './BlinkCameraFeedback.css'

export function BlinkCameraGuide({ guidance, recording, count }) {
  return (
    <div className={`blink-guide blink-guide--${guidance.status}`}>
      <div className="blink-guide-oval" aria-hidden="true" />
      <div className="blink-guide-message" role="status">
        <span className="blink-guide-dot" aria-hidden="true" />{guidance.message}
      </div>
      {recording && <div className="blink-guide-count">
        <strong key={count} className={count ? 'blink-guide-pop' : ''}>{count}</strong>
        <span>blinks counted</span>
      </div>}
    </div>
  )
}

export function BlinkAnalysisProgress({ recording, secondsLeft, duration, analyzing, progress, result }) {
  if (!recording && !analyzing && !result) return null
  const percent = recording ? Math.round((duration - secondsLeft) / duration * 100)
    : analyzing ? progress : 100
  const known = Number.isFinite(percent)
  const value = known ? Math.min(100, Math.max(0, percent)) : undefined
  const label = recording ? 'Counting your blinks' : analyzing ? (known ? 'Analyzing your recording' : 'Preparing analysis') : 'Session complete'
  return <div className="blink-analysis-progress">
    <div className="blink-progress-heading"><strong>{label}</strong><span>{recording ? `${secondsLeft}s remaining` : known ? `${value}%` : 'Please wait'}</span></div>
    <div className={`blink-progress-track ${known ? '' : 'blink-progress-indeterminate'}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={known ? `${value}%` : 'In progress'}>
      <div style={{ width: known ? `${value}%` : '35%' }} />
    </div>
    <p>{recording ? 'Blink normally. The session finishes automatically.' : analyzing ? 'Keep this tab open while analysis completes.' : result?.quality === false ? 'Tracking was limited. Adjust your position and try again.' : 'Your results are ready below.'}</p>
  </div>
}

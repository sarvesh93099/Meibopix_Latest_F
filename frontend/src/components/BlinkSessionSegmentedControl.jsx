// Reusable segmented control for the live blink workflow toolbar.
import React from 'react'
import { BarChart3, Play, Trash2 } from 'lucide-react'
import SegmentedActionControl from './SegmentedActionControl'

const BlinkSessionSegmentedControl = ({
  className = '',
  value = 'start',
  onChange = () => {},
  onStartSession = () => {},
  onAnalyze = () => {},
  onClear = () => {},
  isRecording = false,
  isAnalyzing = false,
  secondsLeft = 30,
  canStart = true,
  canAnalyze = true,
  canClear = true
}) => (
  <SegmentedActionControl
    className={className}
    ariaLabel="Blink rate actions"
    value={value}
    onChange={onChange}
    options={[
      {
        value: 'start',
        label: isRecording ? `${secondsLeft}s left` : 'Count my blinks',
        icon: Play,
        wrapLabel: true,
        disabled: !canStart,
        onClick: onStartSession
      },
      {
        value: 'analyze',
        label: isAnalyzing ? 'Please wait…' : 'Recheck recording',
        icon: BarChart3,
        tone: 'accent',
        wrapLabel: true,
        disabled: !canAnalyze,
        onClick: onAnalyze
      },
      {
        value: 'clear',
        label: 'Start again',
        icon: Trash2,
        tone: 'danger',
        disabled: !canClear,
        onClick: onClear
      }
    ]}
  />
)

export default BlinkSessionSegmentedControl

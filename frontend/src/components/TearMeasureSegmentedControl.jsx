// Shared segmented control for starting or clearing tear-meniscus measurements.
import React from 'react'
import { RotateCcw, Ruler } from 'lucide-react'
import SegmentedActionControl from './SegmentedActionControl'

const TearMeasureSegmentedControl = ({
  className = '',
  value = 'measure',
  onChange = () => {},
  onMeasure = () => {},
  onClear = () => {},
  isMeasuring = false,
  canMeasure = true,
  canClear = true
}) => (
  <SegmentedActionControl
    className={className}
    ariaLabel="Tear meniscus actions"
    value={value}
    onChange={onChange}
    options={[
      {
        id: 'measure-tear-meniscus-btn',
        value: 'measure',
        label: isMeasuring ? 'Measuring...' : 'Measure',
        icon: Ruler,
        disabled: !canMeasure || isMeasuring,
        onClick: onMeasure
      },
      {
        id: 'clear-tear-meniscus-btn',
        value: 'clear',
        label: 'Clear Measure',
        icon: RotateCcw,
        tone: 'danger',
        disabled: !canClear,
        onClick: onClear
      }
    ]}
  />
)

export default TearMeasureSegmentedControl

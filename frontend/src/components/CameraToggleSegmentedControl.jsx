// Reusable segmented control for starting and stopping the shared camera stream.
import React, { useEffect, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import SegmentedActionControl from './SegmentedActionControl'

const CameraToggleSegmentedControl = ({
  className = '',
  cameraReady = false,
  isStartingCamera = false,
  onEnableCamera = () => {},
  onStopCamera = () => {}
}) => {
  const [activeAction, setActiveAction] = useState(cameraReady ? 'enable' : 'stop')

  useEffect(() => {
    if (isStartingCamera || cameraReady) {
      setActiveAction('enable')
      return
    }

    setActiveAction('stop')
  }, [cameraReady, isStartingCamera])

  return (
    <SegmentedActionControl
      className={className}
      ariaLabel="Camera controls"
      value={activeAction}
      onChange={setActiveAction}
      options={[
        {
          id: 'enable-camera-btn',
          value: 'enable',
          label: isStartingCamera ? 'Starting camera...' : 'Enable Camera',
          icon: Camera,
          wrapLabel: true,
          disabled: isStartingCamera,
          onClick: onEnableCamera
        },
        {
          id: 'stop-camera-btn',
          value: 'stop',
          label: 'Stop Camera',
          icon: CameraOff,
          tone: 'danger',
          disabled: !cameraReady || isStartingCamera,
          onClick: onStopCamera
        }
      ]}
    />
  )
}

export default CameraToggleSegmentedControl

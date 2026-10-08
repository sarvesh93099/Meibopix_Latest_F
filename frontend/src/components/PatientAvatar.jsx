import React from 'react'

export const PATIENT_AVATAR_OPTIONS = [
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Calm blue clinical look',
    gradient: 'linear-gradient(135deg, #2049d7 0%, #4bb8ff 100%)',
    shadow: 'rgba(32, 73, 215, 0.30)',
    outline: 'rgba(255, 255, 255, 0.52)',
    spark: 'rgba(255, 255, 255, 0.88)'
  },
  {
    id: 'rose',
    label: 'Rose',
    description: 'Soft warm patient card',
    gradient: 'linear-gradient(135deg, #d84b88 0%, #ff9f8f 100%)',
    shadow: 'rgba(216, 75, 136, 0.26)',
    outline: 'rgba(255, 240, 246, 0.62)',
    spark: 'rgba(255, 248, 249, 0.9)'
  },
  {
    id: 'mint',
    label: 'Mint',
    description: 'Fresh green accent',
    gradient: 'linear-gradient(135deg, #109f84 0%, #6dd8b5 100%)',
    shadow: 'rgba(16, 159, 132, 0.24)',
    outline: 'rgba(237, 255, 249, 0.58)',
    spark: 'rgba(248, 255, 253, 0.9)'
  },
  {
    id: 'violet',
    label: 'Violet',
    description: 'Bold premium contrast',
    gradient: 'linear-gradient(135deg, #5b43d6 0%, #a38bff 100%)',
    shadow: 'rgba(91, 67, 214, 0.26)',
    outline: 'rgba(247, 244, 255, 0.58)',
    spark: 'rgba(255, 255, 255, 0.9)'
  },
  {
    id: 'sunset',
    label: 'Sunset',
    description: 'Amber and coral energy',
    gradient: 'linear-gradient(135deg, #ee7b28 0%, #f7bb4d 100%)',
    shadow: 'rgba(238, 123, 40, 0.24)',
    outline: 'rgba(255, 247, 230, 0.58)',
    spark: 'rgba(255, 253, 245, 0.92)'
  }
]

export const DEFAULT_PATIENT_AVATAR_STYLE = PATIENT_AVATAR_OPTIONS[0].id

export const normalizePatientAvatarStyle = (style) => {
  const normalizedStyle = String(style || '').trim().toLowerCase()
  return PATIENT_AVATAR_OPTIONS.some((option) => option.id === normalizedStyle)
    ? normalizedStyle
    : DEFAULT_PATIENT_AVATAR_STYLE
}

export const getPatientAvatarOption = (style) => {
  const normalizedStyle = normalizePatientAvatarStyle(style)
  return PATIENT_AVATAR_OPTIONS.find((option) => option.id === normalizedStyle) || PATIENT_AVATAR_OPTIONS[0]
}

export const buildPatientMonogram = (label) => {
  const words = String(label || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase()
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase()
  }

  return 'PT'
}

const PatientAvatar = ({ style, label, size = 'md', className = '', decorative = false }) => {
  const option = getPatientAvatarOption(style)
  const avatarClassName = ['patient-avatar-token', `patient-avatar-token--${size}`, className].filter(Boolean).join(' ')

  return (
    <div
      className={avatarClassName}
      style={{
        '--patient-avatar-gradient': option.gradient,
        '--patient-avatar-shadow': option.shadow,
        '--patient-avatar-outline': option.outline,
        '--patient-avatar-spark': option.spark
      }}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <div className="patient-avatar-token__halo" />
      <div className="patient-avatar-token__face">
        <span className="patient-avatar-token__monogram">{buildPatientMonogram(label)}</span>
        <span className="patient-avatar-token__spark patient-avatar-token__spark--one" />
        <span className="patient-avatar-token__spark patient-avatar-token__spark--two" />
        <span className="patient-avatar-token__spark patient-avatar-token__spark--three" />
      </div>
    </div>
  )
}

export default PatientAvatar

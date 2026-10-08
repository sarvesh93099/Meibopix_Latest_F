// Reusable segmented control that keeps action buttons compact, animated, and keyboard accessible.
import React from 'react'
import styles from './SegmentedActionControl.module.css'

const ACTIVE_TONES = {
  primary: {
    start: '#207960',
    middle: '#23856d',
    end: '#329379',
    shadow: 'rgba(35, 133, 109, 0.10)',
    focusRing: 'rgba(35, 133, 109, 0.25)'
  },
  accent: {
    start: '#4e765a',
    middle: '#578361',
    end: '#668d6e',
    shadow: 'rgba(78, 118, 90, 0.10)',
    focusRing: 'rgba(78, 118, 90, 0.25)'
  },
  danger: {
    start: '#991b1b',
    middle: '#dc2626',
    end: '#f87171',
    shadow: 'rgba(220, 38, 38, 0.28)',
    focusRing: 'rgba(239, 68, 68, 0.18)'
  }
}

const SegmentedActionControl = ({
  ariaLabel,
  className = '',
  options = [],
  value,
  onChange
}) => {
  const activeIndex = Math.max(options.findIndex((option) => option.value === value), 0)
  const activeOption = options[activeIndex] || options[0]
  const activeTone = ACTIVE_TONES[activeOption?.tone] || ACTIVE_TONES.primary

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      <div
        className={styles.track}
        style={{
          '--segmented-count': Math.max(options.length, 1),
          '--segmented-index': activeIndex,
          '--segmented-indicator-start': activeTone.start,
          '--segmented-indicator-middle': activeTone.middle,
          '--segmented-indicator-end': activeTone.end,
          '--segmented-indicator-shadow': activeTone.shadow,
          '--segmented-focus-ring': activeTone.focusRing
        }}
        role="group"
        aria-label={ariaLabel}
      >
        <span className={styles.indicator} aria-hidden="true" />

        {options.map((option) => {
          const isActive = option.value === value
          const Icon = option.icon

          return (
            <button
              key={option.value}
              type="button"
              className={[
                styles.button,
                isActive ? styles.active : '',
                option.wrapLabel ? styles.labelWrappedButton : '',
                option.disabled ? styles.disabled : ''
              ].filter(Boolean).join(' ')}
              id={option.id}
              aria-pressed={isActive}
              aria-label={option.ariaLabel || option.label}
              disabled={option.disabled}
              onClick={() => {
                onChange?.(option.value)
                option.onClick?.()
              }}
            >
              {Icon ? <Icon className={styles.icon} aria-hidden="true" /> : null}
              <span className={[styles.label, option.wrapLabel ? styles.labelWrap : ''].filter(Boolean).join(' ')}>
                {option.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default SegmentedActionControl

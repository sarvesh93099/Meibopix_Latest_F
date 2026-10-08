import React from 'react'
import { Eye } from 'lucide-react'
import '../styles/loading.css'

export default function LoadingState({ title = 'Preparing your workspace', detail = 'Your next step is on its way.', compact = false }) {
  return <div className={`loading-state ${compact ? 'is-compact' : ''}`} role="status" aria-live="polite">
    <span className="loading-eye" aria-hidden="true"><Eye size={28} strokeWidth={1.5} /><span /></span>
    <div><strong>{title}</strong><p>{detail}</p></div>
    <span className="loading-track" aria-hidden="true"><span /></span>
  </div>
}

export function LoadingSkeleton({ rows = 3, label = 'Loading results' }) {
  return <div className="loading-skeleton" role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-card" key={index} aria-hidden="true"><span className="skeleton-avatar" /><div><span /><span /></div><span className="skeleton-action" /></div>)}
  </div>
}

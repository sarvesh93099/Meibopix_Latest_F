import React, { useId } from 'react'

// Local vector artwork: no image download, canvas loop, or external asset.
export default function EyeIllustration() {
  const id = useId().replace(/:/g, '')
  return <svg className="eye-study-illustration" viewBox="0 0 440 320" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-iris`}><stop stopColor="#123c35" /><stop offset=".35" stopColor="#337b68" /><stop offset=".7" stopColor="#8fd0b4" /><stop offset="1" stopColor="#346f5e" /></radialGradient>
      <linearGradient id={`${id}-lid`} x1="50" y1="150" x2="390" y2="150" gradientUnits="userSpaceOnUse"><stop stopColor="#85b7a4" /><stop offset=".5" stopColor="#daf1df" /><stop offset="1" stopColor="#85b7a4" /></linearGradient>
    </defs>
    <circle cx="220" cy="160" r="130" stroke="#c5e2d1" opacity=".16" />
    <circle cx="220" cy="160" r="111" stroke="#c5e2d1" opacity=".2" strokeDasharray="2 8" />
    <path d="M37 160H403M220 12V308" stroke="#c5e2d1" opacity=".16" strokeDasharray="3 7" />
    <path d="M54 160C107 101 147 70 220 70C293 70 333 101 386 160C333 219 293 250 220 250C147 250 107 219 54 160Z" fill="#e8f1e8" />
    <path d="M54 160C107 101 147 70 220 70C293 70 333 101 386 160" stroke={`url(#${id}-lid)`} strokeWidth="3" />
    <path d="M54 160C107 219 147 250 220 250C293 250 333 219 386 160" stroke="#a7c9b8" strokeWidth="2" />
    <circle cx="220" cy="160" r="79" fill={`url(#${id}-iris)`} />
    <circle cx="220" cy="160" r="72" stroke="#c1e5ce" strokeWidth="9" strokeDasharray="1 5" opacity=".55" />
    <circle cx="220" cy="160" r="60" stroke="#d0ebd8" strokeWidth="15" strokeDasharray=".7 6" opacity=".32" />
    <circle cx="220" cy="160" r="42" stroke="#164c40" strokeWidth="9" strokeDasharray="1 3" opacity=".7" />
    <circle cx="220" cy="160" r="30" fill="#0c2926" />
    <ellipse cx="244" cy="135" rx="13" ry="11" fill="#f5fff4" opacity=".85" />
    <circle cx="207" cy="175" r="4" fill="#f5fff4" opacity=".5" />
    <path d="M27 144V129H42M398 129H413V144M27 176V191H42M398 191H413V176" stroke="#b0d4bb" opacity=".6" />
    <circle cx="92" cy="57" r="3" fill="#b0d4bb" /><path d="M95 57H137" stroke="#b0d4bb" opacity=".35" />
    <circle cx="347" cy="269" r="3" fill="#b0d4bb" /><path d="M304 269H344" stroke="#b0d4bb" opacity=".35" />
  </svg>
}

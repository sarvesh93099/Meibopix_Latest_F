import { useEffect, useRef } from 'react'

// Keeps keyboard focus inside an open overlay, then restores the opening control.
export default function useDialogFocus(open, selector, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const dialog = document.querySelector(selector)
    if (!dialog) return
    const previous = document.activeElement
    const controls = () => [...dialog.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length)
    controls()[0]?.focus()
    const onKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = controls()
      const first = items[0]
      const last = items.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    dialog.addEventListener('keydown', onKey)
    return () => { dialog.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, [open, selector])
}

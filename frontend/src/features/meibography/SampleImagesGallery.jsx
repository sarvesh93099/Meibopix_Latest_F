import React, { useEffect, useState } from 'react'
import { ChevronDown, Download, Image as ImageIcon, Loader2 } from 'lucide-react'
import './SampleImagesGallery.css'

const assetUrl = value => `${import.meta.env.BASE_URL}${String(value).replace(/^\//, '')}`

export default function SampleImagesGallery({ onLoad, activeSampleId, busy = false }) {
  const [samples, setSamples] = useState([])
  const [expanded, setExpanded] = useState(true)
  const [loadingId, setLoadingId] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch(assetUrl('/samples/meibography/samples.json'), { signal: controller.signal, credentials: 'omit' })
      .then(response => { if (!response.ok) throw new Error('Sample images could not be loaded.'); return response.json() })
      .then(data => setSamples(Array.isArray(data) ? data : data.samples || []))
      .catch(cause => { if (cause.name !== 'AbortError') setError(cause.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => { if (activeSampleId) setExpanded(false) }, [activeSampleId])

  const load = async sample => {
    setLoadingId(sample.id)
    setError('')
    try { await onLoad(sample) } catch (cause) { setError(cause.message || 'This image could not be opened. Please try again.') }
    finally { setLoadingId(null) }
  }

  return <section className="sample-gallery" aria-labelledby="sample-gallery-title">
    <div className="sample-gallery-heading"><div><h3 id="sample-gallery-title"><ImageIcon size={19} />Try a sample image</h3><p>Real, openly licensed eyelid images. Load one here or download it to try later.</p></div><button type="button" className="sample-gallery-toggle" aria-expanded={expanded} aria-controls="meibography-samples" onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide samples' : 'Show samples'}<ChevronDown size={16} className={expanded ? 'is-expanded' : ''} /></button></div>
    {error && <p className="sample-gallery-error" role="alert">{error}</p>}
    {activeSampleId && <p className="sample-gallery-active" role="status">Loaded: {samples.find(sample => sample.id === activeSampleId)?.label || 'research sample'}.</p>}
    {expanded && <div id="meibography-samples" className="sample-gallery-grid">
      {loading && <p className="sample-gallery-loading" role="status">Loading sample images…</p>}
      {samples.map(sample => <article key={sample.id} className="sample-image-card">
        <img src={assetUrl(sample.thumbnail_src || sample.src)} width={sample.thumbnail_width || sample.width} height={sample.thumbnail_height || sample.height} alt={`${sample.label} — infrared meibography research sample`} loading="lazy" decoding="async" />
        <div className="sample-image-copy"><strong>{sample.label}</strong><small>{sample.lid === 'lower' ? 'Lower eyelid' : sample.lid === 'upper' ? 'Upper eyelid' : 'Eyelid image'} · {sample.license}</small><div className="sample-image-actions"><button type="button" className="sample-load-button" disabled={busy || loadingId !== null} onClick={() => load(sample)}>{loadingId === sample.id ? <><Loader2 size={14} className="sample-loading-spinner" />Opening…</> : 'Load sample'}</button><a href={assetUrl(sample.src)} download={sample.filename} aria-label={`Download ${sample.label}`}><Download size={14} />Download</a></div><a className="sample-source-link" href={sample.sourceUrl} target="_blank" rel="noreferrer">Research source &amp; attribution</a></div>
      </article>)}
    </div>}
    {samples.length > 0 && <p className="sample-gallery-credit">Images: Izabela Garaszczuk and Karolina Jarosz (2025), RepOD. <a href={samples[0].licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a>. Lossless PNG conversion.</p>}
  </section>
}

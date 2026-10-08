import React, { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, FileDown, FileText, Save } from 'lucide-react'
import SegmentedActionControl from './SegmentedActionControl'
import styles from './ReportSegmentedControl.module.css'

export default function ReportSegmentedControl({ className = '', onSaveReport = () => {}, onDownloadReport = () => {}, isSavingReport = false, canSave = true, canDownload = true }) {
  const [action, setAction] = useState(canSave ? 'save' : 'download')
  useEffect(() => { if (action === 'save' && !canSave && canDownload) setAction('download') }, [action, canSave, canDownload])
  const ready = canSave || canDownload
  const status = isSavingReport ? 'Saving your report…' : ready ? 'Results ready' : 'Complete a test first'
  return <section className={[styles.panel, className].filter(Boolean).join(' ')} aria-label="Save or download your report">
    <div className={styles.header}><span className={styles.kicker}>YOUR REPORT</span><span className={styles.status} role="status">{isSavingReport ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}{status}</span></div>
    <h3 className={styles.title}>Keep your results.</h3>
    <p className={styles.description}>{isSavingReport ? 'Keep this page open until saving finishes.' : ready ? 'Save to the person’s record, or download a PDF to read and share.' : 'Finish this test to save or download the results.'}</p>
    <SegmentedActionControl ariaLabel="Report actions" value={action} onChange={setAction} options={[
      { id: 'save-report-btn', value: 'save', label: isSavingReport ? 'Saving…' : 'Save report', icon: Save, disabled: !canSave || isSavingReport, onClick: onSaveReport },
      { id: 'download-report-btn', value: 'download', label: 'Download PDF', icon: FileDown, tone: 'accent', disabled: !canDownload || isSavingReport, onClick: onDownloadReport }
    ]} />
    <div className={styles.footer}><FileText size={14} /><span>Save keeps a copy here. Download gives you a PDF file.</span></div>
  </section>
}

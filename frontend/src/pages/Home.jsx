import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Check, Eye, FileText, Play, Plus, Sparkles, Users } from 'lucide-react'
import { getAuthUserProfile, isGuestSession } from '../utils/auth'
import { getDemoData } from '../features/demo/data'
import { TEST_CATALOG, getTestUrl } from '../features/tests/catalog'
import { prefetchRoute } from '../utils/performance'
import EyeIllustration from '../components/EyeIllustration'

const warmLink = path => ({ onMouseEnter: () => prefetchRoute(path), onFocus: () => prefetchRoute(path) })

export default function Home() {
  const guest = isGuestSession()
  const name = getAuthUserProfile().name || 'there'
  const guestData = guest ? getDemoData() : null
  const savedReports = guestData?.results.filter(result => result.kind === 'report' && !result.demo_sample) || []
  const recordedResults = guestData?.results.filter(result => result.kind !== 'report' && !result.demo_sample) || []
  const savedTestCount = recordedResults.reduce((count, result) => count + (Array.isArray(result.completed_tests) ? result.completed_tests.length : 0), 0)
  return (
    <div className="home-page">
      <div className="home-heading"><div><span className="eyebrow">YOUR EYE CARE WORKSPACE</span><h1>{guest ? 'A clearer view of eye care.' : `A clearer day, ${name.split(' ')[0]}.`}</h1><p>A calm space for your patients, assessments, and next steps.</p></div><nav className="home-shortcuts" aria-label="Quick actions"><Link to="/tests" {...warmLink('/tests')}><FileText size={16} />Saved reports</Link><Link className="home-shortcut-primary" to="/patients/new" {...warmLink('/patients/new')}><Plus size={17} />New patient</Link></nav></div>
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-copy">
          <span className="hero-label"><span />A MOMENT TO SEE MORE</span><h2 id="home-hero-title">Clarity, in<br /><span>every detail.</span></h2>
          <p>Start with a simple blink check. A small moment of attention, a clearer next step.</p>
          <div className="hero-actions"><Link className="primary-action" to={getTestUrl('blink-rate')} {...warmLink('/eye-test/meibography')}><Play size={15} fill="currentColor" />Try the blink test<ArrowUpRight size={18} /></Link><Link className="hero-secondary-action" to="/tools" {...warmLink('/tools')}>Explore all tests<ArrowRight size={16} /></Link></div>
          <div className="hero-reassurance"><span><Check size={14} />30-second session</span><span><Check size={14} />Camera or manual count</span></div>
        </div>
        <div className="home-eye-art" aria-hidden="true">
          <div className="eye-orbit orbit-one" /><div className="eye-orbit orbit-two" /><div className="eye-orbit orbit-three" />
          <EyeIllustration />
          <div className="art-label art-label-top"><span className="art-label-dot" />EYE CARE, IN FOCUS</div>
          <div className="art-result-card"><ActivityMark /><div><small>YOUR NEXT MOMENT OF CLARITY</small><strong>One blink at a time.</strong></div><span className="art-mini-wave"><i /><i /><i /><i /><i /><i /></span></div><span className="art-corner-label">DESIGNED FOR A CLEARER DAY</span>
        </div>
      </section>
      {guest && <section className="home-session" aria-labelledby="session-heading"><div className="home-session-heading"><span className="session-icon"><Sparkles size={20} /></span><div><h2 id="session-heading">Your guest workspace</h2><p>Try every test. Keep your results in this tab.</p></div></div><div className="home-session-stats"><Link to="/tools" {...warmLink('/tools')}><strong>08</strong><span>Tests to explore</span><ArrowUpRight size={16} /></Link><Link to="/tests" {...warmLink('/tests')}><strong>{savedTestCount.toString().padStart(2, '0')}</strong><span>Your saved test results</span><ArrowUpRight size={16} /></Link><Link to="/tests" {...warmLink('/tests')}><strong>{savedReports.length.toString().padStart(2, '0')}</strong><span>Your saved reports</span><ArrowUpRight size={16} /></Link></div></section>}
      <section className="home-start-section" aria-labelledby="start-heading"><div className="section-heading"><div><span className="eyebrow">THE ASSESSMENT COLLECTION</span><h2 id="start-heading">A good place to begin.</h2></div><Link to="/tools" {...warmLink('/tools')}>See all 8 tests<ArrowRight size={16} /></Link></div><div className="home-quick-grid">{TEST_CATALOG.slice(0, 3).map((test, index) => <Link key={test.id} className={`quick-test-card tone-${test.color}`} to={getTestUrl(test.id)} {...warmLink('/eye-test/meibography')}><div className="quick-test-top"><span className="test-icon"><test.icon size={25} strokeWidth={1.6} /></span><span className="test-duration">{test.tag}</span></div><small className="quick-test-category">{test.clinical}</small><h3>{test.title}</h3><p>{test.description}</p><span className="card-link">Start this test<ArrowRight size={17} /></span><span className="card-watermark" aria-hidden="true">0{index + 1}</span></Link>)}</div></section>
      <section className="home-workflow"><div><span className="eyebrow">ONE CONNECTED WORKSPACE</span><h2>From first check to final report.</h2><p>A simple flow. Every step in one place.</p></div><ol><li><Link to="/patients" {...warmLink('/patients')}><span className="workflow-number">1</span><Users size={21} /><strong>Choose a patient</strong><small>Open a record or add a new person.</small></Link></li><li><Link to="/tools" {...warmLink('/tools')}><span className="workflow-number">2</span><Eye size={21} /><strong>Take a test</strong><small>Clear instructions at every step.</small></Link></li><li><Link to="/tests" {...warmLink('/tests')}><span className="workflow-number">3</span><FileText size={21} /><strong>Review your results</strong><small>Save a report you can share.</small></Link></li></ol></section>
      {guest && <p className="home-demo-note"><span />Guest results stay in this tab until reset. Image tests send your selected image for processing. Sample patient records are fictional.</p>}
    </div>
  )
}
function ActivityMark() { return <svg width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="11" fill="#e6f5ef" /><path d="M7 19h5l3-7 5 13 3-6h6" fill="none" stroke="#24846d" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }

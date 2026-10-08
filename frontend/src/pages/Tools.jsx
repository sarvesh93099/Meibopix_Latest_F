import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { TEST_CATALOG, getTestUrl } from '../features/tests/catalog'
import { isGuestSession } from '../utils/auth'
import { prefetchRoute } from '../utils/performance'

const categories = [
  { id: 'all', label: 'All tests' },
  { id: 'capture', label: 'Camera & images', tests: ['blink-rate', 'meibography', 'tear-meniscus', 'bulbar-redness'] },
  { id: 'questions', label: 'Questionnaires', tests: ['deq', 'osdi'] },
  { id: 'records', label: 'Clinical records', tests: ['contrast-sensitivity', 'posterior-segment'] },
]
export default function Tools() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const guest = isGuestSession()
  const tests = useMemo(() => {
    const selected = categories.find(item => item.id === category)
    return TEST_CATALOG.filter(test => (!selected.tests || selected.tests.includes(test.id)) && `${test.title} ${test.clinical} ${test.description}`.toLowerCase().includes(query.toLowerCase().trim()))
  }, [query, category])
  const clearFilters = () => { setQuery(''); setCategory('all') }
  return (
    <div className="tools-page">
      <div className="home-heading"><div><span className="eyebrow">THE EYE TEST COLLECTION</span><h1>A clearer view starts with a check.</h1><p>Eight tools. Simple instructions. Find the right place to begin.</p></div><span className="home-heading-badge"><Sparkles size={16} />{guest ? 'All tests open to guests' : 'Made for your workflow'}</span></div>
      <div className="tools-discovery">
        <div className="tools-search-row"><label className="tools-search"><Search size={20} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a test, like blinks or tears" aria-label="Search eye tests" />{query && <button type="button" className="tools-clear-search" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}</label><span className="tools-available"><Check size={15} />{guest ? 'Guest results saved in this tab' : 'Reports connected to your patients'}</span></div>
        <div className="tools-filter-row"><div className="tools-filters" role="group" aria-label="Filter tests by category">{categories.map(item => <button key={item.id} type="button" className={`tools-filter ${category === item.id ? 'is-active' : ''}`} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.id === 'all' && <SlidersHorizontal size={14} />}{item.label}<span>{item.tests?.length || TEST_CATALOG.length}</span></button>)}</div><p className="tools-results-count" aria-live="polite">{tests.length} {tests.length === 1 ? 'test' : 'tests'} to explore</p></div>
      </div>
      <div className="tool-library">{tests.map(test => <Link key={test.id} to={getTestUrl(test.id)} className={`library-card tone-${test.color}`} onMouseEnter={() => prefetchRoute('/eye-test/meibography')} onFocus={() => prefetchRoute('/eye-test/meibography')}><div className="quick-test-top"><span className="test-icon"><test.icon size={26} strokeWidth={1.6} /></span><span className="test-duration">{test.tag}</span></div><small className="library-clinical">{test.clinical}</small><h2>{test.title}</h2><p>{test.description}</p><span className="card-link">Open test<ArrowRight size={17} /></span><span className="card-watermark" aria-hidden="true">{(TEST_CATALOG.indexOf(test) + 1).toString().padStart(2, '0')}</span></Link>)}</div>
      {!tests.length && <div className="simple-empty"><span className="empty-search-icon"><Search size={28} /></span><h2>No tests found</h2><p>Try “blink”, “tears”, or “questions”, or choose another category.</p><button type="button" className="secondary-action" onClick={clearFilters}>Show all tests</button></div>}
      <p className="tools-footnote">Measurements and questionnaires support an eye care professional’s review.</p>
    </div>
  )
}

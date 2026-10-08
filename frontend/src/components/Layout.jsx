import React, { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ArrowUpRight, Building2, ChevronRight, CircleHelp, Eye, FileText, Home, LogOut, Menu, RotateCcw, Settings, ShieldCheck, Users, X } from 'lucide-react'
import { getAuthUserProfile, isGuestSession, logoutSession, resetGuestDemo } from '../utils/auth'
import useDialogFocus from '../hooks/useDialogFocus'
import { prefetchRoute } from '../utils/performance'
import '../styles/workspace.css'

const doctorNavigation = [
  { path: '/home', label: 'Home', detail: 'Start here', icon: Home },
  { path: '/tools', label: 'Eye tests', detail: 'Choose a test', icon: Eye },
  { path: '/patients', label: 'Patients', detail: 'People in your care', icon: Users },
  { path: '/tests', label: 'Reports', detail: 'See saved results', icon: FileText },
  { path: '/clinics', label: 'Clinics', detail: 'Your care locations', icon: Building2 },
  { path: '/settings', label: 'Settings', detail: 'Your account', icon: Settings },
]

export default function Layout({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  useDialogFocus(menuOpen, '.workspace-sidebar', () => setMenuOpen(false))
  const user = getAuthUserProfile()
  const guest = isGuestSession()
  const admin = user.role === 'admin'
  const name = user.name || user.username || 'Guest'
  const navigation = admin ? [
    { path: '/admin', label: 'Overview', detail: 'Manage your workspace', icon: ShieldCheck },
    doctorNavigation[5],
  ] : doctorNavigation
  const currentPage = navigation.find(item => location.pathname === item.path || location.pathname.startsWith(`${item.path}/`))

  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = event => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const signOut = async () => {
    await logoutSession()
    navigate('/login', { replace: true })
  }

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">Skip to content</a>
      {menuOpen && <button className="workspace-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`workspace-sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <Link to={admin ? '/admin' : '/home'} className="workspace-brand" aria-label="MeiboPix home" onMouseEnter={() => prefetchRoute(admin ? '/admin' : '/home')} onFocus={() => prefetchRoute(admin ? '/admin' : '/home')}>
          <span className="workspace-brand-icon"><Eye size={25} strokeWidth={1.7} /></span>
          <span>meibo<span className="brand-accent">pix</span><small>EYE CARE, MADE CLEAR</small></span>
        </Link>
        <button type="button" className="workspace-close icon-button" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        <span className="workspace-nav-caption">CARE WORKSPACE</span>
        <nav>
          {navigation.map(({ path, label, detail, icon: Icon }) => (
            <NavLink key={path} to={path} onMouseEnter={() => prefetchRoute(path)} onFocus={() => prefetchRoute(path)} className={({ isActive }) => `workspace-nav-link ${isActive ? 'is-active' : ''}`}>
              <Icon size={21} strokeWidth={1.7} />
              <span><strong>{label}</strong><small>{detail}</small></span>
              <ChevronRight size={15} className="workspace-nav-arrow" />
            </NavLink>
          ))}
        </nav>
        {!admin && <Link className="workspace-tip" to="/tools" onMouseEnter={() => prefetchRoute('/tools')} onFocus={() => prefetchRoute('/tools')}><CircleHelp size={23} /><strong>A little focus. A fresh insight.</strong><span>Explore eight eye tests, with a guide at every step.</span><small>Find your next step <ArrowUpRight size={14} /></small></Link>}
        <div className="workspace-sidebar-footer">
          <span className="workspace-avatar">{name.charAt(0).toUpperCase()}</span>
          <span className="workspace-user"><strong>{name}</strong><small>{guest ? 'Guest workspace' : admin ? 'Administrator' : 'Doctor account'}</small></span>
          <button className="icon-button" type="button" onClick={signOut} aria-label={guest ? 'Leave guest workspace' : 'Sign out'} title={guest ? 'Leave guest workspace' : 'Sign out'}><LogOut size={19} /></button>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="workspace-breadcrumb"><button type="button" className="workspace-menu icon-button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={21} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{currentPage?.label || 'Patient details'}</strong></div>
          <div className="workspace-header-actions"><span className={`workspace-mode ${guest ? 'is-demo' : ''}`}><span />{guest ? 'Guest access' : 'Private workspace'}</span>{!admin && <Link to="/tools" className="workspace-header-test" onMouseEnter={() => prefetchRoute('/tools')} onFocus={() => prefetchRoute('/tools')}>Start a test <ArrowUpRight size={16} /></Link>}</div>
        </header>
        {guest && <div className="guest-banner" role="status"><Eye size={18} /><p><strong>All eight tests are yours to try.</strong> Results and reports stay in this tab. Sample patient records are fictional.</p><button type="button" onClick={() => { resetGuestDemo(); window.location.reload() }}><RotateCcw size={14} />Reset workspace</button><button type="button" onClick={signOut}>Leave guest mode</button></div>}
        <main id="workspace-main" className="workspace-main" tabIndex={-1}>{children}</main>
        <footer className="workspace-footer"><span>MeiboPix · A clearer view of eye care</span><span>{guest ? 'Your guest eye care workspace' : 'Eye care workspace'}</span></footer>
      </div>
    </div>
  )
}

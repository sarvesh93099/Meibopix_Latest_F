import React from 'react'

export default class AppErrorBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div className="app-recovery" role="alert"><h1>This page needs a fresh start.</h1><p>Refresh the page to try again.</p><button className="primary-action" onClick={() => window.location.reload()}>Refresh page</button><a href="/home">Go home</a></div>
    return this.props.children
  }
}

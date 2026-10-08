// Bootstraps the React app, shared HTTP interceptors, and global stylesheet.
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './utils/http'
import './styles/base.css'
import './styles/tokens.css'
import { isConstrainedDevice } from './utils/performance'

document.documentElement.classList.toggle('low-resource', isConstrainedDevice())

// Render the full clinic application into the root DOM node defined in index.html.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

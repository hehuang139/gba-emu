import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Register only the production worker. Vite's dev server must stay network
// driven so HMR and browser integration tests are deterministic.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const registration = navigator.serviceWorker.register('/sw.js', { scope: '/' })
    registration.then((reg) => {
      const markUpdate = () => {
        if (reg.waiting) window.dispatchEvent(new Event('pwa-update-available'))
      }
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', () => {
          if (reg.installing?.state === 'installed' && navigator.serviceWorker.controller) markUpdate()
        })
      })
      markUpdate()
    }).catch(() => {})
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (sessionStorage.getItem('advance-pwa-update-requested') === '1') {
        sessionStorage.removeItem('advance-pwa-update-requested')
        window.location.reload()
      }
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

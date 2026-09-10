import { CloudOff, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'

/** Compact network/cache state for the app shell. */
export function OfflineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [cached, setCached] = useState(() => Boolean(navigator.serviceWorker?.controller))
  const [update, setUpdate] = useState<ServiceWorker | null>(null)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onController = () => setCached(Boolean(navigator.serviceWorker?.controller))
    const onUpdate = () => void navigator.serviceWorker?.getRegistration().then((registration) => setUpdate(registration?.waiting ?? null))
    const onBlocked = () => setBlocked(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    navigator.serviceWorker?.addEventListener('controllerchange', onController)
    window.addEventListener('pwa-update-available', onUpdate)
    window.addEventListener('pwa-update-blocked', onBlocked)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      navigator.serviceWorker?.removeEventListener('controllerchange', onController)
      window.removeEventListener('pwa-update-available', onUpdate)
      window.removeEventListener('pwa-update-blocked', onBlocked)
    }
  }, [])

  const label = blocked ? '请先暂停游戏再更新' : update ? '有可用更新' : online ? (cached ? '已缓存 · 可离线' : '在线') : '离线 · 本地模式'
  return (
    <span className={`offline-status ${online ? 'online' : 'offline'}`} role="status" aria-live="polite">
      {online ? <Wifi size={15} aria-hidden="true" /> : <CloudOff size={15} aria-hidden="true" />}
      <span>{label}</span>
      {update && <button type="button" onClick={() => {
        const running = document.querySelector('[aria-label="暂停 (Space)"]:not(:disabled)')
        if (running) {
          window.dispatchEvent(new CustomEvent('pwa-update-blocked'))
          return
        }
        sessionStorage.setItem('advance-pwa-update-requested', '1')
        update.postMessage({ type: 'SKIP_WAITING' })
      }}>更新</button>}
    </span>
  )
}

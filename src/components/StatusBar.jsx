import React, { useEffect, useState } from 'react'

export default function StatusBar() {
  const [now, setNow] = useState(new Date())
  const [online, setOnline] = useState(navigator.onLine)
  const [metrics, setMetrics] = useState(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    const m = setInterval(() => window.jarvis.sysMetrics().then(setMetrics).catch(() => {}), 3000)
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { clearInterval(t); clearInterval(m); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const memPct = metrics ? Math.round((metrics.mem.used / metrics.mem.total) * 100) : null

  return (
    <footer className="statusbar">
      <span className="sb-left">
        {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        {' · '}{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        {metrics && <> · <span className="sb-metric">CPU {metrics.cpu}%</span> · <span className="sb-metric">RAM {memPct}%</span></>}
      </span>
      <span className={`sb-right ${online ? 'on' : 'off'}`}>
        {online ? '● ONLINE' : '○ OFFLINE'}
      </span>
    </footer>
  )
}

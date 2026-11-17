import React, { useEffect, useState } from 'react'

export default function StatusBar() {
  const [now, setNow] = useState(new Date())
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  return (
    <footer className="statusbar">
      <span className="sb-left">
        {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        {' · '}{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <span className={`sb-right ${online ? 'on' : 'off'}`}>
        {online ? '● ONLINE' : '○ OFFLINE'}
      </span>
    </footer>
  )
}

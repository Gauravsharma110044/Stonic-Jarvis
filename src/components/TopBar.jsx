import React, { useEffect, useState } from 'react'

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'apps', label: 'Apps' },
  { id: 'memory', label: 'Memory' },
  { id: 'settings', label: 'Settings' },
]

function fmtBytes(b) {
  if (!b) return '—'
  const g = b / 2 ** 30
  return g >= 100 ? `${Math.round(g)}G` : `${g.toFixed(1)}G`
}

export default function TopBar({ section, onNav, maximized, onMin, onMax, onClose }) {
  const [m, setM] = useState(null)
  useEffect(() => {
    let dead = false
    const load = () => window.jarvis.sysMetrics().then(v => !dead && setM(v))
    load()
    const t = setInterval(load, 2500)
    return () => { dead = true; clearInterval(t) }
  }, [])

  return (
    <header className="topbar">
      <div className="tb-brand">
        <img src="icon.png" className="tb-logo" alt="" />
        <span className="tb-name">JARVIS</span>
      </div>
      <nav className="tb-nav">
        {NAV.map(n => (
          <button key={n.id}
            className={`tb-navbtn ${section === n.id ? 'active' : ''}`}
            onClick={() => onNav(n.id)}>{n.label}</button>
        ))}
      </nav>
      <div className="tb-metrics">
        {m && (
          <>
            <span className="metric" title={`CPU ${m.cpu}%`}><i style={{ width: `${m.cpu}%` }} /></span>
            <span className="metric" title={`RAM ${fmtBytes(m.mem.used)} / ${fmtBytes(m.mem.total)}`}>
              <i style={{ width: `${(m.mem.used / m.mem.total) * 100}%` }} />
            </span>
            <span className="metric" title={`SSD ${fmtBytes(m.disk.used)} / ${fmtBytes(m.disk.total)}`}>
              <i style={{ width: `${m.disk.total ? (m.disk.used / m.disk.total) * 100 : 0}%` }} />
            </span>
          </>
        )}
      </div>
      <div className="tb-controls">
        <button className="win-btn" onClick={onMin} title="Minimize">─</button>
        <button className="win-btn" onClick={onMax} title={maximized ? 'Restore' : 'Maximize'}>{maximized ? '❐' : '□'}</button>
        <button className="win-btn close" onClick={onClose} title="Close">✕</button>
      </div>
    </header>
  )
}

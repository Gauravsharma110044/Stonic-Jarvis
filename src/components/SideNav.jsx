import React from 'react'

const ITEMS = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'apps', icon: '▦', label: 'Applications' },
  { id: 'files', icon: '▤', label: 'Files' },
  { id: 'workspace', icon: '◈', label: 'Workspace' },
  { id: 'stats', icon: '📊', label: 'Telemetry' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
]

export default function SideNav({ section, onNav }) {
  return (
    <nav className="sidenav">
      {ITEMS.map(it => (
        <button key={it.id}
          className={`side-btn ${section === it.id ? 'active' : ''}`}
          title={it.label}
          onClick={() => onNav(it.id)}>
          <span>{it.icon}</span>
        </button>
      ))}
    </nav>
  )
}

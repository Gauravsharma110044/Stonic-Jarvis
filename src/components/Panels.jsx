import React, { useEffect, useState } from 'react'

export function MemoryPanel() {
  const [notes, setNotes] = useState([])
  useEffect(() => { window.jarvis.notesList().then(setNotes) }, [])
  return (
    <div className="panel">
      <h2>Memory</h2>
      <p className="panel-sub">Jarvis scratchpad — saved via <code>/note &lt;text&gt;</code> in chat.</p>
      {notes.length === 0 && <div className="panel-empty">No memories yet. Ask Jarvis to remember something.</div>}
      <div className="note-list">
        {notes.map((n, i) => <div key={i} className="note-item">{n}</div>)}
      </div>
    </div>
  )
}

const PLACEHOLDERS = {
  apps: { icon: '▦', title: 'Applications', text: 'App integrations (Spotify, Gmail, Calendar…) are planned. For now Jarvis can open apps via /open on your PC.' },
  files: { icon: '▤', title: 'Files', text: 'File browsing is planned. You can already attach text files to a message with the 📎 button.' },
  workspace: { icon: '◈', title: 'Workspace', text: 'Multi-agent workspace is planned. Jarvis currently runs commands and chats via the AI engine.' },
}

export function PlaceholderPanel({ kind }) {
  const p = PLACEHOLDERS[kind]
  return (
    <div className="panel center">
      <div className="panel-icon">{p.icon}</div>
      <h2>{p.title}</h2>
      <p className="panel-sub">{p.text}</p>
      <span className="panel-badge">PLANNED</span>
    </div>
  )
}

import React, { useEffect, useState } from 'react'

export function MemoryPanel() {
  const [notes, setNotes] = useState([])
  const [mem, setMem] = useState({ facts: [], lessons: [], plans: [] })
  const [jobs, setJobs] = useState([])
  const [vault, setVault] = useState([])
  const load = () => {
    window.jarvis.notesList().then(setNotes)
    window.jarvis.memoryGet().then(setMem)
    window.jarvis.jobsList().then(setJobs)
    window.jarvis.vaultList().then(setVault)
  }
  useEffect(load, [])
  const cancel = id => window.jarvis.jobCancel(id).then(load)
  const Section = ({ title, items, render }) => items.length > 0 && (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-faint)', marginBottom: 8 }}>{title}</h3>
      {items.map(render)}
    </div>
  )
  return (
    <div className="panel">
      <h2>Memory</h2>
      <p className="panel-sub">Jarvis long-term memory — facts, lessons, plans, scheduled jobs, vault.</p>
      {notes.length === 0 && <div className="panel-empty">No notes yet. Ask Jarvis to remember something.</div>}
      <div className="note-list">
        {notes.map((n, i) => <div key={i} className="note-item">{n}</div>)}
      </div>
      <Section title="Facts Jarvis remembers" items={mem.facts}
        render={(f, i) => <div key={i} className="note-item">{f.text}</div>} />
      <Section title="Lessons learned" items={mem.lessons}
        render={(l, i) => <div key={i} className="note-item" style={{ opacity: .7 }}>avoid: {l.text}</div>} />
      <Section title="Scheduled jobs" items={jobs}
        render={j => (
          <div key={j.id} className="note-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{j.desc}</span>
            <button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: 11 }} onClick={() => cancel(j.id)}>✕</button>
          </div>
        )} />
      <Section title="Vault secrets" items={vault.map(v => ({ v }))}
        render={({ v }) => <div key={v} className="note-item">🔒 {v}</div>} />
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

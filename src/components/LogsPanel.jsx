import React, { useEffect, useState, useRef } from 'react'

export default function LogsPanel() {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState('audit')
  const [activity, setActivity] = useState([])
  const [clips, setClips] = useState([])
  const bottomRef = useRef(null)

  const load = async () => {
    try {
      const [l, a, c] = await Promise.all([window.jarvis.logsGet(), window.jarvis.activityGet(), window.jarvis.clipboardHistory()])
      setLogs(l || [])
      setActivity((a || []).slice().reverse())
      setClips(c || [])
    } catch {}
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [activity.length])

  const shown = tab === 'audit'
    ? logs.filter(l => !filter || l.text.toLowerCase().includes(filter.toLowerCase()))
    : activity.filter(l => !filter || l.text.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="logs-panel">
      <div className="logs-head">
        <div className="logs-tabs">
          <button className={`logs-tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>Audit log</button>
          <button className={`logs-tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Live activity</button>
          <button className={`logs-tab ${tab === 'clipboard' ? 'active' : ''}`} onClick={() => setTab('clipboard')}>Clipboard</button>
        </div>
        <input className="logs-filter" placeholder="Filter…" value={filter} onChange={e => setFilter(e.target.value)} />
      </div>
      <div className="logs-body">
        {(tab === 'clipboard' ? clips : shown).length === 0 && <div className="logs-empty">No log entries yet.</div>}
        {tab === 'clipboard' ? clips.filter(c => !filter || c.toLowerCase().includes(filter.toLowerCase())).map((c, i) => (
          <div key={i} className="log-line">
            <span className="log-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c}</span>
          </div>
        )) : tab === 'audit' ? shown.map((l, i) => (
          <div key={i} className="log-line">
            <span className="log-ts">{l.ts ? new Date(l.ts).toLocaleString() : ''}</span>
            <span className="log-text">{l.text}</span>
          </div>
        )) : shown.map((l, i) => (
          <div key={i} className="log-line">
            <span className="log-ts">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="log-text">{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

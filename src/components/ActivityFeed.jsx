import React, { useEffect, useState } from 'react'

export default function ActivityFeed() {
  const [items, setItems] = useState([])
  useEffect(() => {
    let live = true
    const load = () => window.jarvis.activityGet().then(d => live && setItems(d || []))
    load()
    const t = setInterval(load, 2000)
    return () => { live = false; clearInterval(t) }
  }, [])
  return (
    <div className="activity-feed">
      <div className="activity-title">LIVE ACTIVITY</div>
      {items.length === 0 && <div className="activity-empty">Jarvis is idle</div>}
      {[...items].reverse().slice(0, 8).map((a, i) => (
        <div key={a.ts + i} className="activity-item">
          <span className="activity-dot" />
          <span className="activity-text">{a.text}</span>
          <span className="activity-time">{new Date(a.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      ))}
    </div>
  )
}

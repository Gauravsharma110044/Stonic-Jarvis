import React from 'react'

// Minimal markdown: **bold**, `code`, newlines. Returns React nodes (safe).
export function renderText(text) {
  const lines = String(text).split('\n')
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {renderInline(line)}
      {i < lines.length - 1 && <br />}
    </React.Fragment>
  ))
}

function renderInline(line) {
  // split on `code` and **bold**
  const parts = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g
  let last = 0, m
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    if (m[1]) parts.push(<code key={m.index}>{m[1].slice(1, -1)}</code>)
    else parts.push(<strong key={m.index}>{m[2].slice(2, -2)}</strong>)
    last = m.index + m[0].length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

export function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(ts).toLocaleDateString()
}

export function Avatar({ user, size }) {
  if (!user) return null
  const initials = (user.displayName || user.name || '?').slice(0, 2).toUpperCase()
  return (
    <span className={`avatar ${size || ''}`} style={{ background: user.color || '#666' }}>
      {initials}
    </span>
  )
}

export function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

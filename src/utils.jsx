import React from 'react'

function CodeBlock({ code }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="code-block">
      <button className="code-copy" onClick={() => {
        navigator.clipboard?.writeText(code).catch(() => {})
        setCopied(true); setTimeout(() => setCopied(false), 1200)
      }}>{copied ? 'Copied!' : 'Copy'}</button>
      <pre><code>{code}</code></pre>
    </div>
  )
}

// Minimal markdown: **bold**, `code`, ```blocks```, newlines. Returns React nodes (safe).
export function renderText(text) {
  const src = String(text)
  const parts = []
  const fenceRe = /```(\w*)\n?([\s\S]*?)(?:```|$)/g
  let last = 0, m, k = 0
  while ((m = fenceRe.exec(src))) {
    if (m.index > last) parts.push(<React.Fragment key={k++}>{renderLines(src.slice(last, m.index))}</React.Fragment>)
    parts.push(<CodeBlock key={k++} code={m[2].replace(/\n$/, '')} />)
    last = m.index + m[0].length
  }
  if (last < src.length) parts.push(<React.Fragment key={k++}>{renderLines(src.slice(last))}</React.Fragment>)
  return <>{parts}</>
}

function renderLines(text) {
  const lines = text.split('\n')
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

import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function CommandPalette({ open, onClose, actions }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return actions
    return actions.filter(a => a.label.toLowerCase().includes(s) || (a.hint || '').toLowerCase().includes(s))
  }, [q, actions])

  useEffect(() => {
    if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30) }
  }, [open])

  useEffect(() => setSel(0), [q])

  if (!open) return null

  const run = (a) => { onClose(); a.run() }

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    else if (e.key === 'Enter' && filtered[sel]) { e.preventDefault(); run(filtered[sel]) }
  }

  useEffect(() => {
    listRef.current?.querySelector('.cp-item.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <div className="cp-backdrop" onClick={onClose}>
      <div className="cp" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cp-input"
          placeholder="Type a command…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && <div className="cp-empty">No matching commands</div>}
          {filtered.map((a, i) => (
            <button key={a.label} className={`cp-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => run(a)}>
              <span className="cp-label">{a.label}</span>
              {a.hint && <span className="cp-hint">{a.hint}</span>}
            </button>
          ))}
        </div>
        <div className="cp-foot">↑↓ navigate · Enter select · Esc close</div>
      </div>
    </div>
  )
}

import React, { useEffect, useRef, useState } from 'react'

const MAX = 90 // ~3 min at 2s interval

export default function StatsPanel() {
  const ref = useRef(null)
  const [latest, setLatest] = useState(null)
  const hist = useRef({ cpu: [], mem: [] })

  useEffect(() => {
    let live = true
    const cv = ref.current
    const ctx = cv.getContext('2d')
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr
      if (cv.width !== w) { cv.width = w; cv.height = h }
      ctx.clearRect(0, 0, w, h)
      const { cpu, mem } = hist.current
      const drawLine = (data, color) => {
        if (data.length < 2) return
        ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.beginPath()
        data.forEach((v, i) => {
          const x = (i / (MAX - 1)) * w
          const y = h - (v / 100) * h * 0.9 - h * 0.05
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        })
        ctx.stroke()
        // fill under
        ctx.lineTo(((data.length - 1) / (MAX - 1)) * w, h)
        ctx.lineTo(0, h); ctx.closePath()
        ctx.fillStyle = color + '22'; ctx.fill()
      }
      drawLine(cpu, '#57d9ff')
      drawLine(mem, '#ff5d8f')
      // grid
      ctx.strokeStyle = 'rgba(87,217,255,.08)'; ctx.lineWidth = dpr
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke() }
    }
    const poll = () => window.jarvis.sysMetrics().then(m => {
      if (!live || !m) return
      hist.current.cpu.push(m.cpu); hist.current.mem.push(Math.round(m.mem.used / m.mem.total * 100))
      if (hist.current.cpu.length > MAX) { hist.current.cpu.shift(); hist.current.mem.shift() }
      setLatest(m)
      draw()
    }).catch(() => {})
    poll()
    const t = setInterval(poll, 2000)
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    return () => { live = false; clearInterval(t); ro.disconnect() }
  }, [])

  const memPct = latest ? Math.round(latest.mem.used / latest.mem.total * 100) : null

  return (
    <div className="panel stats-panel">
      <h3>SYSTEM TELEMETRY</h3>
      <div className="stats-cards">
        <div className="stat-card"><span className="stat-val" style={{ color: '#57d9ff' }}>{latest?.cpu ?? '—'}%</span><span className="stat-label">CPU</span></div>
        <div className="stat-card"><span className="stat-val" style={{ color: '#ff5d8f' }}>{memPct ?? '—'}%</span><span className="stat-label">RAM</span></div>
        <div className="stat-card"><span className="stat-val">{latest ? Math.round(latest.disk.used / 1e9) : '—'}</span><span className="stat-label">DISK GB USED</span></div>
      </div>
      <canvas ref={ref} className="stats-graph" />
      <div className="stats-legend"><span style={{ color: '#57d9ff' }}>■ CPU</span><span style={{ color: '#ff5d8f' }}>■ RAM</span><span style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>last 3 min</span></div>
    </div>
  )
}

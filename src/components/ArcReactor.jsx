import React from 'react'

// Animated arc-reactor orb — matches the app icon.
export default function ArcReactor({ size = 140 }) {
  return (
    <svg className="reactor" width={size} height={size} viewBox="0 0 200 200" fill="none">
      <defs>
        <radialGradient id="coreGrad" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stopColor="#f4f8ff" />
          <stop offset="35%" stopColor="#9cc4ff" />
          <stop offset="70%" stopColor="#3f7dff" />
          <stop offset="100%" stopColor="#1a3a8f" />
        </radialGradient>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4f8cff" />
          <stop offset="50%" stopColor="#57d9ff" />
          <stop offset="100%" stopColor="#f0b429" />
        </linearGradient>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* outer tick ring */}
      <g className="reactor-ticks" style={{ transformOrigin: '100px 100px' }}>
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2
          const x1 = 100 + Math.cos(a) * 88, y1 = 100 + Math.sin(a) * 88
          const x2 = 100 + Math.cos(a) * (i % 6 === 0 ? 80 : 84), y2 = 100 + Math.sin(a) * (i % 6 === 0 ? 80 : 84)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3d5a8f" strokeWidth={i % 6 === 0 ? 2 : 1} opacity={i % 6 === 0 ? .8 : .45} />
        })}
      </g>

      {/* outer dashed ring - slow spin */}
      <circle className="reactor-spin-slow" cx="100" cy="100" r="76" stroke="url(#ringGrad)" strokeWidth="3"
        strokeDasharray="14 10" opacity=".9" style={{ transformOrigin: '100px 100px' }} />

      {/* segmented middle ring - counter spin */}
      <g className="reactor-spin-rev" style={{ transformOrigin: '100px 100px' }}>
        {Array.from({ length: 8 }).map((_, i) => {
          const a0 = (i / 8) * 360
          const a1 = a0 + 32
          return (
            <path key={i}
              d={arcPath(100, 100, 62, a0, a1)}
              stroke={i % 2 ? '#f0b429' : '#4f8cff'} strokeWidth="7" strokeLinecap="round" opacity=".95" />
          )
        })}
      </g>

      {/* inner thin ring */}
      <circle cx="100" cy="100" r="50" stroke="#2b4a80" strokeWidth="1.5" opacity=".8" />

      {/* core */}
      <circle className="reactor-core" cx="100" cy="100" r="42" fill="url(#coreGrad)" filter="url(#glow)" />
      <circle className="reactor-core-halo" cx="100" cy="100" r="46" fill="none" stroke="#7db4ff" strokeWidth="1" opacity=".5" />
    </svg>
  )
}

function arcPath(cx, cy, r, a0, a1) {
  const rad = a => (a - 90) * Math.PI / 180
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0))
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1))
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

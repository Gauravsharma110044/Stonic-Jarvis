import React from 'react'
import Waveform from './Waveform.jsx'

// Central JARVIS core — state-driven arc reactor with waveform strips.
// state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'
export default function JarvisCore({ state = 'idle', analyser = null, size = 190 }) {
  return (
    <div className={`core-wrap state-${state}`}>
      <div className="core-stage">
        <Waveform side="left" mode={state} analyser={analyser} />
        <Reactor state={state} size={size} />
        <Waveform side="right" mode={state} analyser={analyser} />
      </div>
      <div className="core-title">JARVIS</div>
      <div className="core-sub">
        {state === 'listening' ? 'Listening…'
          : state === 'thinking' ? 'Processing…'
          : state === 'speaking' ? 'Speaking…'
          : state === 'error' ? 'Something went wrong'
          : 'How can I assist you today?'}
      </div>
    </div>
  )
}

function Reactor({ state, size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" className="reactor-svg">
      <defs>
        <radialGradient id="jc" cx="50%" cy="40%" r="68%">
          <stop offset="0%" stopColor="#f4f8ff" />
          <stop offset="30%" stopColor="#a8ccff" />
          <stop offset="62%" stopColor="#3f7dff" />
          <stop offset="100%" stopColor="#16306e" />
        </radialGradient>
        <linearGradient id="jr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4f8cff" />
          <stop offset="55%" stopColor="#57d9ff" />
          <stop offset="100%" stopColor="#f0b429" />
        </linearGradient>
        <filter id="jg" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* tick ring */}
      <g className="jc-ticks" style={{ transformOrigin: '100px 100px' }}>
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i / 36) * Math.PI * 2
          const big = i % 9 === 0
          const r1 = 90, r2 = big ? 80 : 85
          return <line key={i}
            x1={100 + Math.cos(a) * r1} y1={100 + Math.sin(a) * r1}
            x2={100 + Math.cos(a) * r2} y2={100 + Math.sin(a) * r2}
            stroke="#33507f" strokeWidth={big ? 2 : 1} opacity={big ? .9 : .4} />
        })}
      </g>

      {/* outer dashed ring */}
      <circle className="jc-ring-outer" cx="100" cy="100" r="80" stroke="url(#jr)" strokeWidth="2.5"
        strokeDasharray="18 12" opacity=".85" style={{ transformOrigin: '100px 100px' }} />

      {/* segmented orbit ring */}
      <g className="jc-ring-seg" style={{ transformOrigin: '100px 100px' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <path key={i} d={arc(100, 100, 66, i * 45 + 3, i * 45 + 40)}
            stroke={i % 2 ? '#f0b429' : '#4f8cff'} strokeWidth="8" strokeLinecap="round" opacity=".9" />
        ))}
      </g>

      {/* thinking progress arc */}
      <circle className="jc-progress" cx="100" cy="100" r="73" fill="none"
        stroke="#57d9ff" strokeWidth="2" strokeLinecap="round"
        strokeDasharray="40 418" opacity="0" />

      {/* inner ring */}
      <circle cx="100" cy="100" r="54" stroke="#2b4a80" strokeWidth="1.2" opacity=".7" />

      {/* core */}
      <circle className="jc-core" cx="100" cy="100" r="44" fill="url(#jc)" filter="url(#jg)" />
      <circle className="jc-halo" cx="100" cy="100" r="49" fill="none" stroke="#7db4ff" strokeWidth="1" />
    </svg>
  )
}

function arc(cx, cy, r, a0, a1) {
  const rad = a => (a - 90) * Math.PI / 180
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0))
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1))
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`
}

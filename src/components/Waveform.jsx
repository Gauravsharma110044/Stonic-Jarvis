import React, { useEffect, useRef } from 'react'

// Audio waveform strip. 'listening' uses a real AnalyserNode when provided;
// other states use a lightweight sine animation. rAF only runs while active.
export default function Waveform({ side, mode, analyser }) {
  const ref = useRef(null)
  const BARS = 28

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    ctx.scale(dpr, dpr)

    // idle: no continuous rendering — CSS bars cover it
    if (mode === 'idle' || mode === 'error') return

    let raf
    const t0 = performance.now()
    const draw = (t) => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      const bw = w / BARS
      const time = (t - t0) / 1000

      let data = null
      if (mode === 'listening' && analyser) {
        data = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(data)
      }

      for (let i = 0; i < BARS; i++) {
        let v
        if (data) {
          const idx = Math.floor((i / BARS) * data.length * 0.7)
          v = data[idx] / 255
        } else {
          // speaking/thinking: gentle travelling wave, livelier when speaking
          const amp = mode === 'speaking' ? 0.9 : mode === 'thinking' ? 0.45 : 0.3
          v = (Math.sin(time * (mode === 'speaking' ? 6 : 2.4) + i * 0.55) * 0.5 + 0.5) * amp
            + Math.sin(time * 1.7 + i * 0.3) * 0.15
        }
        const bh = Math.max(3, v * h * 0.92)
        const x = i * bw + bw * 0.22
        const y = (h - bh) / 2
        const grad = ctx.createLinearGradient(0, y, 0, y + bh)
        grad.addColorStop(0, 'rgba(87,217,255,0)')
        grad.addColorStop(0.5, mode === 'listening' ? 'rgba(87,217,255,.95)' : 'rgba(79,140,255,.85)')
        grad.addColorStop(1, 'rgba(79,140,255,0)')
        ctx.fillStyle = grad
        const bwid = bw * 0.56
        ctx.beginPath()
        ctx.roundRect(x, y, bwid, bh, bwid / 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [mode, analyser])

  return <canvas ref={ref} className={`wave wave-${side}`} />
}

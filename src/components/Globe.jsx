import React, { useEffect, useRef } from 'react'
import earthUrl from '../assets/earth.jpg'

// Flat 2D spinning earth disc
export default function GlobePanel() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    const img = new Image()
    img.src = earthUrl
    let raf, t = 0, ready = false
    img.onload = () => { ready = true }
    const DPR = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => { cv.width = cv.clientWidth * DPR; cv.height = cv.clientHeight * DPR }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      t += 0.003
      const w = cv.width, h = cv.height
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44
      ctx.clearRect(0, 0, w, h)

      // glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 1.35)
      glow.addColorStop(0, 'rgba(87,217,255,0.15)')
      glow.addColorStop(1, 'rgba(87,217,255,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 7); ctx.fill()

      ctx.save()
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip()
      if (ready && img.width) {
        const IW = img.width, IH = img.height
        // flat wrap: source x scrolls, dest is square-ish disc
        const off = (t * IW * 0.35) % IW
        const D = R * 2
        const srcH = IH * 0.72, srcY = IH * 0.14
        const tileW = D
        let sx = -off * (D / IW)
        while (sx < -tileW) sx += tileW
        for (let dx = sx - tileW; dx < tileW * 2; dx += tileW) {
          ctx.drawImage(img, 0, srcY, IW, srcH, cx - R + dx, cy - R, tileW, D)
        }
      } else {
        ctx.fillStyle = '#0a1a33'
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
      }
      ctx.restore()

      // rim + subtle equator line
      ctx.strokeStyle = 'rgba(120,200,255,0.35)'
      ctx.lineWidth = 1.2 * DPR
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke()
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} className="globe-canvas" />
}

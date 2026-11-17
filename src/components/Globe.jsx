import React, { useEffect, useRef } from 'react'

// Rotating dotted 3D globe with feature beacons
const BEACONS = [
  { label: 'VISION', lat: 0.5, lon: 0.3, color: '#57d9ff' },
  { label: 'BROWSER', lat: -0.3, lon: 1.2, color: '#7aa8ff' },
  { label: 'FILES', lat: 0.9, lon: 2.4, color: '#38e0a0' },
  { label: 'SLACK', lat: -0.7, lon: 3.6, color: '#b48cff' },
  { label: 'VAULT', lat: 0.2, lon: 4.8, color: '#ffd166' },
  { label: 'AGENTS', lat: -0.5, lon: 5.7, color: '#ff7a9e' },
]

export default function GlobePanel() {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv.getContext('2d')
    let raf, t = 0
    const DPR = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      cv.width = cv.clientWidth * DPR; cv.height = cv.clientHeight * DPR
    }
    resize()
    window.addEventListener('resize', resize)

    // fibonacci sphere dots
    const N = 700, pts = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const th = golden * i
      pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, s: Math.random() })
    }
    const beacons = BEACONS.map(b => {
      const lat = b.lat, lon = b.lon
      return {
        ...b,
        x: Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon),
      }
    })

    const draw = () => {
      t += 0.0035
      const w = cv.width, h = cv.height
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42
      const tilt = 0.35

      const rot = (p, ang) => {
        const x = p.x * Math.cos(ang) - p.z * Math.sin(ang)
        const z = p.x * Math.sin(ang) + p.z * Math.cos(ang)
        const y = p.y * Math.cos(tilt) - z * Math.sin(tilt)
        const z2 = p.y * Math.sin(tilt) + z * Math.cos(tilt)
        return { x, y, z: z2 }
      }

      // sphere dots
      for (const p of pts) {
        const q = rot(p, t)
        if (q.z < -0.15) continue
        const px = cx + q.x * R, py = cy - q.y * R
        const a = 0.15 + ((q.z + 1) / 2) * 0.65
        const sz = (0.7 + p.s * 1.1) * (q.z > 0 ? 1.15 : 0.8)
        ctx.fillStyle = `rgba(110,180,255,${a})`
        ctx.beginPath(); ctx.arc(px, py, sz * DPR * 0.9, 0, 7); ctx.fill()
      }
      // rim glow
      ctx.strokeStyle = 'rgba(87,217,255,0.18)'
      ctx.lineWidth = DPR
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke()

      // beacons
      for (const b of beacons) {
        const q = rot(b, t)
        if (q.z < -0.1) continue
        const px = cx + q.x * R, py = cy - q.y * R
        const pulse = 2 + Math.sin(t * 6 + b.lon) * 1.2
        const front = q.z > 0
        // glow ring
        ctx.strokeStyle = b.color + (front ? 'cc' : '44')
        ctx.lineWidth = 1.2 * DPR
        ctx.beginPath(); ctx.arc(px, py, (5 + pulse) * DPR, 0, 7); ctx.stroke()
        ctx.fillStyle = b.color
        ctx.beginPath(); ctx.arc(px, py, 2.4 * DPR, 0, 7); ctx.fill()
        // label when front-facing
        if (front && q.z > 0.35) {
          ctx.font = `${9 * DPR}px system-ui`
          ctx.fillStyle = b.color + 'ee'
          ctx.textAlign = 'center'
          ctx.fillText(b.label, px, py - 10 * DPR)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])
  return <canvas ref={ref} className="globe-canvas" />
}

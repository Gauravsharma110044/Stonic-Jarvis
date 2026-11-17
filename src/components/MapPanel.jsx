import React, { useEffect, useState } from 'react'

export default function MapPanel() {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    const load = async () => {
      let lat = 28.61, lon = 77.21 // default: Delhi
      try {
        const locs = await window.jarvis.locationsList()
        if (locs?.length) { lat = locs[0].lat; lon = locs[0].lon }
      } catch {}
      const d = 0.15
      if (live) setSrc(`https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`)
    }
    load()
    const t = setInterval(load, 15000)
    return () => { live = false; clearInterval(t) }
  }, [])
  return src ? <iframe className="map-frame" src={src} title="map" loading="lazy" /> : <div className="map-frame map-loading">Loading map…</div>
}

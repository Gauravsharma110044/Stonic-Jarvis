import React, { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export default function MapPanel() {
  const ref = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    if (!ref.current || mapRef.current) return
    const map = L.map(ref.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: true,
    }).setView([28.61, 77.21], 5)

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map)

    mapRef.current = map
    const loadMarkers = async () => {
      let locs = []
      try { locs = await window.jarvis.locationsList() } catch {}
      if (layerRef.current) map.removeLayer(layerRef.current)
      const group = L.layerGroup()
      for (const l of locs || []) {
        L.circleMarker([l.lat, l.lon], {
          radius: 6, color: '#ff5d8f', weight: 2, fillColor: '#ff5d8f', fillOpacity: 0.7,
        }).bindTooltip(l.name || l.display || 'location', { permanent: false, direction: 'top' }).addTo(group)
      }
      group.addTo(map)
      layerRef.current = group
      if (locs?.length) map.setView([locs[0].lat, locs[0].lon], Math.max(map.getZoom(), 6), { animate: true })
    }
    loadMarkers()
    const t = setInterval(loadMarkers, 15000)

    // click map → identify place → ask Jarvis
    map.on('click', async e => {
      const { lat, lng } = e.latlng
      L.circleMarker([lat, lng], { radius: 7, color: '#57d9ff', weight: 2, fillColor: '#57d9ff', fillOpacity: 0.8 }).addTo(map)
      let name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, { headers: { 'User-Agent': 'Jarvis/1.0' } })
        const d = await r.json()
        name = d.display_name?.split(',').slice(0, 3).join(',') || name
      } catch {}
      window.jarvis.sendMessage('d-jarvis', `I clicked on the map at ${name}. Tell me about this place.`)
    })
    return () => { clearInterval(t); map.remove(); mapRef.current = null }
  }, [])

  return <div ref={ref} className="map-frame leaflet-map" />
}

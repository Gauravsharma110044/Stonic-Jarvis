import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import earthUrl from '../assets/earth.jpg'

export default function GlobePanel() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.z = 2.8

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    el.appendChild(renderer.domElement)

    // real-time sun → day/night
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2)
    scene.add(sun)
    scene.add(new THREE.AmbientLight(0x1a2a4a, 0.75))
    const moonFill = new THREE.DirectionalLight(0x4466aa, 0.25)
    scene.add(moonFill)
    const subsolar = () => {
      const now = new Date()
      const doy = (now - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5
      const decl = -23.44 * Math.cos(2 * Math.PI * (doy + 10) / 365) * Math.PI / 180
      const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
      const ha = (utcH - 12) * 15 * Math.PI / 180
      const phi = Math.PI / 2 - decl
      return new THREE.Vector3(Math.sin(phi) * Math.cos(ha), Math.cos(phi), Math.sin(phi) * Math.sin(ha))
    }
    const updateSun = () => {
      const s = subsolar()
      sun.position.copy(s).multiplyScalar(6)
      moonFill.position.copy(s).multiplyScalar(-6)
    }
    updateSun()
    const sunTimer = setInterval(updateSun, 30000)

    const globe = new THREE.Group()
    scene.add(globe)

    new THREE.TextureLoader().load(earthUrl, tex => {
      tex.colorSpace = THREE.SRGBColorSpace
      globe.add(new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 64),
        new THREE.MeshPhongMaterial({ map: tex, shininess: 8, specular: 0x223355 })
      ))
      globe.add(new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 48, 48),
        new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.1, side: THREE.BackSide })
      ))
    })

    // location markers
    const markerGroup = new THREE.Group()
    globe.add(markerGroup)
    const markerObjs = []
    const D2R = Math.PI / 180
    const makeLabel = text => {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 56
      const c = cv.getContext('2d')
      c.font = 'bold 26px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'
      c.fillStyle = '#7fd4ff'; c.shadowColor = '#57d9ff'; c.shadowBlur = 10
      c.fillText(text.slice(0, 22), 128, 28)
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
      spr.scale.set(0.55, 0.12, 1)
      return spr
    }
    const refreshMarkers = async () => {
      let locs = []
      try { locs = await window.jarvis.locationsList() } catch {}
      markerObjs.forEach(o => markerGroup.remove(o))
      markerObjs.length = 0
      for (const l of locs || []) {
        const phi = Math.PI / 2 - l.lat * D2R, theta = l.lon * D2R
        const pos = new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)
        ).multiplyScalar(1.01)
        const pin = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff5d8f }))
        pin.position.copy(pos); markerGroup.add(pin)
        const ring = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshBasicMaterial({ color: 0xff5d8f, transparent: true, opacity: 0.4 }))
        ring.position.copy(pos); markerGroup.add(ring)
        const spr = makeLabel(l.name || l.display || 'loc')
        spr.position.copy(pos).multiplyScalar(1.3); markerGroup.add(spr)
        markerObjs.push(pin, ring, spr)
      }
    }
    refreshMarkers()
    const locTimer = setInterval(refreshMarkers, 5000)

    // drag rotate
    let dragging = false, px = 0, py = 0
    const dom = renderer.domElement
    dom.style.cursor = 'grab'
    const down = e => { dragging = true; px = e.clientX; py = e.clientY; dom.style.cursor = 'grabbing' }
    const move = e => {
      if (!dragging) return
      globe.rotation.y += (e.clientX - px) * 0.008
      globe.rotation.x = Math.max(-0.6, Math.min(0.6, globe.rotation.x + (e.clientY - py) * 0.005))
      px = e.clientX; py = e.clientY
    }
    // zoom on scroll wheel
    let zoom = 2.8
    const onWheel = e => {
      e.preventDefault()
      zoom = Math.max(1.7, Math.min(5, zoom + e.deltaY * 0.004))
      camera.position.z = zoom
      camera.updateProjectionMatrix()
    }
    dom.addEventListener('wheel', onWheel, { passive: false })
    const up = () => { dragging = false; dom.style.cursor = 'grab' }
    dom.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf, spin = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!dragging) globe.rotation.y += 0.0016
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(locTimer); clearInterval(sunTimer)
      ro.disconnect()
      dom.removeEventListener('pointerdown', down)
      dom.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      renderer.dispose()
      el.removeChild(dom)
    }
  }, [])
  return <div ref={ref} className="globe-canvas" />
}

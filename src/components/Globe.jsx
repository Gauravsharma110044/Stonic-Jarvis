import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import earthUrl from '../assets/earth.jpg'

export default function GlobePanel() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.z = 2.6

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    el.appendChild(renderer.domElement)

    // lights for sphere shading
    scene.add(new THREE.AmbientLight(0x334466, 1.4))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(4, 2, 5)
    scene.add(sun)

    const globe = new THREE.Group()
    scene.add(globe)

    const loader = new THREE.TextureLoader()
    loader.load(earthUrl, tex => {
      tex.colorSpace = THREE.SRGBColorSpace
      const earth = new THREE.Mesh(
        new THREE.SphereGeometry(1, 64, 64),
        new THREE.MeshPhongMaterial({ map: tex, shininess: 8, specular: 0x223355 })
      )
      globe.add(earth)
      // atmosphere shell
      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(1.06, 48, 48),
        new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.12, side: THREE.BackSide })
      )
      globe.add(atmo)
    })

    // location markers group
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
      spr.scale.set(0.6, 0.13, 1)
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
        const pin = new THREE.Mesh(
          new THREE.SphereGeometry(0.018, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xff5d8f })
        )
        pin.position.copy(pos)
        markerGroup.add(pin)
        const ring = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xff5d8f, transparent: true, opacity: 0.4 })
        )
        ring.position.copy(pos)
        markerGroup.add(ring)
        const spr = makeLabel(l.name || l.display || '📍')
        spr.position.copy(pos).multiplyScalar(1.28)
        markerGroup.add(spr)
        markerObjs.push(pin, ring, spr)
      }
    }
    refreshMarkers()
    const locTimer = setInterval(refreshMarkers, 5000)

    // drag to rotate
    let dragging = false, px = 0, py = 0, vx = 0, vy = 0
    const dom = renderer.domElement
    dom.style.cursor = 'grab'
    const down = e => { dragging = true; px = e.clientX; py = e.clientY; dom.style.cursor = 'grabbing' }
    const move = e => {
      if (!dragging) return
      const dx = e.clientX - px, dy = e.clientY - py
      px = e.clientX; py = e.clientY
      globe.rotation.y += dx * 0.008
      globe.rotation.x = Math.max(-0.6, Math.min(0.6, globe.rotation.x + dy * 0.005))
      vx = dx * 0.008; vy = dy * 0.005
    }
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

    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!dragging) {
        globe.rotation.y += 0.0016 + vx * 0.15 // auto-spin + inertia
        globe.rotation.x += vy * 0.1
        vx *= 0.94; vy *= 0.94
        globe.rotation.x = Math.max(-0.6, Math.min(0.6, globe.rotation.x))
      }
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      clearInterval(locTimer)
      ro.disconnect()
      dom.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      renderer.dispose()
      el.removeChild(dom)
    }
  }, [])
  return <div ref={ref} className="globe-canvas" />
}

// Generates electron/icon.png — Jarvis arc-reactor icon (512px).
// Dark squircle + segmented reactor ring + conic core + white "J".
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 512
const px = new Uint8Array(SIZE * SIZE * 4)
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (v) => Math.min(1, Math.max(0, v))
const clamp255 = (v) => Math.min(255, Math.max(0, v))
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

const CYAN = [64, 160, 255], BLUE = [40, 110, 255], GOLD = [240, 190, 60], WHITE = [240, 246, 255]

// 5x7 bitmap for "J"
const J = ['01110', '00001', '00001', '00001', '10001', '10001', '01110']
const JW = 5, JH = 7, SCALE = 22
const jx = Math.floor((SIZE - JW * SCALE) / 2)
const jy = Math.floor((SIZE - JH * SCALE) / 2)

const cx = SIZE / 2, cy = SIZE / 2
const RING_R = 178, RING_W = 26, SEGMENTS = 8, GAP = 0.10 // gap fraction per segment
const CORE_R = 138, OUTER_R = 208
const cornerR = 116

function insideRounded(x, y) {
  const qx = Math.abs(x - cx) - (SIZE / 2 - cornerR)
  const qy = Math.abs(y - cy) - (SIZE / 2 - cornerR)
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - cornerR
}

// angular palette for reactor: blue -> cyan -> blue across circle
function reactorColor(t) {
  // two gradient lobes opposite each other
  const u = (t * 2) % 1
  return mix(CYAN, BLUE, u)
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    const d = insideRounded(x + 0.5, y + 0.5)
    if (d > 0) { px[i + 3] = 0; continue }

    // background: deep navy vertical gradient + faint radial lift at center
    let t = y / SIZE
    let r = lerp(13, 20, t), g = lerp(17, 26, t), b = lerp(26, 38, t)
    const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
    const lift = clamp01(1 - dist / (SIZE * 0.75)) * 14
    r += lift * 0.4; g += lift * 0.6; b += lift * 1.0

    const ang = (Math.atan2(y + 0.5 - cy, x + 0.5 - cx) / (Math.PI * 2) + 1) % 1

    // outer thin guide ring
    if (Math.abs(dist - OUTER_R) < 2.2) {
      const rc = reactorColor(ang)
      r = lerp(r, rc[0], .55); g = lerp(g, rc[1], .55); b = lerp(b, rc[2], .55)
    }

    // segmented reactor ring
    if (Math.abs(dist - RING_R) < RING_W / 2) {
      const segPos = (ang * SEGMENTS) % 1
      const inGap = segPos < GAP || segPos > 1 - GAP
      if (!inGap) {
        // per-segment brightness: brighter at segment centers
        const segCenter = Math.min(segPos - GAP, 1 - GAP - segPos) / (1 - 2 * GAP)
        const bright = 0.75 + 0.45 * Math.sin(segCenter * Math.PI)
        const rc = reactorColor(ang)
        // gold accents on alternating segments
        const segIdx = Math.floor(ang * SEGMENTS)
        const col = segIdx % 2 === 0 ? rc : mix(rc, GOLD, 0.35)
        r = lerp(r, col[0] * bright, .95); g = lerp(g, col[1] * bright, .95); b = lerp(b, col[2] * bright, .95)
      }
    }

    // core disc: radial glow + conic tint
    if (dist < CORE_R) {
      const edge = clamp01((CORE_R - dist) / 10)
      const coreGlow = 0.35 + 0.65 * edge
      const rc = reactorColor(ang)
      // inner core brightens toward center
      const inner = clamp01(1 - dist / CORE_R)
      const cr = lerp(rc[0] * 0.7, WHITE[0], inner * inner * 0.85)
      const cg = lerp(rc[1] * 0.7, WHITE[1], inner * inner * 0.85)
      const cb = lerp(rc[2] * 0.7, WHITE[2], inner * inner * 0.85)
      r = lerp(r, cr * coreGlow, .92); g = lerp(g, cg * coreGlow, .92); b = lerp(b, cb * coreGlow, .92)
    }

    // "J" letter knocked out of the core
    const lx = Math.floor((x - jx) / SCALE), ly = Math.floor((y - jy) / SCALE)
    if (lx >= 0 && lx < JW && ly >= 0 && ly < JH && J[ly][lx] === '1') {
      // dark J with slight blue rim for contrast on bright core
      r = 16; g = 20; b = 34
    }

    px[i] = clamp255(r); px[i + 1] = clamp255(g); px[i + 2] = clamp255(b); px[i + 3] = 255
  }
}

// ---- minimal PNG encoder ----
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = buf => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

const stride = SIZE * 4 + 1
const raw = Buffer.alloc(SIZE * stride)
for (let y = 0; y < SIZE; y++) {
  raw[y * stride] = 0
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * stride + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8; ihdr[9] = 6

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = path.join(__dirname, 'icon.png')
fs.writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')

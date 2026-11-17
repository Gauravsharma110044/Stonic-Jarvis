// Python Intelligence Engine bridge — lazy-spawned FastAPI service on 127.0.0.1:8791
const { spawn } = require('child_process')
const path = require('path')

const PORT = 8791
const BASE = `http://127.0.0.1:${PORT}`
let proc = null
let ready = false
let starting = null

function pyPath() {
  return path.join(__dirname, '..', 'jarvis_engine.py')
}

async function ensure() {
  if (ready) return true
  if (starting) return starting
  starting = (async () => {
    // quick health check first — maybe already running
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) { ready = true; return true }
    } catch {}
    // spawn python engine with NVIDIA key env
    const { getStore } = require('./store.cjs')
    const store = getStore()
    const env = {
      ...process.env,
      NVIDIA_API_KEY: store.state.settings.llmApiKey || process.env.NVIDIA_API_KEY || '',
      JARVIS_LLM_BASE: store.state.settings.llmBaseUrl || 'https://integrate.api.nvidia.com/v1',
      JARVIS_MODEL: store.state.settings.llmModel || 'nvidia/nemotron-3-ultra-550b-a55b',
    }
    const fs = require('fs')
    const py312 = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe')
    const pyExe = process.env.JARVIS_PYTHON || (fs.existsSync(py312) ? py312 : 'python')
    proc = spawn(pyExe, [pyPath()], { env, windowsHide: true, stdio: 'ignore' })
    proc.on('exit', () => { proc = null; ready = false })
    // wait for health (up to 15s)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500))
      try {
        const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) })
        if (r.ok) { ready = true; return true }
      } catch {}
    }
    return false
  })()
  const ok = await starting
  starting = null
  return ok
}

async function call(endpoint, body, timeoutMs = 95000) {
  if (!(await ensure())) return { ok: false, error: 'python engine unavailable' }
  try {
    const r = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return await r.json()
  } catch (e) {
    ready = false // engine may have died — respawn next call
    return { ok: false, error: e.message }
  }
}

function shutdown() {
  try { proc?.kill() } catch {}
  proc = null; ready = false
}

module.exports = { ensure, call, shutdown, isReady: () => ready }

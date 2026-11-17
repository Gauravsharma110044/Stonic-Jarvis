// Hugging Face speech-to-speech bridge — STT (whisper) + TTS
const { getStore } = require('./store.cjs')

const HF = 'https://api-inference.huggingface.co'
const STT_MODEL = 'openai/whisper-large-v3'
const TTS_MODEL = 'facebook/mms-tts-eng'

function token() {
  return getStore().state.settings.hfToken || process.env.HF_TOKEN || ''
}

async function stt(audioB64, mime = 'audio/webm') {
  const tok = token()
  if (!tok) return { ok: false, error: 'No Hugging Face token — add it in Settings.' }
  // HF inference accepts raw audio bytes
  const buf = Buffer.from(audioB64, 'base64')
  const r = await fetch(`${HF}/models/${STT_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': mime === 'audio/wav' ? 'audio/wav' : 'audio/webm' },
    body: buf,
    signal: AbortSignal.timeout(60000),
  })
  if (r.status === 503 || r.status === 429) return { ok: false, error: 'Model loading/rate-limited — retry in a few seconds.' }
  if (!r.ok) return { ok: false, error: `HF STT HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` }
  const d = await r.json()
  return { ok: true, text: (d.text || '').trim() }
}

async function tts(text) {
  const tok = token()
  if (!tok) return { ok: false, error: 'No Hugging Face token.' }
  const r = await fetch(`${HF}/models/${TTS_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: String(text).slice(0, 1500) }),
    signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) return { ok: false, error: `HF TTS HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` }
  const buf = Buffer.from(await r.arrayBuffer())
  return { ok: true, audio: buf.toString('base64'), mime: 'audio/wav' }
}

module.exports = { stt, tts }

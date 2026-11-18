// Telegram bridge — Jarvis as a Telegram bot via long polling (no public URL, no extra deps).
const { getStore } = require('./store.cjs')
const assistant = require('./assistant.cjs')

const store = getStore()
const API = 'https://api.telegram.org'
let running = false
let offset = 0
let stopFlag = false

function tgEnabled() {
  const s = store.state.settings
  const token = s.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || ''
  return (s.telegramEnabled || token) && token
}

async function tg(method, body) {
  const token = store.state.settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(35000),
  })
  return r.json().catch(() => ({ ok: false }))
}

async function send(chatId, text) {
  // Telegram caps messages at 4096 chars — split long replies
  const chunks = []
  for (let i = 0; i < String(text).length; i += 4000) chunks.push(String(text).slice(i, i + 4000))
  for (const c of chunks.slice(0, 5)) {
    await tg('sendMessage', { chat_id: chatId, text: c, parse_mode: 'Markdown' })
      .catch(() => tg('sendMessage', { chat_id: chatId, text: c }))
  }
}

async function handle(msg) {
  const chatId = msg.chat?.id
  const text = (msg.text || '').trim()
  if (!chatId || !text) return
  const allowed = String(store.state.settings.telegramAllowedUsers || '').split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.length && !allowed.includes(String(msg.from?.id))) {
    await send(chatId, '⛔ Not authorized on Jarvis.')
    return
  }
  try {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
    const reply = await assistant.handleMessage(text, 'telegram', { channelId: `tg-${chatId}` })
    if (reply) await send(chatId, reply)
  } catch (e) {
    console.error('[telegram] handler error:', e.message)
    await send(chatId, 'Sorry, something went wrong.').catch(() => {})
  }
}

async function poll() {
  while (running && !stopFlag) {
    try {
      const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] })
      if (r.ok && r.result?.length) {
        for (const u of r.result) {
          offset = u.update_id + 1
          if (u.message) await handle(u.message)
        }
      } else if (!r.ok) {
        console.warn('[telegram] poll error:', r.description || 'unknown')
        await new Promise(res => setTimeout(res, 5000))
      }
    } catch (e) {
      console.warn('[telegram] poll exception:', e.message)
      await new Promise(res => setTimeout(res, 5000))
    }
  }
}

async function start() {
  if (!tgEnabled() || running) return { ok: false, reason: 'disabled or already running' }
  stopFlag = false
  running = true
  // drop pending updates so old messages don't replay
  try { const r = await tg('getUpdates', { offset: -1, timeout: 0 }); if (r.ok && r.result?.length) offset = r.result[r.result.length - 1].update_id + 1 } catch {}
  poll()
  console.log('[telegram] Jarvis bot polling started')
  return { ok: true }
}

async function stop() {
  stopFlag = true
  running = false
}

function status() {
  return { enabled: tgEnabled(), connected: running }
}

module.exports = { start, stop, status }

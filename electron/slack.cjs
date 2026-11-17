// Slack bridge — Jarvis as a Slack bot over Socket Mode (no public URL needed).
const { getStore } = require('./store.cjs')
const assistant = require('./assistant.cjs')

const store = getStore()
let app = null
let started = false

function slackEnabled() {
  const s = store.state.settings
  const bot = s.slackBotToken || process.env.SLACK_BOT_TOKEN || ''
  const appTok = s.slackAppToken || process.env.SLACK_APP_TOKEN || ''
  return (s.slackEnabled || (bot && appTok)) && bot && appTok
}

async function start() {
  if (!slackEnabled() || started) return { ok: false, reason: 'disabled or already running' }
  try {
    const { App } = require('@slack/bolt')
    app = new App({
      token: store.state.settings.slackBotToken || process.env.SLACK_BOT_TOKEN,
      appToken: store.state.settings.slackAppToken || process.env.SLACK_APP_TOKEN,
      socketMode: true,
    })

    // @jarvis mentions in channels
    app.event('app_mention', async ({ event, say }) => {
      console.log('[slack] app_mention:', (event.text || '').slice(0, 80))
      const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim()
      try { await replyViaSlack(text, say, event) }
      catch (e) { console.error('[slack] mention handler error:', e.message); await say('Sorry, something went wrong.').catch(() => {}) }
    })

    // DMs to the bot
    app.event('message', async ({ event, say }) => {
      if (event.channel_type !== 'im' || event.bot_id || event.subtype) return
      console.log('[slack] DM:', (event.text || '').slice(0, 80))
      try { await replyViaSlack(event.text || '', say, event) }
      catch (e) { console.error('[slack] dm handler error:', e.message); await say('Sorry, something went wrong.').catch(() => {}) }
    })

    await app.start()
    started = true
    console.log('[slack] Jarvis connected via Socket Mode')
    return { ok: true }
  } catch (e) {
    console.error('[slack] failed to start:', e.message)
    return { ok: false, reason: e.message }
  }
}

async function replyViaSlack(text, say, event) {
  // mark the message as seen, then answer
  if (event && app?.client) {
    app.client.reactions.add({ channel: event.channel, timestamp: event.ts, name: 'eyes' }).catch(() => {})
  }
  const reply = await assistant.handleMessage(text, 'slack')
  if (reply) {
    await say({ text: reply, mrkdwn: true })
    if (event && app?.client) {
      app.client.reactions.add({ channel: event.channel, timestamp: event.ts, name: 'white_check_mark' }).catch(() => {})
    }
  }
}

async function stop() {
  if (app) { try { await app.stop() } catch {} app = null }
  started = false
}

function status() {
  return { enabled: slackEnabled(), connected: started }
}

module.exports = { start, stop, status }

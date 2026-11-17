// JSON-file backed store for users, channels, messages, settings.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app } = require('electron')

const uid = () => crypto.randomUUID()

function seedState() {
  const users = [
    { id: 'you', name: 'you', displayName: 'You', color: '#4f8cff', bot: false },
    { id: 'jarvis', name: 'jarvis', displayName: 'Jarvis', color: '#f0b429', bot: true },
  ]
  const channels = [
    { id: 'd-jarvis', name: 'Jarvis', type: 'dm', dmUserId: 'jarvis' },
  ]
  const now = Date.now()
  const msg = (channelId, userId, text, minsAgo = 0) => ({
    id: uid(), channelId, userId, text, ts: now - minsAgo * 60000, reactions: {}
  })
  const messages = {
    'd-jarvis': [
      msg('d-jarvis', 'jarvis', 'Systems online. I am Jarvis — your desktop and Slack assistant.\n\nType `/help` for commands, or just talk to me. When you are away from your PC, message me on Slack.', 10080),
    ],
  }
  return {
    users,
    channels,
    messages,
    settings: {
      llmBaseUrl: 'https://integrate.api.nvidia.com/v1',
      llmApiKey: '',
      llmModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      visionModel: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
      demoActivity: true,
      voiceOutput: false,
      defaultBrowser: '',
      slackBotToken: '',
      slackAppToken: '',
      slackEnabled: false,
      mobileToken: require('crypto').randomUUID(),
    },
  }
}

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'jarvis-assistant.json')
    this.listeners = new Set()
    this.state = this.load()
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return { ...seedState(), ...raw, settings: { ...seedState().settings, ...(raw.settings || {}) } }
    } catch {
      return seedState()
    }
  }

  save() {
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2))
    fs.renameSync(tmp, this.file)
  }

  onUpdate(fn) { this.listeners.add(fn) }
  emit(what) {
    const snapshot = this.snapshot()
    for (const fn of this.listeners) fn(snapshot, what)
  }

  snapshot() {
    const { users, channels, messages, settings } = this.state
    const capped = {}
    for (const [cid, list] of Object.entries(messages)) capped[cid] = list.slice(-200)
    return { users, channels, messages: capped, settings }
  }

  addMessage(channelId, userId, text, meta = {}) {
    const m = { id: uid(), channelId, userId, text, ts: Date.now(), reactions: {}, ...meta }
    ;(this.state.messages[channelId] ||= []).push(m)
    this.save()
    this.emit('message')
    return m
  }

  createChannel(name) {
    const ch = { id: 'c-' + uid().slice(0, 8), name: name.toLowerCase().replace(/\s+/g, '-'), type: 'channel', topic: '' }
    this.state.channels.push(ch)
    this.state.messages[ch.id] = []
    this.save(); this.emit('channel')
    return ch
  }

  openDM(userId) {
    let ch = this.state.channels.find(c => c.type === 'dm' && c.dmUserId === userId)
    if (!ch) {
      const u = this.state.users.find(x => x.id === userId)
      ch = { id: 'd-' + uid().slice(0, 8), name: u ? u.displayName : userId, type: 'dm', dmUserId: userId }
      this.state.channels.push(ch)
      this.state.messages[ch.id] = []
      this.save(); this.emit('channel')
    }
    return ch
  }

  toggleReaction(messageId, channelId, emoji, userId = 'you') {
    const list = this.state.messages[channelId] || []
    const m = list.find(x => x.id === messageId)
    if (!m) return
    m.reactions ||= {}
    m.reactions[emoji] ||= []
    const i = m.reactions[emoji].indexOf(userId)
    if (i >= 0) m.reactions[emoji].splice(i, 1)
    else m.reactions[emoji].push(userId)
    if (!m.reactions[emoji].length) delete m.reactions[emoji]
    this.save(); this.emit('reaction')
  }

  search(q) {
    const needle = q.toLowerCase()
    const out = []
    for (const [cid, list] of Object.entries(this.state.messages)) {
      for (const m of list) {
        if (m.text.toLowerCase().includes(needle)) out.push({ ...m, channelId: cid })
      }
    }
    return out.slice(-100).reverse()
  }
}

let instance = null
function getStore() {
  if (!instance) instance = new Store()
  return instance
}
module.exports = { getStore, uid }

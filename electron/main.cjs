require('./env.cjs')
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { getStore } = require('./store.cjs')
const assistant = require('./assistant.cjs')
const slack = require('./slack.cjs')
const mobile = require('./mobile.cjs')

const store = getStore()
let win = null
let autoUpdater = null
try { ({ autoUpdater } = require('electron-updater')) } catch {}

function createWindow() {
  win = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 560,
    minHeight: 480,
    frame: false,
    thickFrame: true,
    backgroundColor: '#17191d',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
  // self-heal: auto-reload if renderer crashes
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[crash] renderer gone:', details.reason)
    if (details.reason !== 'clean-exit') setTimeout(() => { if (win && !win.isDestroyed()) win.reload() }, 800)
  })
  win.webContents.on('unresponsive', () => console.warn('[crash] renderer unresponsive'))
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    win.loadURL(devUrl).catch(() => win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')))
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function push(what) {
  if (win && !win.isDestroyed()) win.webContents.send('store:update', what)
}
store.onUpdate(() => push('update'))

// Route assistant-channel messages to Jarvis
async function maybeJarvis(channelId, userId, text, context) {
  if (channelId !== 'd-jarvis' || userId === 'jarvis') return
  pushTyping(channelId)
  const full = context ? `${text}\n\n[Attached file content]\n${context}` : text
  const reply = await assistant.handleMessage(full, 'desktop', { channelId })
  if (reply) store.addMessage('d-jarvis', 'jarvis', reply)
}

function pushTyping(channelId) {
  if (win && !win.isDestroyed()) win.webContents.send('jarvis:typing', channelId)
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.stonic.jarvis')
  createWindow()
  slack.start().then(r => { if (!r.ok && r.reason !== 'disabled or already running') console.warn('[slack]', r.reason) })
  mobile.start()

  ipcMain.handle('store:snapshot', () => store.snapshot())
  ipcMain.handle('channel:create', (_e, name) => store.createChannel(name))
  ipcMain.handle('channel:openDM', (_e, userId) => store.openDM(userId))
  ipcMain.handle('message:send', (_e, payload) => {
    const { channelId, text, context, attachNames } = payload
    const m = store.addMessage(channelId, 'you', text, { context, attachNames })
    maybeJarvis(channelId, 'you', text, context)
    return m
  })
  ipcMain.handle('message:react', (_e, { channelId, messageId, emoji }) =>
    store.toggleReaction(messageId, channelId, emoji))
  ipcMain.handle('search:query', (_e, q) => store.search(q))
  ipcMain.handle('settings:get', () => store.state.settings)
  ipcMain.handle('settings:set', (_e, patch) => {
    store.state.settings = { ...store.state.settings, ...patch }
    store.save()
    slack.stop().then(() => slack.start())
    return store.state.settings
  })
  ipcMain.handle('slack:status', () => slack.status())
  ipcMain.handle('memory:get', () => assistant.getMemory())
  ipcMain.handle('jobs:list', () => assistant.getJobs())
  ipcMain.handle('jobs:cancel', (_e, id) => assistant.cancelJob(id))
  ipcMain.handle('vault:list', () => assistant.vaultList())
  ipcMain.handle('voice:stt', async (_e, audioB64, mime) => require('./python.cjs').call('/stt', { audio: audioB64, mime }))
  ipcMain.handle('voice:tts', async (_e, text) => require('./python.cjs').call('/tts', { text }))
  ipcMain.handle('activity:get', () => assistant.getActivity())
  ipcMain.handle('locations:list', () => assistant.getLocations())
  ipcMain.handle('route:get', () => assistant.getRoute())

  // auto-start on Windows login
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      args: app.isPackaged ? [] : [path.join(__dirname, '..')],
    })
  } catch (e) { console.warn('[autostart]', e.message) }
  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('autostart:set', (_e, on) => {
    app.setLoginItemSettings({ openAtLogin: !!on, args: app.isPackaged ? [] : [path.join(__dirname, '..')] })
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('window:minimize', () => win?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.handle('window:close', () => win?.close())
  ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)

  // ---- system metrics (real values only) ----
  let cpuPrev = os.cpus()
  function cpuPct() {
    const now = os.cpus()
    let idle = 0, total = 0
    for (let i = 0; i < now.length; i++) {
      const a = cpuPrev[i].times, b = now[i].times
      const dIdle = b.idle - a.idle
      const dTotal = (b.user - a.user) + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + dIdle
      idle += dIdle; total += dTotal
    }
    cpuPrev = now
    return total > 0 ? Math.round((1 - idle / total) * 100) : 0
  }
  ipcMain.handle('sys:metrics', () => {
    const tm = os.totalmem(), fm = os.freemem()
    let disk = { used: 0, total: 0 }
    try {
      const st = fs.statfsSync(process.env.SystemDrive || 'C:\\')
      const total = st.blocks * st.bsize
      disk = { used: total - st.bavail * st.bsize, total }
    } catch {}
    return { cpu: cpuPct(), mem: { used: tm - fm, total: tm }, disk }
  })

  // ---- notes (Jarvis scratchpad) ----
  ipcMain.handle('notes:list', () => {
    try {
      const f = path.join(app.getPath('userData'), 'jarvis-notes.txt')
      return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).reverse().slice(0, 100)
    } catch { return [] }
  })

  // ---- auto-update (packaged builds only) ----
  ipcMain.handle('update:check', async () => {
    if (!autoUpdater || !app.isPackaged) return { ok: false, reason: 'Auto-update only works in the installed app.' }
    try {
      const r = await autoUpdater.checkForUpdates()
      return { ok: true, updateInfo: r?.updateInfo || null }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  })
  if (autoUpdater && app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.on('update-available', () => console.log('[updater] update available, downloading…'))
    autoUpdater.on('update-downloaded', () => {
      const { dialog } = require('electron')
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update ready',
        message: 'A new version of Jarvis has been downloaded.',
        detail: 'Restart now to install it?',
        buttons: ['Restart & install', 'Later'],
        defaultId: 0,
      }).then(r => { if (r.response === 0) autoUpdater.quitAndInstall() })
    })
    autoUpdater.on('error', e => console.warn('[updater]', e.message))
    autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => { try { require('./python.cjs').shutdown() } catch {} })

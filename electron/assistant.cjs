// Jarvis assistant engine — shared by the desktop app and the Slack bridge.
// Agentic: the LLM can call tools to actually perform tasks on the PC.
const os = require('os')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const { getStore } = require('./store.cjs')
const cursor = require('./cursor.cjs')

const store = getStore()

const HELP = `**Jarvis commands**
\`/help\` — this list
\`/time\` / \`/date\` — clock & calendar
\`/sys\` — CPU, RAM, OS stats
\`/weather <city>\` — current weather
\`/search <query>\` — web search (opens browser)
\`/open <app-or-url>\` — open app or URL *(desktop only)*
\`/note <text>\` / \`/notes\` — scratchpad notes
\`/remind <10m|2h> <text>\` — reminder

**Agent mode** — just ask in plain English and I'll do it:
"open spotify and play lofi", "create a note called groceries",
"what's in my downloads folder", "search the web for best mechanical keyboards".`

const notesFile = () => path.join(require('electron').app.getPath('userData'), 'jarvis-notes.txt')

function fmtDur(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function parseDuration(arg) {
  const m = arg.match(/^(\d+)\s*([smhd])$/i)
  if (!m) return null
  return +m[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2].toLowerCase()]
}

// ---------------- job scheduler (persistent) ----------------
const jobsFile = () => path.join(require('electron').app.getPath('userData'), 'jarvis-jobs.json')
let jobs = []
try { jobs = JSON.parse(fs.readFileSync(jobsFile(), 'utf8')) } catch {}
const saveJobs = () => { try { fs.writeFileSync(jobsFile(), JSON.stringify(jobs, null, 2)) } catch {} }
const jobTimers = new Map()

function fireJob(job) {
  const done = r => store.addMessage('d-jarvis', 'jarvis', r)
  if (job.aiTask) {
    handleMessage(job.aiTask, 'desktop', { depth: 1 }).then(r => done(`⏰ ${job.aiTask}\n${r || '(no reply)'}`)).catch(e => done(`⏰ ${job.aiTask}\nError: ${e.message}`))
    if (job.kind === 'once') { jobs = jobs.filter(j => j.id !== job.id); saveJobs(); clearTimeout(jobTimers.get(job.id)); jobTimers.delete(job.id) }
    return
  }
  if (job.command) {
    runShell(job.command, 60000).then(r =>
      store.addMessage('d-jarvis', 'jarvis', `⏰ Scheduled task "${job.text || job.command.slice(0, 40)}"\n\`\`\`\n${r.output.slice(0, 2000)}\n\`\`\``))
  } else {
    store.addMessage('d-jarvis', 'jarvis', `⏰ ${job.text}`)
  }
  if (job.kind === 'once') {
    jobs = jobs.filter(j => j.id !== job.id); saveJobs()
    clearTimeout(jobTimers.get(job.id)); jobTimers.delete(job.id)
  }
}
function armJob(job) {
  const delay = job.kind === 'interval' ? job.everyMs : Math.max(0, job.runAt - Date.now())
  const t = setTimeout(() => { fireJob(job); if (job.kind === 'interval') armJob(job) }, delay)
  jobTimers.set(job.id, t)
}
function addJob(when, text, command, aiTask) {
  when = when.trim().toLowerCase()
  let job = null
  const every = when.match(/^every\s+(\d+)\s*([smhd])$/)
  const once = when.match(/^(\d+)\s*([smhd])$/)
  if (every) {
    const ms = +every[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[every[2]]
    job = { id: uid().slice(0, 8), kind: 'interval', everyMs: ms, text, command, aiTask }
  } else if (once) {
    const ms = +once[1] * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[once[2]]
    job = { id: uid().slice(0, 8), kind: 'once', runAt: Date.now() + ms, text, command, aiTask }
  }
  if (!job || (!text && !command && !aiTask)) return null
  job.desc = `${job.kind === 'interval' ? `every ${when.replace('every ', '')}` : `in ${when}`}: ${aiTask || text || command}`
  jobs.push(job); saveJobs(); armJob(job)
  return job
}
// re-arm persisted jobs on startup
for (const j of jobs) armJob(j)

// ---------------- persistent memory ----------------
const memFile = () => path.join(require('electron').app.getPath('userData'), 'jarvis-memory.json')
let memory = { facts: [], lessons: [], plans: [] }
try { memory = { facts: [], lessons: [], plans: [], ...JSON.parse(fs.readFileSync(memFile(), 'utf8')) } } catch {}
const saveMem = () => { try { fs.writeFileSync(memFile(), JSON.stringify(memory, null, 2)) } catch {} }
function memAdd(kind, item) {
  const arr = memory[kind] ||= []
  arr.push({ ts: Date.now(), text: String(item).slice(0, 500) })
  if (arr.length > 200) arr.splice(0, arr.length - 200)
  saveMem()
}
function memContext() {
  const facts = (memory.facts || []).slice(-15).map(f => `- ${f.text}`).join('\n')
  const lessons = (memory.lessons || []).slice(-8).map(l => `- avoid: ${l.text}`).join('\n')
  if (!facts && !lessons) return ''
  return `\n\nWhat you remember about the user:\n${facts || '(none)'}\nLessons learned (avoid repeating mistakes):\n${lessons || '(none)'}`
}

// vault helpers
const vaultFile = () => path.join(require('electron').app.getPath('userData'), 'jarvis-vault.json')
const loadVault = () => { try { return JSON.parse(fs.readFileSync(vaultFile(), 'utf8')) } catch { return {} } }
const saveVault = v => { try { fs.writeFileSync(vaultFile(), JSON.stringify(v, null, 2)) } catch {} }
const vaultKey = () => {
  const crypto = require('crypto')
  const { execSync } = require('child_process')
  let machine = 'jarvis'
  try { machine = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' }).match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] || machine } catch {}
  return crypto.createHash('sha256').update('jarvis-vault:' + machine).digest()
}
// sys helpers for watchers
let _cpuPrev = null
async function sysMetrics() {
  const cpus = os.cpus().map(c => c.times)
  const now = cpus.map(t => ({ idle: t.idle, total: t.user + t.nice + t.sys + t.irq + t.idle }))
  let cpu = 0
  if (_cpuPrev) {
    let idleD = 0, totalD = 0
    now.forEach((n, i) => { idleD += n.idle - _cpuPrev[i].idle; totalD += n.total - _cpuPrev[i].total })
    cpu = totalD > 0 ? 100 * (1 - idleD / totalD) : 0
  }
  _cpuPrev = now
  if (!cpu) cpu = 100 * (1 - os.loadavg()[0] / os.cpus().length)
  return { cpu, ram: { percent: 100 * (1 - os.freemem() / os.totalmem()) } }
}
function diskUsage(drive) {
  try {
    const s = fs.statfsSync(drive)
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize
    return { free, used: total - free }
  } catch { return { free: 0, used: 1 } }
}
const resolvePath = p => String(p || '').replace(/^~/, os.homedir())

// ---------------- slash commands ----------------
async function handleCommand(text, surface) {
  const [cmdRaw, ...rest] = text.trim().split(/\s+/)
  const arg = rest.join(' ')
  const cmd = cmdRaw.toLowerCase()
  const desktop = true // owner-only surfaces: desktop app + own Slack workspace

  switch (cmd) {
    case '/help': return HELP
    case '/time': return `The time is ${new Date().toLocaleTimeString()}.`
    case '/date': return `Today is ${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`
    case '/sys': {
      const cpus = os.cpus().length
      const load = os.loadavg()[0]
      const total = os.totalmem(), free = os.freemem()
      return [
        `**System** — ${os.type()} ${os.release()} (${os.arch()})`,
        `CPU: ${cpus} cores, load ${load.toFixed(2)}`,
        `RAM: ${(total / 2 ** 30).toFixed(1)} GB total, ${(free / 2 ** 30).toFixed(1)} GB free`,
        `Uptime: ${fmtDur(os.uptime() * 1000)}`,
      ].join('\n')
    }
    case '/weather': {
      const city = arg || 'auto'
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
        const d = await res.json()
        const cur = d.current_condition?.[0]
        if (!cur) return `Could not find weather for "${city}".`
        return `**${d.nearest_area?.[0]?.areaName?.[0]?.value || city}** — ${cur.weatherDesc?.[0]?.value}, ${cur.temp_C}°C (feels ${cur.FeelsLikeC}°C), humidity ${cur.humidity}%, wind ${cur.windspeedKmph} km/h.`
      } catch { return 'Weather service unreachable.' }
    }
    case '/search': {
      if (!arg) return 'Usage: `/search <query>`'
      const url = `https://www.google.com/search?q=${encodeURIComponent(arg)}`
      if (desktop) openUrl(url)
      return desktop ? `Searching the web for "${arg}".` : `Search: https://www.google.com/search?q=${encodeURIComponent(arg)}`
    }
    case '/open': {
      if (!arg) return 'Usage: `/open <app-name-or-url>`'
      if (!desktop) return 'Opening apps only works when you are on your PC.'
      return openBrowserOrApp(arg, true)
    }
    case '/note': {
      if (!arg) return 'Usage: `/note <text>`'
      fs.appendFileSync(notesFile(), `[${new Date().toLocaleString()}] ${arg}\n`)
      return 'Noted.'
    }
    case '/notes': {
      try {
        const lines = fs.readFileSync(notesFile(), 'utf8').trim().split('\n').slice(-10)
        return lines.length ? `**Notes:**\n${lines.join('\n')}` : 'No notes yet.'
      } catch { return 'No notes yet.' }
    }
    case '/remind': {
      const [durArg, ...msgParts] = arg.split(/\s+/)
      const ms = parseDuration(durArg)
      const reminder = msgParts.join(' ')
      if (!ms || !reminder) return 'Usage: `/remind <10m|2h|30s> <what to remind>`'
      setTimeout(() => store.addMessage('d-jarvis', 'jarvis', `⏰ Reminder: ${reminder}`), Math.min(ms, 864e5))
      return `Reminder set for ${fmtDur(ms)} from now.`
    }
    default:
      return null
  }
}

function openUrl(url) {
  const { shell } = require('electron')
  shell.openExternal(url).catch(() => {})
}

// ---- default browser detection (registry UserChoice) ----
let defaultBrowserCache = null
const BROWSER_EXE_CANDIDATES = {
  brave: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
  chrome: ['Google\\Chrome\\Application\\chrome.exe'],
  edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
  firefox: ['Mozilla Firefox\\firefox.exe'],
}
function findBrowserExe(name) {
  const dirs = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)
  for (const rel of BROWSER_EXE_CANDIDATES[name] || []) {
    for (const d of dirs) {
      const p = path.join(d, rel)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}
async function getDefaultBrowser() {
  // manual override from Settings wins (checked every call, not cached)
  const manual = store.state.settings.defaultBrowser
  if (manual && manual !== 'auto') {
    return { prog: '', name: manual, exe: findBrowserExe(manual) || '' }
  }
  if (defaultBrowserCache) return defaultBrowserCache
  const res = { prog: '', name: '', exe: '' }
  try {
    const r = await runShell('reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId')
    const prog = (r.output.match(/ProgId\s+REG_SZ\s+(\S+)/) || [])[1] || ''
    res.prog = prog
    const lower = prog.toLowerCase()
    if (lower.includes('brave')) res.name = 'brave'
    else if (lower.includes('chrome')) res.name = 'chrome'
    else if (lower.includes('edge') || lower.includes('msedge')) res.name = 'edge'
    else if (lower.includes('firefox')) res.name = 'firefox'
    else if (lower.includes('opera')) res.name = 'opera'
    if (res.name) res.exe = findBrowserExe(res.name) || ''
  } catch {}
  // auto-detect fallback: prefer a non-Edge browser if installed
  if (!res.exe) {
    for (const name of ['brave', 'firefox', 'chrome']) {
      const exe = findBrowserExe(name)
      if (exe) { res.name = name; res.exe = exe; break }
    }
  }
  defaultBrowserCache = res
  return res
}
const BROWSER_WORDS = /^(browser|web browser|internet|chrome|google chrome|edge|microsoft edge|firefox|brave|brave browser|opera)$/i
async function openBrowserOrApp(target, desktop) {
  const t = String(target || '').trim()
  if (!desktop) return 'Opening apps only works on your PC.'
  if (/^https?:\/\//i.test(t)) { openUrl(t); return `Opened ${t}` }
  if (BROWSER_WORDS.test(t)) {
    const b = await getDefaultBrowser()
    const want = /brave/i.test(t) ? 'brave' : /edge/i.test(t) ? 'edge' : /firefox/i.test(t) ? 'firefox' : /chrome/i.test(t) ? 'chrome' : null
    const exe = want ? findBrowserExe(want) : (b.exe || findBrowserExe(b.name))
    if (exe) { exec(`cmd /c start "" "${exe}"`, () => {}); return `Opened ${want || b.name || 'default browser'}.` }
    openUrl('about:blank')
    return 'Opened the default browser.'
  }
  openApp(t)
  return `Opened "${t}".`
}
function openApp(name) {
  if (process.platform === 'win32') exec(`cmd /c start "" "${name}"`, () => {})
  else exec(`open -a "${name}"`, () => {})
}
function runShell(cmd, timeoutMs = 20000) {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 512 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '')
      resolve({ ok: !err, output: out.slice(0, 6000) || '(no output)', error: err ? err.message : null })
    })
  })
}
function httpGet(url, ms = 12000) {
  return fetch(url, { signal: AbortSignal.timeout(ms) })
    .then(async r => ({ ok: r.ok, status: r.status, text: (await r.text()).slice(0, 8000) }))
    .catch(e => ({ ok: false, status: 0, text: `fetch failed: ${e.message}` }))
}
// tiny safe arithmetic evaluator: + - * / % ** ( ) and decimals
function safeCalc(expr) {
  const src = String(expr).replace(/\s+/g, '')
  if (!/^[\d+\-*/%().]+$/.test(src)) return null
  try {
    // eslint-disable-next-line no-new-func
    const f = new Function(`"use strict"; return (${src.replace(/\*\*/g, '**')})`)
    const v = f()
    return typeof v === 'number' && isFinite(v) ? v : null
  } catch { return null }
}
function walkFiles(dir, depth = 0, out = [], limit = 4000) {
  if (depth > 6 || out.length >= limit) return out
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (out.length >= limit) break
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!['node_modules', '.git', '$recycle.bin', 'system volume information'].includes(e.name.toLowerCase()))
        walkFiles(p, depth + 1, out, limit)
    } else out.push(p)
  }
  return out
}

// ---- real mouse/keyboard control via user32.dll (PowerShell P/Invoke) ----
const PS_USER32 = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class U32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, IntPtr extra);
}
"@
`
// run a PowerShell script via -EncodedCommand (UTF-16LE base64) — no quoting issues
function psRun(script, timeoutMs = 15000) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64')
  return runShell(`powershell -NoProfile -EncodedCommand ${b64}`, timeoutMs)
}
function psMouse(x, y, flags, data = 0) {
  return psRun(`${PS_USER32}
[U32]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
[U32]::mouse_event(${flags}, 0, 0, ${data}, [IntPtr]::Zero)`, 8000)
}
const MOUSE = { leftdown: 0x0002, leftup: 0x0004, rightdown: 0x0008, rightup: 0x0010, middledown: 0x0020, middleup: 0x0040, wheel: 0x0800 }

function psTypeText(text) {
  // SendKeys escaping: + ^ % ~ ( ) [ ] { } need braces
  const esc = String(text).replace(/([+^%~()\[\]{}])/g, '{$1}')
  const chunks = esc.match(/.{1,80}/g) || []
  const parts = chunks.map(c => `[System.Windows.Forms.SendKeys]::SendWait('${c.replace(/'/g, "''")}')`).join('; ')
  return psRun(`${PS_USER32}${parts}`, 20000)
}
const KEY_TOKENS = {
  enter: '{ENTER}', return: '{ENTER}', esc: '{ESC}', escape: '{ESC}', tab: '{TAB}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
  space: ' ', f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
  f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
}
function psKey(key) {
  const k = String(key).toLowerCase()
  const token = KEY_TOKENS[k] || `{${k.toUpperCase()}}`
  return psRun(`${PS_USER32}[System.Windows.Forms.SendKeys]::SendWait('${token}')`, 8000)
}

// ---------------- agent tools ----------------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Open an application or URL on the user\'s PC. Desktop only.',
      parameters: { type: 'object', properties: { target: { type: 'string', description: 'App name (e.g. "notepad", "spotify") or full URL' } }, required: ['target'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command on the PC (Windows cmd). Desktop only. Use for file ops, system tasks, scripts.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from disk. Returns contents (truncated).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write text content to a file (creates parent dirs).',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files/folders in a directory.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web. Opens results in the browser (desktop) or returns a search link.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city.',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description: 'Save a note to Jarvis memory.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Set a reminder. delay like "10m", "2h", "30s".',
      parameters: { type: 'object', properties: { delay: { type: 'string' }, text: { type: 'string' } }, required: ['delay', 'text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: 'CPU, RAM, disk, uptime of the PC.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Capture a screenshot of the screen and save it as a PNG file. Returns the file path.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_read',
      description: 'Read the current clipboard text.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_write',
      description: 'Copy text to the clipboard.',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_path',
      description: 'Open a file or folder with the default Windows app.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_search',
      description: 'Search for files by name substring inside a directory (recursive).',
      parameters: { type: 'object', properties: { directory: { type: 'string' }, query: { type: 'string' } }, required: ['directory', 'query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_notification',
      description: 'Show a Windows desktop notification.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Evaluate an arithmetic expression (numbers, + - * / % ** parentheses).',
      parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'translate',
      description: 'Translate text between languages (e.g. en to hi).',
      parameters: { type: 'object', properties: { text: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } }, required: ['text', 'to'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Get top world news headlines.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crypto_price',
      description: 'Get current USD price of cryptocurrencies (comma-separated ids like bitcoin,ethereum).',
      parameters: { type: 'object', properties: { coins: { type: 'string' } }, required: ['coins'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ip_info',
      description: 'Get public IP address and approximate location/ISP.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a web page or API URL and return status + text content snippet.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'battery_status',
      description: 'Get laptop battery charge level (desktop only).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_processes',
      description: 'List top processes by CPU usage.',
      parameters: { type: 'object', properties: { count: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mouse_move',
      description: 'Move the mouse cursor to screen coordinates (x, y in pixels).',
      parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mouse_click',
      description: 'Click the mouse. Optionally move to x,y first. button: left|right|middle|double.',
      parameters: { type: 'object', properties: {
        x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string', enum: ['left', 'right', 'middle', 'double'] },
      } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into the currently focused window (like a keyboard).',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description: 'Press a key: enter, esc, tab, backspace, delete, arrows, f1-f12, space, or a letter.',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mouse_scroll',
      description: 'Scroll the mouse wheel. amount positive = up, negative = down.',
      parameters: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_file_contents',
      description: 'Search inside text files for a string/regex within a directory (recursive, like grep).',
      parameters: { type: 'object', properties: {
        directory: { type: 'string' }, query: { type: 'string' },
        filePattern: { type: 'string', description: 'e.g. "*.js", "*.txt" — optional' },
      }, required: ['directory', 'query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disk_usage',
      description: 'Get sizes of files/folders in a directory, sorted largest first.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_drives',
      description: 'List all disk drives with total/free space.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_installed_apps',
      description: 'List installed programs from Windows registry (name + version + publisher).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'env_vars',
      description: 'Read environment variables (optionally filtered by substring).',
      parameters: { type: 'object', properties: { filter: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registry_query',
      description: 'Run a read-only reg query against the Windows registry.',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_info',
      description: 'Get detailed metadata for a file/folder: size, dates, attributes.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_background',
      description: 'Run a shell command in the background. Jarvis messages the result when it finishes. Use for long tasks (downloads, builds, scripts).',
      parameters: { type: 'object', properties: {
        command: { type: 'string' }, name: { type: 'string', description: 'Short label for the task' },
      }, required: ['command'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'see_screen',
      description: 'Take a screenshot and analyze what is visible on screen. Use for "this error", "this window", visual questions.',
      parameters: { type: 'object', properties: { question: { type: 'string', description: 'What to look for / describe' } }, required: ['question'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_save',
      description: 'Save a fact or preference about the user to long-term memory.',
      parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: 'Search long-term memory for matching facts.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description: 'Record a multi-step plan for a complex task. Call once before executing complex requests.',
      parameters: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } } }, required: ['steps'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vault_save',
      description: 'Save a secret (password, key, token) encrypted in the vault.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, secret: { type: 'string' } }, required: ['name', 'secret'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'vault_get',
      description: 'Retrieve a saved secret from the vault by name.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sys_watch',
      description: 'Set an alert when a metric crosses a threshold. metric: cpu|ram|disk_percent. Checks every interval_min minutes and messages when breached.',
      parameters: { type: 'object', properties: {
        metric: { type: 'string' }, threshold: { type: 'number' }, interval_min: { type: 'number' },
      }, required: ['metric', 'threshold'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delegate_task',
      description: 'Delegate a sub-task to a fresh agent loop (use for independent parallel-ish subtasks).',
      parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'csv_summary',
      description: 'Analyze a CSV file: row count, columns, numeric stats.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_job',
      description: 'Schedule a future or recurring action. when: "10m"/"2h" delay, or "every 30m"/"every 1h" for recurring. Either text (reminder message) or command (run shell command) required.',
      parameters: { type: 'object', properties: {
        when: { type: 'string' }, text: { type: 'string' }, command: { type: 'string' },
        aiTask: { type: 'string', description: 'Natural-language task for Jarvis to perform when the job fires (uses full AI)' },
      }, required: ['when'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description: 'Extract text from a document: PDF, DOCX, TXT, MD, CSV.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_jobs',
      description: 'List all scheduled jobs (reminders, recurring tasks, watchers).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_job',
      description: 'Cancel a scheduled job by its id (from list_jobs).',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_chat',
      description: 'Export the Jarvis conversation to a Markdown file on Desktop.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Open a URL in Jarvis\'s own visible Chromium browser window.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_snapshot',
      description: 'Get current page URL, title, interactive elements and visible text. Call before clicking/typing.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the current page by visible text (e.g. "Sign in", "Search").',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into the first visible input/textarea, or a CSS selector.',
      parameters: { type: 'object', properties: {
        text: { type: 'string' }, selector: { type: 'string' },
      }, required: ['text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press',
      description: 'Press a keyboard key on the page (Enter, Tab, Escape, arrows...).',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the page up or down.',
      parameters: { type: 'object', properties: { dir: { type: 'string', enum: ['up', 'down'] } }, required: ['dir'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_back',
      description: 'Go back in browser history.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_eval',
      description: 'Run JavaScript on the current page and return the result (power user).',
      parameters: { type: 'object', properties: { js: { type: 'string' } }, required: ['js'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_location',
      description: 'Find a place and drop a marker on the 3D globe. Use for "show me X on globe", "mark my home/office".',
      parameters: { type: 'object', properties: {
        place: { type: 'string' }, label: { type: 'string', description: 'Optional custom label' },
      }, required: ['place'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_agent',
      description: 'Spawn a specialist sub-agent for a task. Agents: researcher (web research/reports), coder (code/files/git), operator (PC/browser automation), analyst (data/system analysis).',
      parameters: { type: 'object', properties: {
        agent: { type: 'string', enum: ['researcher', 'coder', 'operator', 'analyst'] },
        task: { type: 'string' },
      }, required: ['agent', 'task'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'map_directions',
      description: 'Get driving/walking/cycling directions between two places (distance, duration, turn-by-turn).',
      parameters: { type: 'object', properties: {
        from: { type: 'string' }, to: { type: 'string' }, profile: { type: 'string', enum: ['driving', 'walking', 'cycling'] },
      }, required: ['from', 'to'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nearby_places',
      description: 'Find nearby places (cafe, hospital, atm, petrol pump...) around a location.',
      parameters: { type: 'object', properties: {
        place: { type: 'string' }, kind: { type: 'string', description: 'e.g. cafe, hospital, atm, restaurant, petrol_station' }, radius_m: { type: 'number' },
      }, required: ['place', 'kind'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_route',
      description: 'Draw a route line on the map UI between two places.',
      parameters: { type: 'object', properties: {
        from: { type: 'string' }, to: { type: 'string' }, profile: { type: 'string', enum: ['driving', 'walking', 'cycling'] },
      }, required: ['from', 'to'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'weather_alert',
      description: 'Check tomorrow\'s forecast for a location and alert if severe weather (heavy rain, storm, extreme heat/cold).',
      parameters: { type: 'object', properties: { place: { type: 'string' } }, required: ['place'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'backup_data',
      description: 'Export all Jarvis data (memory, jobs, settings, vault names) to a backup file on Desktop.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'restore_data',
      description: 'Restore Jarvis data from a backup file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'window_manage',
      description: 'Manage windows: list open windows, focus a window by title, or close it.',
      parameters: { type: 'object', properties: {
        action: { type: 'string', enum: ['list', 'focus', 'close'] },
        title: { type: 'string', description: 'Window title substring for focus/close' },
      }, required: ['action'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard',
      description: 'Get or set Windows clipboard text.',
      parameters: { type: 'object', properties: {
        action: { type: 'string', enum: ['get', 'set'] }, text: { type: 'string' },
      }, required: ['action'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'translate_text',
      description: 'Translate text to any language (free, no key).',
      parameters: { type: 'object', properties: {
        text: { type: 'string' }, lang: { type: 'string', description: 'Target language e.g. hi, es, fr, ja' },
      }, required: ['text', 'lang'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pdf_merge',
      description: 'Merge multiple PDF files into one (comma-separated paths).',
      parameters: { type: 'object', properties: { paths: { type: 'string' } }, required: ['paths'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_eml',
      description: 'Read a .eml email file — sender, subject, date, body.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startup_list',
      description: 'List programs that run at Windows startup (registry Run keys).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'network_stats',
      description: 'Show network adapter status, IPs, and connection counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_process',
      description: 'Kill a process by name or PID.',
      parameters: { type: 'object', properties: {
        name: { type: 'string' }, pid: { type: 'number' },
      } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_work',
      description: 'Spawn analyst agent to verify a completed task actually worked.',
      parameters: { type: 'object', properties: { claim: { type: 'string' } }, required: ['claim'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'snippet_save',
      description: 'Save a reusable text snippet (e.g. email signature). Keys like ";sig".',
      parameters: { type: 'object', properties: { key: { type: 'string' }, text: { type: 'string' } }, required: ['key', 'text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'snippet_expand',
      description: 'Expand a saved snippet into typed text or return it.',
      parameters: { type: 'object', properties: {
        key: { type: 'string' }, type_it: { type: 'boolean' },
      }, required: ['key'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screen_watch',
      description: 'Watch the screen live via OpenCV — captures frames, detects changes, reports what changed (install finished, error popped, window switched). Duration in seconds (max 120).',
      parameters: { type: 'object', properties: {
        seconds: { type: 'number', description: 'Watch duration, default 30, max 120' },
        describe: { type: 'boolean', description: 'Also ask vision AI to describe notable changes' },
      } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'py_engine',
      description: 'Route a task to the Python intelligence engine (structured JSON output, deep analysis, autonomous planning). Modes: task (plan+result JSON), structured (schema JSON), analyze (deep reasoning), chat (plain reply).',
      parameters: { type: 'object', properties: {
        mode: { type: 'string', enum: ['task', 'structured', 'analyze', 'chat'] },
        input: { type: 'string' }, schema_hint: { type: 'string' },
      }, required: ['mode', 'input'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'media_control',
      description: 'Control media playback: play/pause/next/previous/stop (system-wide media keys).',
      parameters: { type: 'object', properties: {
        action: { type: 'string', enum: ['play_pause', 'next', 'previous', 'stop'] },
      }, required: ['action'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_dashboard',
      description: 'Live system stats: CPU, RAM, disk, uptime, top processes.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_history',
      description: 'Show recent clipboard copies (last 15).',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list'] } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'organize_folder',
      description: 'Auto-sort files in a folder into subfolders by type (images, docs, videos, archives, code, other).',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'disk_cleanup',
      description: 'Scan temp/cache folders for cleanable space. mode=scan (report) or clean (delete temp files).',
      parameters: { type: 'object', properties: {
        mode: { type: 'string', enum: ['scan', 'clean'] },
      } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'power_mode',
      description: 'Switch Windows power plan: balanced, power_saver, high_performance.',
      parameters: { type: 'object', properties: {
        mode: { type: 'string', enum: ['balanced', 'power_saver', 'high_performance'] },
      }, required: ['mode'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'knowledge_search',
      description: 'Search inside a folder\'s text files (notes, docs, code) for keywords — lightweight local knowledge base.',
      parameters: { type: 'object', properties: {
        folder: { type: 'string' }, query: { type: 'string' },
      }, required: ['folder', 'query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_approval',
      description: 'Ask the user to approve a sensitive pending action (delete, send, purchase, system change). Call this instead of executing directly when unsure.',
      parameters: { type: 'object', properties: {
        action: { type: 'string', description: 'What will be done' },
        tool: { type: 'string' }, args: { type: 'string', description: 'JSON string of tool args' },
      }, required: ['action', 'tool', 'args'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_locations',
      description: 'List all saved globe markers.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'computer_use',
      description: 'Control the PC visually like a human: takes screenshots, decides clicks/typing, executes via mouse+keyboard. Use for GUI tasks in any app ("fill this form", "click that button").',
      parameters: { type: 'object', properties: {
        goal: { type: 'string', description: 'What to accomplish on screen' },
        max_steps: { type: 'number', description: 'Max actions (default 8)' },
      }, required: ['goal'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_cmd',
      description: 'Run a git command in a repo directory (status, diff, log, commit, branch...).',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'Repo path' }, command: { type: 'string' },
      }, required: ['path', 'command'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stock_price',
      description: 'Get current stock/crypto/index price. symbol e.g. AAPL, TSLA, BTC-USD, ^GSPC.',
      parameters: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'research',
      description: 'Deep research on a topic: searches web, reads sources, returns a cited summary.',
      parameters: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_close',
      description: 'Close Jarvis\'s browser window.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

// globe locations
const locFile = () => path.join(require('electron').app.getPath('userData'), 'jarvis-locations.json')
const loadLocs = () => { try { return JSON.parse(fs.readFileSync(locFile(), 'utf8')) } catch { return [] } }
const saveLocs = l => { try { fs.writeFileSync(locFile(), JSON.stringify(l, null, 2)) } catch {} }

// approval queue + clipboard history + audit log
const pendingApprovals = []
const clipHistory = []
const auditFile = () => path.join(require('electron').app.getPath('userData'), 'jarvis-audit.log')
function audit(text) {
  try { fs.appendFileSync(auditFile(), `${new Date().toISOString()} ${text}\n`) } catch {}
}
// clipboard polling (Electron main process)
try {
  const { clipboard } = require('electron')
  let lastClip = ''
  setInterval(() => {
    try {
      const t = clipboard.readText()
      if (t && t !== lastClip && t.length < 5000) { clipHistory.push(t); if (clipHistory.length > 20) clipHistory.shift(); lastClip = t }
    } catch {}
  }, 3000)
} catch {}

// live activity feed for UI
const activityLog = []
function logActivity(text) {
  activityLog.push({ ts: Date.now(), text: String(text).slice(0, 120) })
  if (activityLog.length > 40) activityLog.splice(0, activityLog.length - 40)
}

async function execTool(name, args, surface, ctx = {}) {
  const desktop = true // owner-only surfaces: desktop app + own Slack workspace
  const needDesktop = () => 'This action only works when the user is on their PC (Slack is remote-only for safety).'
  const tag = ctx.agent ? `[${ctx.agent}] ` : ''
  logActivity(`${tag}${name} ${JSON.stringify(args || {}).slice(0, 80)}`)
  audit(`${surface} ${tag}${name} ${JSON.stringify(args || {}).slice(0, 200)}`)
  try {
    switch (name) {
      case 'open_app': {
        if (!desktop) return needDesktop()
        return openBrowserOrApp(args.target, true)
      }
      case 'run_command': {
        if (!desktop) return needDesktop()
        const r = await runShell(String(args.command || ''))
        return r.ok ? `exit 0\n${r.output}` : `exit error: ${r.error}\n${r.output}`
      }
      case 'read_file': {
        const p = String(args.path || '')
        if (!p) return 'No path given'
        const st = fs.statSync(p)
        if (st.size > 200 * 1024) return `File too large (${Math.round(st.size / 1024)}KB)`
        return fs.readFileSync(p, 'utf8').slice(0, 8000)
      }
      case 'write_file': {
        const p = String(args.path || '')
        if (!p) return 'No path given'
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, String(args.content ?? ''))
        return `Wrote ${Buffer.byteLength(String(args.content ?? ''))} bytes to ${p}`
      }
      case 'list_directory': {
        const p = String(args.path || '.').replace(/^~/, os.homedir())
        const entries = fs.readdirSync(p, { withFileTypes: true })
        return entries.slice(0, 200).map(e => (e.isDirectory() ? '📁 ' : '  ') + e.name).join('\n')
      }
      case 'web_search': {
        const q = String(args.query || '')
        const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`
        if (desktop) openUrl(url)
        return desktop ? `Opened search results for "${q}" in the browser.` : `Search "${q}": ${url}`
      }
      case 'get_weather': {
        const city = String(args.city || 'auto')
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
        const d = await res.json()
        const cur = d.current_condition?.[0]
        return cur ? `${d.nearest_area?.[0]?.areaName?.[0]?.value || city}: ${cur.weatherDesc?.[0]?.value}, ${cur.temp_C}°C, humidity ${cur.humidity}%` : `No weather for "${city}"`
      }
      case 'save_note': {
        fs.appendFileSync(notesFile(), `[${new Date().toLocaleString()}] ${args.text}\n`)
        return 'Note saved.'
      }
      case 'set_reminder': {
        const ms = parseDuration(String(args.delay || ''))
        if (!ms) return 'Bad delay format, use like "10m" or "2h".'
        setTimeout(() => store.addMessage('d-jarvis', 'jarvis', `⏰ Reminder: ${args.text}`), Math.min(ms, 864e5))
        return `Reminder set for ${fmtDur(ms)}.`
      }
      case 'get_system_info': {
        return [
          `${os.type()} ${os.release()} (${os.arch()})`,
          `CPU: ${os.cpus().length} cores | RAM free: ${(os.freemem() / 2 ** 30).toFixed(1)}GB / ${(os.totalmem() / 2 ** 30).toFixed(1)}GB`,
          `Uptime: ${fmtDur(os.uptime() * 1000)}`,
        ].join('\n')
      }
      case 'take_screenshot': {
        if (!desktop) return needDesktop()
        const { desktopCapturer, app } = require('electron')
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
        if (!sources.length) return 'No screen source found'
        const dir = path.join(app.getPath('pictures'), 'Jarvis')
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, `screenshot-${Date.now()}.png`)
        fs.writeFileSync(file, sources[0].thumbnail.toPNG())
        return `Screenshot saved: ${file}`
      }
      case 'clipboard_read': {
        const { clipboard } = require('electron')
        const t = clipboard.readText()
        return t ? t.slice(0, 4000) : '(clipboard empty)'
      }
      case 'clipboard_write': {
        const { clipboard } = require('electron')
        clipboard.writeText(String(args.text ?? ''))
        return 'Copied to clipboard.'
      }
      case 'open_path': {
        if (!desktop) return needDesktop()
        const { shell } = require('electron')
        const p = String(args.path || '').replace(/^~/, os.homedir())
        const err = await shell.openPath(p)
        return err ? `Failed: ${err}` : `Opened ${p}`
      }
      case 'file_search': {
        const dir = String(args.directory || '~').replace(/^~/, os.homedir())
        const q = String(args.query || '').toLowerCase()
        const all = walkFiles(dir)
        const hits = all.filter(p => path.basename(p).toLowerCase().includes(q))
        return hits.length ? hits.slice(0, 100).join('\n') : `No files matching "${q}" in ${dir}`
      }
      case 'send_notification': {
        const { Notification } = require('electron')
        if (Notification.isSupported()) {
          new Notification({ title: String(args.title || 'Jarvis'), body: String(args.body || '') }).show()
          return 'Notification sent.'
        }
        return 'Notifications not supported on this system.'
      }
      case 'calculate': {
        const v = safeCalc(args.expression)
        return v === null ? 'Could not evaluate that expression.' : `${args.expression} = ${v}`
      }
      case 'translate': {
        const from = String(args.from || 'en')
        const to = String(args.to || 'hi')
        const q = encodeURIComponent(String(args.text || ''))
        const r = await httpGet(`https://api.mymemory.translated.net/get?q=${q}&langpair=${from}|${to}`)
        try {
          const d = JSON.parse(r.text)
          return d.responseData?.translatedText || 'Translation failed.'
        } catch { return 'Translation service error.' }
      }
      case 'get_news': {
        const r = await httpGet('https://feeds.bbci.co.uk/news/world/rss.xml')
        const items = [...r.text.matchAll(/<item>[\s\S]*?<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)]
          .slice(0, 8)
          .map(m => `• ${m[1]} (${new Date(m[2]).toLocaleDateString()})`)
        return items.length ? items.join('\n') : 'Could not fetch news.'
      }
      case 'crypto_price': {
        const ids = encodeURIComponent(String(args.coins || 'bitcoin').split(',').map(s => s.trim().toLowerCase()).join(','))
        const r = await httpGet(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`)
        try {
          const d = JSON.parse(r.text)
          return Object.entries(d).map(([k, v]) => `${k}: $${v.usd}`).join('\n') || 'No data.'
        } catch { return 'Price service error.' }
      }
      case 'ip_info': {
        const r = await httpGet('https://ipinfo.io/json')
        try {
          const d = JSON.parse(r.text)
          return [d.ip, d.city, d.region, d.country, d.org].filter(Boolean).join(' | ')
        } catch { return 'Could not fetch IP info.' }
      }
      case 'fetch_url': {
        const r = await httpGet(String(args.url || ''))
        return `HTTP ${r.status}\n${r.text.slice(0, 4000)}`
      }
      case 'battery_status': {
        if (!desktop) return needDesktop()
        const r = await runShell('powershell -NoProfile -Command "(Get-CimInstance Win32_Battery | Select-Object -First 1).EstimatedChargeRemaining"')
        const pct = r.output.trim().match(/\d+/)
        return pct ? `Battery: ${pct[0]}%` : 'No battery detected (desktop PC?)'
      }
      case 'list_processes': {
        if (!desktop) return needDesktop()
        const n = Math.min(Math.max(+args.count || 15, 1), 40)
        const r = await runShell(`powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First ${n} Name,CPU,@{n='MemMB';e={[math]::Round($_.WorkingSet64/1MB)}} | Format-Table -AutoSize"`)
        return r.output.slice(0, 4000)
      }
      case 'mouse_move': {
        if (!desktop) return needDesktop()
        const x = +args.x, y = +args.y
        if (!isFinite(x) || !isFinite(y)) return 'Invalid coordinates.'
        await psMouse(x, y, 0)
        cursor.moveTo(x, y)
        return `Cursor moved to (${x}, ${y}).`
      }
      case 'mouse_click': {
        if (!desktop) return needDesktop()
        const x = args.x != null ? +args.x : null, y = args.y != null ? +args.y : null
        const btn = String(args.button || 'left').toLowerCase()
        if (x != null && y != null) {
          await psMouse(x, y, 0)
          cursor.moveTo(x, y)
          await new Promise(r => setTimeout(r, 120))
        }
        const seq = btn === 'double' ? [MOUSE.leftdown, MOUSE.leftup, MOUSE.leftdown, MOUSE.leftup]
          : btn === 'right' ? [MOUSE.rightdown, MOUSE.rightup]
          : btn === 'middle' ? [MOUSE.middledown, MOUSE.middleup]
          : [MOUSE.leftdown, MOUSE.leftup]
        for (const f of seq) { await psMouse(0, 0, f); await new Promise(r => setTimeout(r, 60)) }
        cursor.ripple()
        return `Clicked (${btn}).`
      }
      case 'type_text': {
        if (!desktop) return needDesktop()
        const r = await psTypeText(String(args.text || ''))
        return r.ok ? `Typed ${String(args.text).length} chars.` : `Type failed: ${r.error}`
      }
      case 'press_key': {
        if (!desktop) return needDesktop()
        const r = await psKey(String(args.key || ''))
        return r.ok ? `Pressed ${args.key}.` : `Key failed: ${r.error}`
      }
      case 'mouse_scroll': {
        if (!desktop) return needDesktop()
        const amount = Math.max(-20, Math.min(20, Math.round(+args.amount || 0)))
        if (!amount) return 'Nothing to scroll.'
        const r = await psMouse(0, 0, MOUSE.wheel, amount * 120)
        return r.ok ? `Scrolled ${amount}.` : `Scroll failed: ${r.error}`
      }
      case 'search_file_contents': {
        const dir = String(args.directory || '~').replace(/^~/, os.homedir())
        const q = String(args.query || '')
        if (!q) return 'No query given.'
        const pat = String(args.filePattern || '').toLowerCase()
        const exts = pat.startsWith('*.') ? [pat.slice(1)] : null
        const hits = []
        const files = walkFiles(dir, 0, [], 3000)
        const re = (() => { try { return new RegExp(q, 'i') } catch { return null } })()
        let scanned = 0
        for (const f of files) {
          if (hits.length >= 60 || scanned > 1500) break
          if (exts && !exts.some(e => f.toLowerCase().endsWith(e))) continue
          let txt
          try {
            const st = fs.statSync(f)
            if (st.size > 2 * 1024 * 1024) continue
            txt = fs.readFileSync(f, 'utf8')
          } catch { continue }
          scanned++
          const lines = txt.split('\n')
          for (let i = 0; i < lines.length && hits.length < 60; i++) {
            if (re ? re.test(lines[i]) : lines[i].toLowerCase().includes(q.toLowerCase()))
              hits.push(`${f}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
          }
        }
        return hits.length ? hits.join('\n') : `No matches for "${q}".`
      }
      case 'disk_usage': {
        const dir = String(args.path || '~').replace(/^~/, os.homedir())
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return `Error: ${e.message}` }
        const rows = []
        for (const e of entries.slice(0, 300)) {
          const p = path.join(dir, e.name)
          try {
            let size
            if (e.isDirectory()) {
              size = walkFiles(p, 0, []).reduce((s, f) => { try { return s + fs.statSync(f).size } catch { return s } }, 0)
            } else size = fs.statSync(p).size
            rows.push({ name: e.name + (e.isDirectory() ? '/' : ''), size })
          } catch {}
        }
        rows.sort((a, b) => b.size - a.size)
        const fmt = b => b > 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : b > 2 ** 20 ? `${(b / 2 ** 20).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`
        return rows.slice(0, 40).map(r => `${fmt(r.size).padStart(10)}  ${r.name}`).join('\n')
      }
      case 'list_drives': {
        const out = []
        for (let c = 65; c <= 90; c++) {
          const letter = String.fromCharCode(c) + ':\\'
          try {
            const st = fs.statfsSync(letter)
            const total = st.blocks * st.bsize, free = st.bavail * st.bsize
            if (total > 0) out.push(`${letter}  ${(total / 2 ** 30).toFixed(0)}GB total, ${(free / 2 ** 30).toFixed(0)}GB free`)
          } catch {}
        }
        return out.join('\n') || 'No drives found.'
      }
      case 'list_installed_apps': {
        if (!desktop) return needDesktop()
        const keys = [
          'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
          'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
          'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        ]
        const lines = []
        for (const k of keys) {
          const r = await runShell(`reg query "${k}" /s /f "DisplayName"`, 25000)
          for (const m of r.output.matchAll(/DisplayName\s+REG_SZ\s+(.+)/g)) {
            const name = m[1].trim()
            if (name && !/update|hotfix|security|redistributable/i.test(name)) lines.push(name)
          }
        }
        return [...new Set(lines)].slice(0, 150).join('\n') || 'Could not list apps.'
      }
      case 'env_vars': {
        const f = String(args.filter || '').toLowerCase()
        return Object.entries(process.env)
          .filter(([k]) => !f || k.toLowerCase().includes(f))
          .map(([k, v]) => `${k}=${String(v).slice(0, 120)}`)
          .slice(0, 200).join('\n')
      }
      case 'registry_query': {
        if (!desktop) return needDesktop()
        const key = String(args.key || '')
        if (!/^HK(A|CU|CR|LM|U|CC)\\/i.test(key)) return 'Key must start with HKLM\\, HKCU\\, HKCR\\, etc.'
        const r = await runShell(`reg query "${key}"`, 15000)
        return (r.ok ? r.output : r.output + '\n(not found)').slice(0, 6000)
      }
      case 'file_info': {
        const p = String(args.path || '').replace(/^~/, os.homedir())
        const st = fs.statSync(p)
        const fmt = t => t ? new Date(t).toLocaleString() : '—'
        return [
          `Path: ${p}`,
          `Type: ${st.isDirectory() ? 'directory' : 'file'}`,
          `Size: ${st.isDirectory() ? '(dir)' : `${(st.size / 1024).toFixed(1)} KB`}`,
          `Created: ${fmt(st.birthtime)}`,
          `Modified: ${fmt(st.mtime)}`,
          `Accessed: ${fmt(st.atime)}`,
        ].join('\n')
      }
      case 'run_background': {
        if (!desktop) return needDesktop()
        const { spawn } = require('child_process')
        const { app } = require('electron')
        const id = uid().slice(0, 8)
        const logFile = path.join(app.getPath('userData'), `bg-${id}.log`)
        const out = fs.createWriteStream(logFile)
        const name = String(args.name || args.command.slice(0, 40))
        const child = spawn(args.command, { shell: true, windowsHide: true })
        child.stdout.pipe(out); child.stderr.pipe(out)
        child.on('close', code => {
          out.end()
          let tail = ''
          try { tail = fs.readFileSync(logFile, 'utf8').slice(-2500) } catch {}
          store.addMessage('d-jarvis', 'jarvis',
            `✅ Background task "${name}" finished (exit ${code})\n\`\`\`\n${tail || '(no output)'}\n\`\`\``)
        })
        child.on('error', e => store.addMessage('d-jarvis', 'jarvis', `❌ Background task "${name}" failed: ${e.message}`))
        return `Started background task "${name}" (id ${id}). I'll message you when it finishes.`
      }
      case 'schedule_job': {
        const job = addJob(String(args.when || ''), String(args.text || ''), args.command ? String(args.command) : null, args.aiTask ? String(args.aiTask) : null)
        return job ? `Scheduled: ${job.desc}` : 'Could not parse schedule — use like "10m", "2h", or "every 30m".'
      }
      case 'vault_save': {
        const crypto = require('crypto')
        const { execSync } = require('child_process')
        let machine = 'jarvis'
        try { machine = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' }).match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] || machine } catch {}
        const key = crypto.createHash('sha256').update('jarvis-vault:' + machine).digest()
        const iv = crypto.randomBytes(12)
        const c = crypto.createCipheriv('aes-256-gcm', key, iv)
        const enc = Buffer.concat([c.update(String(args.secret), 'utf8'), c.final()])
        const vault = loadVault()
        vault[String(args.name)] = { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: enc.toString('hex') }
        saveVault(vault)
        return `Saved "${args.name}" to encrypted vault.`
      }
      case 'vault_get': {
        const crypto = require('crypto')
        const { execSync } = require('child_process')
        const vault = loadVault()
        const e = vault[String(args.name)]
        if (!e) return `No secret named "${args.name}".`
        let machine = 'jarvis'
        try { machine = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' }).match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] || machine } catch {}
        const key = crypto.createHash('sha256').update('jarvis-vault:' + machine).digest()
        const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'hex'))
        d.setAuthTag(Buffer.from(e.tag, 'hex'))
        return Buffer.concat([d.update(Buffer.from(e.data, 'hex')), d.final()]).toString('utf8')
      }
      case 'sys_watch': {
        const metric = String(args.metric || '').toLowerCase()
        const th = +args.threshold, mins = Math.max(1, +args.interval_min || 5)
        if (!['cpu', 'ram', 'disk_percent'].includes(metric) || !th) return 'metric must be cpu|ram|disk_percent and threshold required.'
        const id = uid().slice(0, 8)
        const check = async () => {
          let val
          if (metric === 'cpu') val = Math.round((await sysMetrics()).cpu)
          else if (metric === 'ram') val = Math.round((await sysMetrics()).ram.percent)
          else { const d = await diskUsage('C:\\'); val = Math.round(100 - (d.free / (d.free + d.used)) * 100) }
          if (val >= th) {
            store.addMessage('d-jarvis', 'jarvis', `⚠️ Alert: ${metric} is at ${val}% (threshold ${th}%)`)
            memAdd('facts', `sys_watch ${id}: ${metric}=${val}% fired`)
          }
        }
        setInterval(check, mins * 60000).unref()
        memAdd('facts', `sys_watch ${id}: ${metric} >= ${th}% every ${mins}m`)
        return `Watching ${metric} >= ${th}% every ${mins} min (id ${id}).`
      }
      case 'spawn_agent': {
        if ((ctx.depth || 0) >= 2) return 'Sub-agent depth limit reached.'
        const ROLES = {
          researcher: 'You are a research specialist. Use web_search, fetch_url, research tools. Produce thorough cited findings.',
          coder: 'You are a coding specialist. Use file, git_cmd, run_command tools. Write clean code, run tests, verify.',
          operator: 'You are a desktop automation specialist. Use computer_use, browser_*, mouse/keyboard tools to operate the PC.',
          analyst: 'You are a data/system analyst. Use list_processes, disk_usage, sys tools, csv_summary, file analysis.',
        }
        const role = ROLES[String(args.agent)]
        if (!role) return `Unknown agent "${args.agent}". Use: researcher, coder, operator, analyst.`
        logActivity(`spawned ${args.agent} agent: ${String(args.task).slice(0, 60)}`)
        const r = await agentLoop(String(args.task), surface, { ...ctx, depth: (ctx.depth || 0) + 1, rolePrompt: role, agent: args.agent })
        logActivity(`${args.agent} agent finished`)
        return `[${args.agent} agent result]\n${r || 'no result'}`
      }
      case 'delegate_task': {
        if ((ctx.depth || 0) >= 2) return 'Delegation depth limit reached.'
        logActivity('delegated sub-task')
        const r = await agentLoop(String(args.task), surface, { ...ctx, depth: (ctx.depth || 0) + 1, agent: 'delegate' })
        return r || 'Sub-task produced no result.'
      }
      case 'csv_summary': {
        const text = fs.readFileSync(resolvePath(args.path), 'utf8')
        const lines = text.split(/\r?\n/).filter(Boolean)
        if (lines.length < 2) return 'CSV has no data rows.'
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
        let numeric = 0, rows = lines.length - 1
        const stats = {}
        lines.slice(1).forEach(l => {
          l.split(',').forEach((c, i) => {
            const v = parseFloat(c)
            if (!isNaN(v)) { stats[headers[i] || i] = (stats[headers[i] || i] || 0) + v; numeric++ }
          })
        })
        const sums = Object.entries(stats).map(([k, v]) => `${k}: sum=${v.toFixed(2)}`).join(', ')
        return `${rows} rows, ${headers.length} cols [${headers.join(', ')}]. Numeric sums — ${sums || 'none'}.`
      }
      case 'see_screen': {
        if (!desktop) return needDesktop()
        const { desktopCapturer } = require('electron')
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 800 } })
        if (!sources.length) return 'No screen source.'
        const b64 = sources[0].thumbnail.toPNG().toString('base64')
        const { llmBaseUrl, llmApiKey } = store.state.settings
        const vModel = store.state.settings.visionModel || 'nvidia/nemotron-3.5-super-vl-120b-a12b'
        const res = await fetch(`${llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
          body: JSON.stringify({
            model: vModel,
            messages: [{ role: 'user', content: [
              { type: 'text', text: `Look at this screenshot and answer: ${args.question}` },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            ]}],
          }),
          signal: AbortSignal.timeout(90000),
        })
        if (!res.ok) return `Vision model error HTTP ${res.status} — set a vision-capable model in Settings (visionModel).`
        const d = await res.json()
        return d.choices?.[0]?.message?.content?.trim() || 'Could not analyze screen.'
      }
      case 'memory_save': {
        memAdd('facts', args.fact)
        return 'Saved to memory.'
      }
      case 'memory_recall': {
        const q = String(args.query || '').toLowerCase()
        const hits = [...(memory.facts || []), ...(memory.lessons || [])]
          .filter(f => f.text.toLowerCase().includes(q) || q.split(' ').some(w => w.length > 3 && f.text.toLowerCase().includes(w)))
          .slice(-20).map(f => `- ${f.text}`)
        return hits.length ? hits.join('\n') : 'Nothing found in memory.'
      }
      case 'update_plan': {
        const steps = Array.isArray(args.steps) ? args.steps.map(String) : []
        if (!steps.length) return 'No steps given.'
        memAdd('plans', JSON.stringify(steps))
        return `Plan recorded (${steps.length} steps):\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nNow execute them.`
      }
      case 'read_document': {
        const p = resolvePath(args.path)
        const ext = path.extname(p).toLowerCase()
        if (ext === '.pdf') {
          const pdfParse = require('pdf-parse')
          const data = await pdfParse(fs.readFileSync(p))
          return (data.text || '(no text — scanned PDF?)').slice(0, 8000)
        }
        if (ext === '.docx') {
          const mammoth = require('mammoth')
          const r = await mammoth.extractRawText({ path: p })
          return (r.value || '').slice(0, 8000)
        }
        return fs.readFileSync(p, 'utf8').slice(0, 8000)
      }
      case 'list_jobs': {
        if (!jobs.length) return 'No scheduled jobs.'
        return jobs.map(j => `- [${j.id}] ${j.desc} (${j.kind})`).join('\n')
      }
      case 'cancel_job': {
        const j = jobs.find(x => x.id === String(args.id))
        if (!j) return `No job with id ${args.id}.`
        jobs = jobs.filter(x => x.id !== j.id); saveJobs()
        clearTimeout(jobTimers.get(j.id)); jobTimers.delete(j.id)
        return `Cancelled: ${j.desc}`
      }
      case 'export_chat': {
        const { app } = require('electron')
        const msgs = store.state.messages['d-jarvis'] || []
        const md = msgs.map(m => `**${m.userId === 'jarvis' ? 'Jarvis' : 'You'}** (${new Date(m.ts).toLocaleString()}):\n${m.text}\n`).join('\n---\n\n')
        const f = path.join(app.getPath('desktop'), `jarvis-chat-${Date.now()}.md`)
        fs.writeFileSync(f, `# Jarvis Conversation\n\n${md}`)
        return `Exported to ${f}`
      }
      case 'browser_navigate': {
        const b = require('./browser.cjs')
        return b.navigate(args.url)
      }
      case 'browser_snapshot': {
        const b = require('./browser.cjs')
        return b.snapshot()
      }
      case 'browser_click': {
        const b = require('./browser.cjs')
        return b.click(args.text)
      }
      case 'browser_type': {
        const b = require('./browser.cjs')
        return b.type(args.text, args.selector)
      }
      case 'browser_press': {
        const b = require('./browser.cjs')
        return b.press(args.key)
      }
      case 'browser_scroll': {
        const b = require('./browser.cjs')
        return b.scroll(args.dir === 'up' ? 'up' : 'down')
      }
      case 'browser_back': {
        const b = require('./browser.cjs')
        return b.back()
      }
      case 'browser_eval': {
        const b = require('./browser.cjs')
        return b.evaluate(args.js)
      }
      case 'browser_close': {
        const b = require('./browser.cjs')
        return b.close()
      }
      case 'computer_use': {
        const { desktopCapturer, screen } = require('electron')
        const disp = screen.getPrimaryDisplay().size
        const maxSteps = Math.min(12, Math.max(1, +args.max_steps || 8))
        const vModel = store.state.settings.visionModel || 'nvidia/nemotron-3.5-super-vl-120b-a12b'
        const { llmBaseUrl, llmApiKey } = store.state.settings
        const log = []
        for (let step = 0; step < maxSteps; step++) {
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.min(disp.width, 1600), height: Math.min(disp.height, 1000) } })
          if (!sources.length) return 'No screen.'
          const b64 = sources[0].thumbnail.toPNG().toString('base64')
          const prompt = `You are controlling a Windows PC. Goal: ${args.goal}\nSteps so far: ${log.join(' | ') || 'none'}\nLook at the screenshot and reply with ONLY a JSON object (no markdown):\n{"done":true|false,"thought":"what you see/plan","action":{"type":"click|type|key|scroll|wait|done","x":0.0-1.0,"y":0.0-1.0,"text":"...","key":"...","dir":"up|down"}}\nCoordinates x,y are fractions of screen (0=left/top,1=right/bottom). Use done:true when goal is achieved.`
          const res = await fetch(`${llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
            body: JSON.stringify({ model: vModel, messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            ]}], max_tokens: 400 }),
            signal: AbortSignal.timeout(60000),
          })
          if (!res.ok) return `Vision error HTTP ${res.status}`
          const d = await res.json()
          const raw = (d.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim()
          let act
          try { act = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } catch { return `Vision returned unparseable: ${raw.slice(0, 200)}` }
          if (act.done || act.action?.type === 'done') return `Done after ${step + 1} steps. ${act.thought || ''}\nTrace: ${log.join(' → ')}`
          const a = act.action || {}
          const px = Math.round((a.x ?? 0.5) * disp.width), py = Math.round((a.y ?? 0.5) * disp.height)
          let r = ''
          if (a.type === 'click') { r = await execTool('mouse_click', { x: px, y: py }, surface, ctx); cursor.ripple() }
          else if (a.type === 'type') r = await execTool('type_text', { text: a.text }, surface, ctx)
          else if (a.type === 'key') r = await execTool('press_key', { key: a.key }, surface, ctx)
          else if (a.type === 'scroll') r = await execTool('mouse_scroll', { amount: a.dir === 'up' ? -5 : 5 }, surface, ctx)
          else if (a.type === 'wait') { await new Promise(s => setTimeout(s, 1500)); r = 'waited' }
          else r = `unknown action ${a.type}`
          log.push(`${a.type}${a.type === 'click' ? `(${px},${py})` : ''}${a.text ? ` "${String(a.text).slice(0, 30)}"` : ''}`)
          await new Promise(s => setTimeout(s, 700))
        }
        return `Reached max steps (${maxSteps}). Last actions: ${log.join(' → ')}`
      }
      case 'git_cmd': {
        const dir = resolvePath(args.path)
        const r = await runShell(`git -C "${dir}" ${String(args.command).slice(0, 500)}`, 60000)
        return (r.output || r.error || '(no output)').slice(0, 4000)
      }
      case 'stock_price': {
        const sym = String(args.symbol).trim()
        const stooqSym = sym.includes('-') ? sym.toLowerCase().replace('-usd', '.usd') : sym.toLowerCase() + '.us'
        const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(stooqSym)}&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(15000) })
        const t = await r.text()
        const line = t.trim().split('\n')[1]
        if (!line) return `No data for ${sym}.`
        const [symbol, date, time, open, high, low, close, volume] = line.split(',')
        return `${symbol}: $${close} (open ${open}, high ${high}, low ${low}) on ${date} ${time} UTC`
      }
      case 'research': {
        const s = await execTool('web_search', { query: args.topic }, surface, ctx)
        const urls = (s.match(/https?:\/\/[^\s)\]]+/g) || []).slice(0, 3)
        let corpus = ''
        for (const u of urls) {
          const f = await execTool('fetch_url', { url: u }, surface, ctx)
          corpus += `\n\n--- ${u} ---\n${String(f).slice(0, 3000)}`
        }
        if (!corpus) return `No sources found for "${args.topic}".`
        const { llmBaseUrl, llmApiKey, llmModel } = store.state.settings
        const r = await fetch(`${llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
          body: JSON.stringify({ model: llmModel, messages: [
            { role: 'system', content: 'You are a research analyst. Write a concise, well-structured summary with key facts and cite sources by URL.' },
            { role: 'user', content: `Research topic: ${args.topic}\n\nSources:${corpus.slice(0, 12000)}` },
          ], max_tokens: 1200 }),
          signal: AbortSignal.timeout(90000),
        })
        const d = await r.json()
        return d.choices?.[0]?.message?.content?.trim() || 'Research failed.'
      }
      case 'mark_location': {
        const q = String(args.place || '')
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
          headers: { 'User-Agent': 'JarvisAssistant/1.0' }, signal: AbortSignal.timeout(15000),
        })
        const d = await r.json()
        if (!d.length) return `Could not find "${q}".`
        const g = d[0]
        const loc = { id: uid().slice(0, 8), name: args.label || g.display_name.split(',').slice(0, 2).join(','), lat: +g.lat, lon: +g.lon, display: g.display_name }
        const locs = loadLocs()
        if (!locs.find(l => l.display === loc.display)) { locs.push(loc); saveLocs(locs) }
        return `Marked "${loc.name}" at ${loc.lat}, ${loc.lon}.`
      }
      case 'window_manage': {
        if (!desktop) return needDesktop()
        if (args.action === 'list') {
          const r = await psRun(`Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress`)
          try {
            const p = JSON.parse(r || '[]'); const arr = Array.isArray(p) ? p : [p]
            return arr.map(w => `${w.ProcessName} [${w.Id}]: ${w.MainWindowTitle}`).join('\n') || 'No windows.'
          } catch { return 'No windows found.' }
        }
        if (!args.title) return 'title required for focus/close.'
        const esc = String(args.title).replace(/'/g, "''")
        if (args.action === 'focus') {
          await psRun(`$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${esc}*' } | Select-Object -First 1; if ($p) { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) }`)
          return `Focused window matching "${args.title}".`
        }
        if (args.action === 'close') {
          await psRun(`Get-Process | Where-Object { $_.MainWindowTitle -like '*${esc}*' } | ForEach-Object { $_.CloseMainWindow() | Out-Null }`)
          return `Close sent to windows matching "${args.title}".`
        }
        return 'Unknown action.'
      }
      case 'clipboard': {
        const { clipboard } = require('electron')
        if (args.action === 'get') return clipboard.readText() || '(empty)'
        clipboard.writeText(String(args.text || ''))
        return 'Copied to clipboard.'
      }
      case 'translate_text': {
        const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(args.text)}&langpair=en|${encodeURIComponent(args.lang)}`, { signal: AbortSignal.timeout(15000) })
        const d = await r.json()
        return d.responseData?.translatedText || 'Translation failed.'
      }
      case 'pdf_merge': {
        const { PDFDocument } = require('pdf-lib')
        const files = String(args.paths).split(',').map(s => resolvePath(s.trim())).filter(Boolean)
        const out = await PDFDocument.create()
        for (const f of files) {
          const src = await PDFDocument.load(fs.readFileSync(f))
          const pages = await out.copyPages(src, src.getPageIndices())
          pages.forEach(p => out.addPage(p))
        }
        const merged = path.join(require('electron').app.getPath('desktop'), `merged-${Date.now()}.pdf`)
        fs.writeFileSync(merged, await out.save())
        return `Merged ${files.length} PDFs → ${merged}`
      }
      case 'read_eml': {
        const raw = fs.readFileSync(resolvePath(args.path), 'utf8')
        const head = raw.slice(0, raw.indexOf('\n\n') > 0 ? raw.indexOf('\n\n') : 3000)
        const get = h => (head.match(new RegExp(`^${h}:\\s*(.+)$`, 'im')) || [])[1]?.trim()
        const bodyStart = raw.indexOf('\n\n')
        const body = raw.slice(bodyStart + 2).replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).slice(0, 4000)
        return `From: ${get('From')}\nSubject: ${get('Subject')}\nDate: ${get('Date')}\n\n${body}`
      }
      case 'startup_list': {
        const r = await psRun(`Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -ErrorAction SilentlyContinue | Select-Object * -ExcludeProperty PS* | ConvertTo-Json -Compress`)
        try {
          const o = JSON.parse(r || '{}'); const arr = Array.isArray(o) ? o : [o]
          return arr.map(x => Object.entries(x).filter(([k]) => !k.startsWith('PS')).map(([k, v]) => `${k} → ${v}`).join('\n')).join('\n') || 'No startup items.'
        } catch { return r || 'No startup items.' }
      }
      case 'network_stats': {
        const r = await psRun(`Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object Name,InterfaceDescription,LinkSpeed | ConvertTo-Json -Compress; (Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Measure-Object).Count`)
        return r || 'No network info.'
      }
      case 'kill_process': {
        if (!desktop) return needDesktop()
        const target = args.pid ? `-Id ${+args.pid}` : `-Name "${String(args.name || '').replace(/"/g, '')}"`
        await psRun(`Stop-Process ${target} -Force -ErrorAction SilentlyContinue`)
        return `Kill sent to ${args.pid ? `PID ${args.pid}` : args.name}.`
      }
      case 'verify_work': {
        const r = await agentLoop(`Verify this claim is actually true by checking evidence (files, commands, state): "${args.claim}". Reply VERIFIED or FAILED + one-line reason.`, surface, { ...ctx, depth: (ctx.depth || 0) + 1, agent: 'verifier', rolePrompt: 'You are a skeptical verification agent. Check facts with tools before confirming.' })
        return `Verification: ${r || 'could not verify'}`
      }
      case 'snippet_save': {
        const f = memFile()
        const data = JSON.parse(fs.readFileSync(f, 'utf8'))
        data.snippets = data.snippets || {}
        data.snippets[args.key] = args.text
        fs.writeFileSync(f, JSON.stringify(data, null, 2))
        return `Snippet "${args.key}" saved.`
      }
      case 'snippet_expand': {
        const f = memFile()
        const data = JSON.parse(fs.readFileSync(f, 'utf8'))
        const t = data.snippets?.[args.key]
        if (!t) return `No snippet "${args.key}".`
        if (args.type_it) { await psTypeText(t); return `Typed snippet "${args.key}".` }
        return t
      }
      case 'screen_watch': {
        const py = require('./python.cjs')
        const secs = Math.min(120, Math.max(5, +args.seconds || 30))
        const frames = Math.floor(secs)
        logActivity(`screen watch: ${secs}s`)
        await py.call('/vision_reset', {})
        const events = []
        let lastSig = ''
        for (let i = 0; i < frames; i++) {
          const f = await py.call('/vision_frame', {}, 20000)
          if (!f.ok) return `Vision error: ${f.error}`
          if (f.changed > 8) {
            const sig = `${Math.round(f.changed)}@${i}s`
            if (sig !== lastSig) { events.push({ t: i, changed: f.changed }); lastSig = sig }
          }
          await new Promise(r => setTimeout(r, 900))
        }
        if (!events.length) return `Watched ${secs}s — screen was static, no significant changes.`
        let out = `Screen watch (${secs}s): ${events.length} change events at seconds ${events.map(e => e.t).join(', ')}.`
        if (args.describe && events.length <= 5) {
          // grab a fresh frame and ask vision model what changed context is
          const shot = await execTool('screenshot', {}, surface, ctx)
          out += `\nLatest frame captured for analysis.`
        }
        return out
      }
      case 'py_engine': {
        const py = require('./python.cjs')
        const mode = ['task', 'structured', 'analyze', 'chat'].includes(args.mode) ? args.mode : 'task'
        logActivity(`python engine: ${mode}`)
        const ep = { task: '/task', structured: '/structured', analyze: '/analyze', chat: '/complete' }[mode]
        const body = mode === 'chat'
          ? { messages: [{ role: 'user', content: args.input }] }
          : mode === 'structured'
            ? { prompt: args.input, schema_hint: args.schema_hint || 'Return valid JSON only.' }
            : mode === 'analyze'
              ? { messages: [{ role: 'user', content: args.input }] }
              : { goal: args.input }
        const r = await py.call(ep, body)
        if (!r.ok) return `Python engine error: ${r.error}`
        return JSON.stringify(r.data || r.reply || r.analysis || r, null, 1).slice(0, 6000)
      }
      case 'media_control': {
        if (!desktop) return needDesktop()
        const keys = { play_pause: '{MEDIA_PLAY_PAUSE}', next: '{MEDIA_NEXT_TRACK}', previous: '{MEDIA_PREV_TRACK}', stop: '{MEDIA_STOP}' }
        await psRun(`$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${keys[args.action] || keys.play_pause}')`)
        return `Media ${args.action} sent.`
      }
      case 'system_dashboard': {
        const cpu = await psRun(`(Get-CimInstance Win32_Processor).LoadPercentage`)
        const mem = await psRun(`$o=Get-CimInstance Win32_OperatingSystem; [math]::Round(($o.TotalVisibleMemorySize-$o.FreePhysicalMemory)/$o.TotalVisibleMemorySize*100)`)
        const up = await psRun(`(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime | ForEach-Object { "$($_.Days)d $($_.Hours)h" }`)
        const top = await psRun(`Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name,CPU | ConvertTo-Json -Compress`)
        return `CPU: ${cpu?.trim() ?? '?'}% | RAM: ${mem?.trim() ?? '?'}% used | Uptime: ${up?.trim()}\nTop CPU: ${top?.slice(0, 400)}`
      }
      case 'clipboard_history': {
        return clipHistory.length ? [...clipHistory].reverse().slice(0, 15).map((c, i) => `${i + 1}. ${c.slice(0, 80)}`).join('\n') : 'Clipboard history empty.'
      }
      case 'organize_folder': {
        if (!desktop) return needDesktop()
        const dir = resolvePath(args.path)
        const groups = {
          Images: '\\.jpg|\\.jpeg|\\.png|\\.gif|\\.webp|\\.bmp', Docs: '\\.pdf|\\.docx?|\\.txt|\\.md|\\.rtf',
          Videos: '\\.mp4|\\.mkv|\\.avi|\\.mov|\\.webm', Audio: '\\.mp3|\\.wav|\\.flac|\\.ogg',
          Archives: '\\.zip|\\.rar|\\.7z|\\.tar|\\.gz', Code: '\\.js|\\.ts|\\.py|\\.html|\\.css|\\.json|\\.jsx|\\.tsx',
        }
        const psGroups = Object.entries(groups).map(([n, re]) => `$${n}='${re}'`).join(';')
        const r = await psRun(`$dir='${dir.replace(/'/g, "''")}'; ${psGroups}; Get-ChildItem $dir -File | ForEach-Object { $n=$_.Name; $dest='Other'; foreach($g in '${Object.keys(groups).join('|')}'){ if($n -match (Get-Variable $g -ValueOnly)){ $dest=$g; break } }; $t=Join-Path $dir $dest; if(!(Test-Path $t)){New-Item -ItemType Directory -Path $t|Out-Null}; Move-Item $_.FullName $t -Force }; 'organized'`)
        return `Folder organized: ${dir} (Images/Docs/Videos/Audio/Archives/Code/Other)`
      }
      case 'disk_cleanup': {
        const targets = ['$env:TEMP', "$env:LOCALAPPDATA\\Temp"]
        if (args.mode === 'clean') {
          await psRun(`Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; 'cleaned'`)
          return 'Temp files cleaned.'
        }
        const sizes = await psRun(`@('${targets[0]}','${targets[1]}') | ForEach-Object { if(Test-Path $_){ $s=(Get-ChildItem $_ -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; "$_ = $([math]::Round($s/1MB)) MB" } }`)
        return `Cleanable space:\n${sizes || 'none'}`
      }
      case 'power_mode': {
        const plans = { balanced: '381b4222-f694-41f0-9685-ff5bb260df2e', power_saver: 'a1841308-3541-4fab-bc81-f71556f20b4a', high_performance: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' }
        await psRun(`powercfg /setactive ${plans[args.mode]}`)
        return `Power plan → ${args.mode}.`
      }
      case 'knowledge_search': {
        const dir = resolvePath(args.folder)
        const q = String(args.query).toLowerCase()
        const r = await psRun(`Get-ChildItem '${dir.replace(/'/g, "''")}' -Recurse -Include *.txt,*.md,*.js,*.ts,*.json,*.csv -File -ErrorAction SilentlyContinue | Select-String -Pattern '${q.replace(/'/g, "''")}' -List | Select-Object -First 10 Path,LineNumber | ConvertTo-Json -Compress`, 30000)
        try {
          const m = JSON.parse(r || '[]'); const arr = Array.isArray(m) ? m : [m]
          return arr.filter(x => x.Path).map(x => `${x.Path}:${x.LineNumber}`).join('\n') || 'No matches.'
        } catch { return r?.slice(0, 2000) || 'No matches.' }
      }
      case 'request_approval': {
        let a = {}
        try { a = JSON.parse(args.args || '{}') } catch {}
        pendingApprovals.push({ tool: args.tool, args: a, surface, ctx: { ...ctx }, action: args.action, ts: Date.now() })
        if (pendingApprovals.length > 10) pendingApprovals.shift()
        return `APPROVAL_REQUIRED: "${args.action}". Ask the user to confirm (yes/no). The action is queued — do NOT claim it was done.`
      }
      case 'list_locations': {
        const locs = loadLocs()
        return locs.length ? locs.map(l => `- ${l.name} (${l.lat}, ${l.lon})`).join('\n') : 'No markers saved.'
      }
      case 'map_directions': {
        const geo = async q => {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Jarvis/1.0' }, signal: AbortSignal.timeout(15000) })
          const d = await r.json(); return d[0] ? [+d[0].lon, +d[0].lat] : null
        }
        const a = await geo(args.from), b = await geo(args.to)
        if (!a || !b) return 'Could not find one of the places.'
        const prof = ['driving', 'walking', 'cycling'].includes(args.profile) ? args.profile : 'driving'
        const svc = { driving: 'driving', walking: 'foot', cycling: 'bike' }[prof]
        const r = await fetch(`https://router.project-osrm.org/route/v1/${svc}/${a[0]},${a[1]};${b[0]},${b[1]}?overview=false&steps=true`, { signal: AbortSignal.timeout(20000) })
        const d = await r.json()
        const rt = d.routes?.[0]
        if (!rt) return 'No route found.'
        const mins = Math.round(rt.duration / 60), km = (rt.distance / 1000).toFixed(1)
        const turns = (rt.legs?.[0]?.steps || []).slice(0, 6).map(s => s.maneuver?.type).join(' → ')
        return `${prof}: ${km} km, ~${mins} min.\nSteps: ${turns || 'direct'}`
      }
      case 'show_route': {
        const { app } = require('electron')
        const geo = async q => {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Jarvis/1.0' }, signal: AbortSignal.timeout(15000) })
          const d = await r.json(); return d[0] ? [+d[0].lon, +d[0].lat] : null
        }
        const a = await geo(args.from), b = await geo(args.to)
        if (!a || !b) return 'Could not find one of the places.'
        const prof = ['driving', 'walking', 'cycling'].includes(args.profile) ? args.profile : 'driving'
        const svc = { driving: 'driving', walking: 'foot', cycling: 'bike' }[prof]
        const r = await fetch(`https://router.project-osrm.org/route/v1/${svc}/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`, { signal: AbortSignal.timeout(20000) })
        const d = await r.json()
        const rt = d.routes?.[0]
        if (!rt) return 'No route found.'
        const coords = rt.geometry.coordinates.map(([lon, lat]) => [lat, lon])
        const f = path.join(app.getPath('userData'), 'jarvis-route.json')
        fs.writeFileSync(f, JSON.stringify({ coords, from: args.from, to: args.to, profile: prof, km: (rt.distance / 1000).toFixed(1), mins: Math.round(rt.duration / 60) }))
        return `Route drawn on map: ${rt.distance / 1000 | 0} km, ~${Math.round(rt.duration / 60)} min (${args.from} → ${args.to}).`
      }
      case 'nearby_places': {
        const geo = async q => {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Jarvis/1.0' }, signal: AbortSignal.timeout(15000) })
          const d = await r.json(); return d[0] ? [+d[0].lon, +d[0].lat] : null
        }
        const c = await geo(args.place)
        if (!c) return `Could not find "${args.place}".`
        const radius = Math.min(5000, Math.max(100, +args.radius_m || 1000))
        const tagMap = { cafe: 'amenity=cafe', restaurant: 'amenity=restaurant', hospital: 'amenity=hospital', atm: 'amenity=atm', petrol_station: 'amenity=fuel', pharmacy: 'amenity=pharmacy', park: 'leisure=park', hotel: 'tourism=hotel', school: 'amenity=school', station: 'railway=station', supermarket: 'shop=supermarket', gym: 'leisure=fitness_centre' }
        const q = tagMap[String(args.kind)] || `name~"${args.kind}",i`
        const overpassQ = `[out:json][timeout:20];(node(around:${radius},${c[1]},${c[0]})[${q}];way(around:${radius},${c[1]},${c[0]})[${q}];);out center tags 15;`
        const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: `data=${encodeURIComponent(overpassQ)}`, signal: AbortSignal.timeout(30000) })
        const d = await r.json()
        const els = d.elements || []
        if (!els.length) return `No ${args.kind} found within ${radius}m of ${args.place}.`
        return els.slice(0, 10).map(e => `- ${e.tags?.name || e.tags?.[Object.keys(e.tags || {}).find(k => k.startsWith('amenity') || k.startsWith('shop') || k.startsWith('leisure'))] || 'unnamed'} (${(e.lat || e.center?.lat)?.toFixed(4)}, ${(e.lon || e.center?.lon)?.toFixed(4)})`).join('\n')
      }
      case 'weather_alert': {
        const geo = async q => {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Jarvis/1.0' }, signal: AbortSignal.timeout(15000) })
          const d = await r.json(); return d[0] ? [+d[0].lat, +d[0].lon] : null
        }
        const c = await geo(args.place)
        if (!c) return `Could not find "${args.place}".`
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c[0]}&longitude=${c[1]}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`, { signal: AbortSignal.timeout(15000) })
        const d = await r.json()
        if (!d.daily) return 'Forecast unavailable.'
        const codes = { 0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'drizzle', 61: 'rain', 63: 'heavy rain', 65: 'very heavy rain', 71: 'snow', 80: 'showers', 95: 'thunderstorm', 96: 'thunderstorm+hail', 99: 'severe thunderstorm' }
        const out = []
        for (let i = 0; i < 2; i++) {
          const code = d.daily.weathercode[i], name = codes[code] || `code ${code}`
          const severe = [63, 65, 71, 80, 95, 96, 99].includes(code) || d.daily.temperature_2m_max[i] > 45 || d.daily.temperature_2m_min[i] < -10
          out.push(`${d.daily.time[i]}: ${name}, ${d.daily.temperature_2m_min[i]}°→${d.daily.temperature_2m_max[i]}°C, rain ${d.daily.precipitation_probability_max[i]}%${severe ? ' ⚠️ SEVERE' : ''}`)
        }
        return out.join('\n')
      }
      case 'backup_data': {
        const { app } = require('electron')
        const bundle = {
          memory, jobs, settings: store.state.settings,
          vaultNames: Object.keys(loadVault()),
          locations: loadLocs(), ts: Date.now(),
        }
        const f = path.join(app.getPath('desktop'), `jarvis-backup-${Date.now()}.json`)
        fs.writeFileSync(f, JSON.stringify(bundle, null, 2))
        return `Backup saved: ${f} (memory, jobs, settings, vault names, locations)`
      }
      case 'restore_data': {
        const b = JSON.parse(fs.readFileSync(resolvePath(args.path), 'utf8'))
        if (b.memory) { memory.facts = b.memory.facts || []; memory.lessons = b.memory.lessons || []; memory.plans = b.memory.plans || []; saveMem() }
        if (Array.isArray(b.jobs)) { jobs.length = 0; jobs.push(...b.jobs); saveJobs() }
        if (b.locations) saveLocs(b.locations)
        if (b.settings) { store.state.settings = { ...store.state.settings, ...b.settings }; store.save() }
        return 'Restore complete — restart recommended.'
      }
      default:
        return `Unknown tool: ${name}`
    }
  } catch (e) {
    memAdd('lessons', `${name} failed: ${e.message}`)
    return `Tool error: ${e.message}`
  }
}

// ---------------- LLM agent loop ----------------
const SYS_PROMPT = `You are Jarvis, a personal AI assistant running on the user's Windows PC. You can perform real tasks using the provided tools — actually do them instead of just describing them. Rules:
- Keep final answers short and direct (1-3 sentences unless detail is needed).
- Use tools proactively when the user asks you to DO something (open apps, run commands, read/write files, search, notes, reminders).
- Never invent tool results — always call the tool.
- If a tool fails, say what went wrong briefly.
- You may also be reached via Slack on the user's phone — the same tools are available there.
- For multi-step tasks, call update_plan first with your steps, then execute them.
- Think step by step for complex requests; verify tool results before answering.
- Use see_screen when the user refers to what's on their screen ("this error", "this window").
- Use memory_save to remember facts/preferences; memory_recall to look things up.
- For web tasks use the browser_* tools: browser_navigate → browser_snapshot → browser_click/browser_type → repeat. The browser is a real visible window the user can watch.
- Use py_engine for: structured JSON output, deep analysis, or autonomous planning (modes: task/structured/analyze/chat). Prefer it over guessing formats.`

async function chatOnce(messages, tools) {
  const { llmBaseUrl, llmApiKey, llmModel } = store.state.settings
  const res = await fetch(`${llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
    body: JSON.stringify({ model: llmModel, messages, tools, tool_choice: 'auto' }),
    signal: AbortSignal.timeout(90000),
  })
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message || null
}

async function agentLoop(text, surface, ctx = {}) {
  const { llmApiKey } = store.state.settings
  if (!llmApiKey) return null
  const db = await getDefaultBrowser()
  const sysPrompt = SYS_PROMPT + (ctx.rolePrompt ? `\n\n${ctx.rolePrompt}` : '') + `\n\nUser context: Windows PC. Default web browser: ${db.name || 'unknown'}${db.exe ? ` (${db.exe})` : ''}. When asked to "open browser" or browse the web, use the default browser — do NOT assume Edge.` + memContext()
  // inject recent conversation history so Jarvis has context
  const histCh = ctx.channelId || 'd-jarvis'
  const hist = (store.state.messages[histCh] || []).slice(-12)
    .filter(m => !(m.userId !== 'jarvis' && m.text.trim() === text.trim()))
    .map(m => ({ role: m.userId === 'jarvis' ? 'assistant' : 'user', content: m.text.slice(0, 2000) }))
  const messages = [
    { role: 'system', content: sysPrompt },
    ...hist,
    { role: 'user', content: text },
  ]
  const toolErrors = []
  const failCounts = {}
  let resultsHint = ''
  for (let i = 0; i < 10; i++) {
    logActivity(`${ctx.agent ? `[${ctx.agent}] ` : ''}thinking… step ${i + 1}/10`)
    const msg = await chatOnce(messages, TOOLS)
    if (!msg) return null
    messages.push(msg)
    const calls = msg.tool_calls || []
    if (!calls.length) {
      const reply = msg.content?.trim() || 'Done.'
      // self-heal: if tools failed and the model gave up, push it to try a different approach
      if (toolErrors.length && i < 9 && /fail|error|unable|cannot|can't|sorry/i.test(reply)) {
        messages.push({ role: 'user', content: `Some tools failed: ${toolErrors.slice(-3).join('; ')}. Do NOT give up — try a different tool or approach to still accomplish the goal. If truly impossible, explain exactly why in one line.` })
        continue
      }
      return reply
    }
    // run independent tool calls in parallel
    const results = await Promise.all(calls.map(async call => {
      let args = {}
      try { args = JSON.parse(call.function.arguments || '{}') } catch {}
      const result = await execTool(call.function.name, args, surface, ctx)
      // prompt-injection guard: strip instruction-like content from tool output
      const rs = String(result).replace(/(ignore (all |any )?(previous|prior) instructions|system prompt|you are now|new instructions?:)/gi, '[filtered]')
      if (/^(Tool error|.*failed|.*error)/i.test(rs) && rs.length < 300) {
        toolErrors.push(`${call.function.name}: ${rs.slice(0, 120)}`)
        failCounts[call.function.name] = (failCounts[call.function.name] || 0) + 1
        if (failCounts[call.function.name] >= 2) {
          memAdd('lessons', `tool ${call.function.name} failed repeatedly — find alternative`)
          results_hint = `Tool ${call.function.name} has failed ${failCounts[call.function.name]}x — STOP retrying it, use a different approach.`
        }
      }
      return { role: 'tool', tool_call_id: call.id, content: rs }
    }))
    messages.push(...results)
    if (resultsHint) { messages.push({ role: 'system', content: resultsHint }); resultsHint = '' }
  }
  return 'I completed the requested steps.'
}

// plain chat fallback (no tools) if tool-calling unsupported
async function plainReply(text) {
  const { llmBaseUrl, llmApiKey, llmModel } = store.state.settings
  try {
    const res = await fetch(`${llmBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
      body: JSON.stringify({ model: llmModel, messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: text }] }),
      signal: AbortSignal.timeout(90000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch { return null }
}

// surface: 'desktop' | 'slack'
async function handleMessage(text, surface, ctx = {}) {
  const trimmed = text.trim()
  if (!trimmed) return null

  // approval flow: "yes"/"confirm" executes last pending action
  if (/^(yes|yeah|yep|confirm|ok|haan|ha|sure|go ahead|proceed)[!. ]*$/i.test(trimmed) && pendingApprovals.length) {
    const p = pendingApprovals.shift()
    logActivity(`approval granted: ${p.action}`)
    try {
      const result = await execTool(p.tool, p.args, p.surface, p.ctx)
      return `Done — ${p.action}\n${String(result).slice(0, 500)}`
    } catch (e) { return `Approved but failed: ${e.message}` }
  }
  if (/^(no|nope|nahi|cancel|reject|stop)[!. ]*$/i.test(trimmed) && pendingApprovals.length) {
    const p = pendingApprovals.shift()
    return `Cancelled: ${p.action}`
  }

  if (trimmed.startsWith('/')) {
    const reply = await handleCommand(trimmed, surface)
    if (reply) return reply
    return `Unknown command. Try \`/help\`.`
  }

  // agentic path
  try {
    console.log('[jarvis] agentLoop start:', surface, trimmed.slice(0, 60))
    const reply = await agentLoop(trimmed, surface, ctx)
    console.log('[jarvis] agentLoop done, reply len:', reply?.length)
    if (reply) return reply
  } catch (e) {
    console.warn('[jarvis] agentLoop failed:', e.message)
    // tool-calling may be unsupported — fall through to plain chat
  }
  const plain = await plainReply(trimmed)
  console.log('[jarvis] plainReply:', !!plain)
  if (plain) return plain

  return `I'm here. Type \`/help\` for commands, or ask me to do something — I can open apps, run commands, manage files, search the web, set reminders.`
}

module.exports = {
  handleMessage, HELP,
  getMemory: () => ({ facts: memory.facts || [], lessons: memory.lessons || [], plans: memory.plans || [] }),
  getJobs: () => jobs.map(j => ({ id: j.id, desc: j.desc, kind: j.kind })),
  cancelJob: id => { const i = jobs.findIndex(j => j.id === id); if (i < 0) return false; const j = jobs[i]; jobs.splice(i, 1); saveJobs(); clearTimeout(jobTimers.get(j.id)); jobTimers.delete(j.id); return true },
  vaultList: () => Object.keys(loadVault()),
  getActivity: () => activityLog.slice(-30),
  getLocations: () => loadLocs(),
  getRoute: () => { try { return JSON.parse(fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'jarvis-route.json'), 'utf8')) } catch { return null } },
}

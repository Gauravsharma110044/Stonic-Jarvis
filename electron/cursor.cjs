// Jarvis cursor overlay — a transparent always-on-top orb that follows
// the real mouse while Jarvis performs desktop actions.
const { BrowserWindow } = require('electron')

let win = null

const PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html><head><style>
  html,body{margin:0;background:transparent;overflow:hidden;height:100%}
  svg{position:absolute;left:0;top:0;overflow:visible}
  .fx{position:absolute;left:0;top:0;width:48px;height:48px;border-radius:50%;
    border:2px solid rgba(87,217,255,.9);opacity:0;pointer-events:none}
  .fx.go{animation:ripple .55s ease-out}
  @keyframes ripple{0%{transform:scale(.4);opacity:.9}100%{transform:scale(1.8);opacity:0}}
</style></head><body>
<svg width="48" height="48" viewBox="0 0 24 24">
  <defs>
    <filter id="g" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M4 2 L4 19 L8.5 15.5 L11 21 L13.5 20 L11 14.5 L17 14.5 Z"
    fill="#eaf6ff" stroke="#57d9ff" stroke-width="1.4" filter="url(#g)"/>
  <path d="M5.2 3.6 L5.2 17.4 L8.6 14.4 L10.6 18.8 L12.4 18.1 L10.4 13.7 L15.4 13.7 Z"
    fill="none" stroke="rgba(87,217,255,.55)" stroke-width=".5"/>
</svg>
<div class="fx" id="fx"></div>
<script>
  const {ipcRenderer}=require('electron');
  ipcRenderer.on('fx',()=>{const f=document.getElementById('fx');f.classList.remove('go');void f.offsetWidth;f.classList.add('go')});
</script></body></html>`)}`

function ensure() {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 72, height: 72,
    transparent: true, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    focusable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  win.loadURL(PAGE)
  win.showInactive()
  return win
}

let hideTimer = null
function poke() {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, 10000) // auto-hide after 10s idle
}
function moveTo(x, y) {
  return // cursor overlay disabled
}
function ripple() {
  return // cursor overlay disabled
}
function hide() {
  clearTimeout(hideTimer)
  try { win?.hide() } catch {}
}

module.exports = { moveTo, ripple, hide, ensure }

// Jarvis mobile bridge — HTTP server for the native app (Tailscale/LAN)
const http = require('http')
const os = require('os')
const assistant = require('./assistant.cjs')
const { getStore } = require('./store.cjs')

const PORT = 3434
let server = null

function lanIPs() {
  const out = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, ip: a.address })
    }
  }
  return out
}

const PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#04070f">
<title>Jarvis</title>
<style>
*{box-sizing:border-box;margin:0}
body{background:#04070f;color:#dbe9ff;font-family:system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
header{padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(87,217,255,.15)}
header b{font-size:15px;letter-spacing:.5px}
.dot{width:9px;height:9px;border-radius:50%;background:#38e0a0;box-shadow:0 0 8px #38e0a0}
#log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.msg.user{align-self:flex-end;background:linear-gradient(135deg,#1a4fb5,#0e2a66);border:1px solid rgba(120,190,255,.3)}
.msg.jarvis{align-self:flex-start;background:rgba(20,40,80,.55);border:1px solid rgba(87,217,255,.2)}
.msg.sys{align-self:center;background:transparent;color:#7d93b8;font-size:12px;padding:4px}
#inbar{display:flex;gap:8px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid rgba(87,217,255,.15)}
#in{flex:1;background:rgba(15,30,60,.8);border:1px solid rgba(87,217,255,.3);border-radius:22px;color:#eaf4ff;padding:11px 16px;font-size:15px;outline:none}
#send{background:linear-gradient(135deg,#2f8cff,#57d9ff);border:none;border-radius:22px;color:#04101f;font-weight:700;padding:0 20px;font-size:15px}
#send:disabled{opacity:.5}
</style></head><body>
<header><div class="dot"></div><b>JARVIS</b><span id="st" style="margin-left:auto;font-size:11px;color:#7d93b8"></span></header>
<div id="log"></div>
<div id="inbar"><input id="in" placeholder="Ask Jarvis..." autocomplete="off"><button id="send">Send</button></div>
<script>
const log=document.getElementById('log'),inp=document.getElementById('in'),btn=document.getElementById('send'),st=document.getElementById('st');
let seen=0,token=localStorage.getItem('jt')||'';
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
async function api(p,o){const r=await fetch(p,{...o,headers:{'Content-Type':'application/json','x-jt':token}});return r.json()}
async function poll(){
 try{const d=await api('/api/state');
  if(d.token&&d.token!==token){token=d.token;localStorage.setItem('jt',token)}
  st.textContent=d.online?'online':'offline';
  for(const m of d.messages.slice(seen)){seen++;
   const div=document.createElement('div');
   div.className='msg '+(m.role==='user'?'user':'jarvis');
   div.textContent=m.text;log.appendChild(div)}
  log.scrollTop=log.scrollHeight;
 }catch(e){st.textContent='offline'}
 setTimeout(poll,1500)}
async function send(){const t=inp.value.trim();if(!t)return;inp.value='';btn.disabled=true;
 const d=document.createElement('div');d.className='msg user';d.textContent=t;log.appendChild(d);log.scrollTop=log.scrollHeight;
 try{await api('/api/chat',{method:'POST',body:JSON.stringify({text:t})})}catch{}
 btn.disabled=false;poll()}
btn.onclick=send;inp.onkeydown=e=>{if(e.key==='Enter')send()};
poll();
</script></body></html>`

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function start() {
  if (server) return
  const store = getStore()
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return
    }
    if (url.pathname.startsWith('/api/')) {
      const tok = req.headers['x-jt'] || url.searchParams.get('key') || ''
      // bootstrap: state endpoint issues the token on first contact (Tailscale/LAN only)
      if (url.pathname === '/api/state' && req.method === 'GET' && !tok) {
        const msgs = (store.state.messages['d-jarvis'] || [])
          .slice(-100).map(m => ({ role: m.userId === 'jarvis' ? 'jarvis' : 'user', text: m.text, ts: m.ts }))
        return json(res, 200, { messages: msgs, token: store.state.settings.mobileToken, online: true })
      }
      if (tok !== store.state.settings.mobileToken) return json(res, 401, { error: 'unauthorized' })
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const msgs = (store.state.messages['d-jarvis'] || [])
          .slice(-100).map(m => ({ role: m.userId === 'jarvis' ? 'jarvis' : 'user', text: m.text, ts: m.ts }))
        return json(res, 200, { messages: msgs, token: store.state.settings.mobileToken, online: true })
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        let body = ''
        req.on('data', c => body += c)
        req.on('end', async () => {
          try {
            const { text } = JSON.parse(body || '{}')
            if (!text?.trim()) return json(res, 400, { error: 'empty' })
            const reply = await assistant.handleMessage(text.trim(), 'mobile')
            json(res, 200, { reply })
          } catch (e) { json(res, 500, { error: e.message }) }
        })
        return
      }
      if (url.pathname === '/api/webhook' && req.method === 'POST') {
        let body = ''
        req.on('data', c => body += c)
        req.on('end', async () => {
          try {
            const { event, text } = JSON.parse(body || '{}')
            const reply = await assistant.handleMessage(text || `webhook event: ${event || 'ping'}`, 'webhook')
            json(res, 200, { reply })
          } catch (e) { json(res, 500, { error: e.message }) }
        })
        return
      }
      return json(res, 404, { error: 'not found' })
    }
    json(res, 404, { error: 'not found' })
  })
  server.listen(PORT, '0.0.0.0', () => {
    console.log('[mobile] Jarvis bridge on port', PORT)
    for (const n of lanIPs()) console.log(`[mobile] ${n.name}: http://${n.ip}:${PORT}`)
  })
}

module.exports = { start, lanIPs }

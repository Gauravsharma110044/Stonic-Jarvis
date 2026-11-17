import React, { useEffect, useState, useCallback, useRef } from 'react'
import TopBar from './components/TopBar.jsx'
import SideNav from './components/SideNav.jsx'
import StatusBar from './components/StatusBar.jsx'
import JarvisCore from './components/JarvisCore.jsx'
import ComposerBar from './components/ComposerBar.jsx'
import ActivityFeed from './components/ActivityFeed.jsx'
import MapPanel from './components/MapPanel.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import { MemoryPanel, PlaceholderPanel } from './components/Panels.jsx'
import { renderText } from './utils.jsx'

const CHANNEL_ID = 'd-jarvis'

export default function App() {
  const [state, setState] = useState(null)
  const [section, setSection] = useState('home')
  const [showSettings, setShowSettings] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [typing, setTyping] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [analyser, setAnalyser] = useState(null)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState(false)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState([])

  const recRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const spokenRef = useRef(new Set())
  const convoModeRef = useRef(false)
  const voiceOutputRef = useRef(false)
  const toggleMicRef = useRef(null)
  const errorTimer = useRef(null)
  const bottomRef = useRef(null)

  const refresh = useCallback(() => window.jarvis.snapshot().then(setState), [])

  // ---- data + window state ----
  useEffect(() => {
    refresh()
    window.jarvis.onUpdate(refresh)
    window.jarvis.onTyping(cid => {
      if (cid === CHANNEL_ID) {
        setTyping(true)
        setTimeout(() => setTyping(false), 8000)
      }
    })
    window.jarvis.winIsMaximized().then(setMaximized)
    window.jarvis.onMaximized(setMaximized)
  }, [refresh])

  const messages = state?.messages?.[CHANNEL_ID] || []
  const jarvis = state?.users?.find(u => u.id === 'jarvis')
  const me = state?.users?.find(u => u.id === 'you')
  const voiceOutput = !!state?.settings?.voiceOutput
  convoModeRef.current = !!state?.settings?.convoMode
  voiceOutputRef.current = voiceOutput

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, typing, listening])

  // ---- voice output: speak new Jarvis replies ----
  useEffect(() => {
    if (!voiceOutput || !('speechSynthesis' in window)) return
    const fresh = messages.filter(m => m.userId === 'jarvis' && !spokenRef.current.has(m.id))
    fresh.forEach(m => spokenRef.current.add(m.id))
    const last = fresh[fresh.length - 1]
    if (!last) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(last.text.replace(/[*`#]/g, ''))
    u.rate = 1.02
    u.onstart = () => setSpeaking(true)
    u.onend = () => {
      setSpeaking(false)
      if (convoModeRef.current && voiceOutputRef.current) {
        setTimeout(() => toggleMicRef.current?.(), 500)
      }
    }
    u.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(u)
    return () => { /* keep speaking state until onend */ }
  }, [messages, voiceOutput])

  // ---- voice input ----
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const micSupported = !!SR

  const stopMicTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setAnalyser(null)
  }, [])

  const toggleMic = useCallback(async () => {
    if (listening) {
      recRef.current?.stop()
      setListening(false); setInterim('')
      stopMicTracks()
      return
    }
    if (!SR) { flashError(); return }
    try {
      // mic stream for waveform visualizer
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const an = ctx.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      setAnalyser(an)

      const rec = new SR()
      rec.lang = 'en-US'
      rec.interimResults = true
      rec.continuous = false
      rec.onresult = (e) => {
        let interimText = '', finalText = ''
        for (const r of e.results) {
          if (r.isFinal) finalText += r[0].transcript
          else interimText += r[0].transcript
        }
        setInterim(interimText)
        if (finalText) {
          if (convoModeRef.current) {
            const t = finalText.trim()
            if (t) window.jarvis.sendMessage(CHANNEL_ID, t)
          } else {
            setText(t => (t ? t + ' ' : '') + finalText.trim())
          }
          setInterim('')
        }
      }
      rec.onend = () => { setListening(false); setInterim(''); stopMicTracks() }
      rec.onerror = () => { setListening(false); setInterim(''); stopMicTracks(); flashError() }
      recRef.current = rec
      rec.start()
      setListening(true)
    } catch {
      stopMicTracks()
      flashError()
    }
  }, [listening, SR, stopMicTracks])
  toggleMicRef.current = toggleMic

  function flashError() {
    setError(true)
    clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(false), 3500)
  }

  // ---- attachments ----
  const onFiles = useCallback(async (fileList) => {
    for (const f of Array.from(fileList || [])) {
      if (f.size > 100 * 1024) { flashError(); continue }
      try {
        const content = await f.text()
        setAttachments(a => [...a, { name: f.name, content: content.slice(0, 20000) }])
      } catch { flashError() }
    }
  }, [])

  const onRemoveAttachment = useCallback((i) => {
    setAttachments(a => a.filter((_, j) => j !== i))
  }, [])

  // ---- send ----
  const send = useCallback((raw) => {
    const t = (raw ?? text).trim()
    const hasAttach = attachments.length > 0
    if (!t && !hasAttach) return
    const context = hasAttach
      ? attachments.map(a => `--- ${a.name} ---\n${a.content}`).join('\n\n')
      : undefined
    const attachNames = hasAttach ? attachments.map(a => a.name) : undefined
    const display = t || '(see attached file)'
    window.jarvis.sendMessage(CHANNEL_ID, display, { context, attachNames })
    setText(''); setAttachments([]); setInterim('')
  }, [text, attachments])

  // ---- keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault(); document.getElementById('composer-input')?.focus()
      } else if (e.key === 'Escape') {
        document.activeElement?.blur?.()
      } else if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); setShowSettings(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const saveSettings = useCallback(async (patch) => {
    const s = await window.jarvis.setSettings(patch)
    setState(prev => prev ? { ...prev, settings: s } : prev)
  }, [])

  const onNav = useCallback((id) => {
    if (id === 'settings') setShowSettings(true)
    else setSection(id)
  }, [])

  if (!state) return <div className="boot" />

  const coreState = listening ? 'listening'
    : speaking ? 'speaking'
    : typing ? 'thinking'
    : error ? 'error'
    : 'idle'

  return (
    <div className="window">
      <TopBar section={section} onNav={onNav} maximized={maximized}
        onMin={() => window.jarvis.winMinimize()}
        onMax={() => window.jarvis.winToggleMaximize()}
        onClose={() => window.jarvis.winClose()} />
      <div className="body">
        <SideNav section={section} onNav={onNav} />
        <main className="center">
          {section === 'home' && (<>
            <div className="home-grid">
              <aside className="home-left">
                <MapPanel />
              </aside>
              <section className="home-mid">
                <JarvisCore state={coreState} analyser={analyser} size={170} />
                <div className="home-mid-sub">{coreState === 'idle' ? 'How can I assist you today?' : coreState}</div>
              </section>
              <section className="home-right">
                <div className="chat-scroll">
                {messages.map((m, i) => {
                  const mine = m.userId === 'you'
                  const showMeta = i === 0 || messages[i - 1].userId !== m.userId || m.ts - messages[i - 1].ts > 5 * 60000
                  return (
                    <div key={m.id} className={`msg-row ${mine ? 'mine' : ''}`}>
                      {showMeta ? (
                        m.userId === 'jarvis'
                          ? <img src="icon.png" className="msg-avatar" alt="" />
                          : <span className="msg-avatar you">YO</span>
                      ) : <span className="msg-avatar-gap" />}
                      <div className="msg-body">
                        {showMeta && (
                          <div className="msg-meta">
                            <span className="msg-name" style={{ color: mine ? 'var(--text)' : 'var(--cyan)' }}>
                              {mine ? 'You' : 'JARVIS'}
                            </span>
                            <span className="msg-time">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        )}
                        <div className="msg-text">{renderText(m.text)}</div>
                        {m.attachNames?.length > 0 && (
                          <div className="msg-attach">{m.attachNames.map(n => `📎 ${n}`).join('  ')}</div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {typing && (
                  <div className="msg-row">
                    <img src="icon.png" className="msg-avatar" alt="" />
                    <div className="msg-body">
                      <div className="thinking">
                        <span className="typing-dots"><span /><span /><span /></span>
                        Processing…
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
                <ComposerBar
                  value={text}
                  onChange={setText}
                  onSend={() => send()}
                  onMic={toggleMic}
                  listening={listening}
                  interim={interim}
                  micSupported={micSupported}
                  attachments={attachments}
                  onFiles={onFiles}
                  onRemoveAttachment={onRemoveAttachment}
                />
              </section>
            </div>
            <ActivityFeed />
          </>)}
          {section === 'memory' && <MemoryPanel />}
          {['apps', 'files', 'workspace'].includes(section) && <PlaceholderPanel kind={section} />}
        </main>
      </div>
      <StatusBar />
      {showSettings && (
        <SettingsModal
          settings={state.settings}
          slackStatus={null}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
    </div>
  )
}

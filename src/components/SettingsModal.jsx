import React, { useState, useEffect } from 'react'

export default function SettingsModal({ settings, slackStatus, onClose, onSave }) {
  const [form, setForm] = useState({ ...settings })
  const [status, setStatus] = useState(slackStatus)
  const [updateMsg, setUpdateMsg] = useState('')
  const [checking, setChecking] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const checkUpdates = async () => {
    setChecking(true); setUpdateMsg('')
    const r = await window.jarvis.updateCheck()
    setChecking(false)
    setUpdateMsg(r.ok
      ? (r.updateInfo ? `Update found: v${r.updateInfo.version} — downloading…` : 'You are on the latest version.')
      : r.reason)
  }

  useEffect(() => {
    window.jarvis.slackStatus().then(setStatus)
    const t = setInterval(() => window.jarvis.slackStatus().then(setStatus), 5000)
    return () => clearInterval(t)
  }, [])

  const save = async () => {
    await onSave(form)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="sub">Configure Jarvis AI and the Slack bridge.</div>

        <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>Jarvis AI (LLM)</h3>
        <div className="field">
          <label>Base URL</label>
          <input type="text" value={form.llmBaseUrl} onChange={e => set('llmBaseUrl', e.target.value)}
            placeholder="https://api.openai.com/v1" />
          <div className="hint">OpenAI, OpenRouter, NVIDIA NIM (https://integrate.api.nvidia.com/v1 — free models), Ollama (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1)</div>
        </div>
        <div className="field">
          <label>API Key</label>
          <input type="password" value={form.llmApiKey} onChange={e => set('llmApiKey', e.target.value)}
            placeholder="sk-... (leave empty for commands only)" />
        </div>
        <div className="field">
          <label>Default browser</label>
          <select value={form.defaultBrowser || 'auto'} onChange={e => set('defaultBrowser', e.target.value)}>
            <option value="auto">Auto-detect</option>
            <option value="brave">Brave</option>
            <option value="chrome">Chrome</option>
            <option value="edge">Edge</option>
            <option value="firefox">Firefox</option>
            <option value="opera">Opera</option>
          </select>
          <div className="hint">Used when you ask Jarvis to "open browser".</div>
        </div>

        <div className="field">
          <label>Model</label>
          <input type="text" value={form.llmModel} onChange={e => set('llmModel', e.target.value)}
            placeholder="gpt-4o-mini" />
        </div>

        <div className="field">
          <label>Vision model</label>
          <input type="text" value={form.visionModel || ''} onChange={e => set('visionModel', e.target.value)}
            placeholder="nvidia/nemotron-3.5-super-vl-120b-a12b" />
          <div className="hint">Used by see_screen. Must support image input.</div>
        </div>

        <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>Updates</h3>
        <div className="field">
          <button className="btn btn-ghost" onClick={checkUpdates} disabled={checking}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {updateMsg && <div className="hint" style={{ marginTop: 6 }}>{updateMsg}</div>}
          <div className="hint">Auto-update works in the installed app and needs a published update feed (latest.yml + installer on a static host or GitHub Releases).</div>
        </div>

        <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>Appearance</h3>
        <div className="field">
          <label>Accent color</label>
          <div className="accent-swatches">
            {['#57d9ff', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#f97316'].map(c => (
              <button key={c} type="button" className={`swatch ${form.uiAccent === c ? 'active' : ''}`}
                style={{ background: c }} onClick={() => set('uiAccent', c)} />
            ))}
            <input type="color" className="swatch-custom" value={form.uiAccent || '#57d9ff'}
              onChange={e => set('uiAccent', e.target.value)} title="Custom color" />
          </div>
        </div>
        <div className="field">
          <label>Density</label>
          <select value={form.uiDensity || 'comfortable'} onChange={e => set('uiDensity', e.target.value)}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </div>
        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>Animations</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Reactor pulses, message transitions, glow effects.</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={form.uiAnimations !== false} onChange={e => set('uiAnimations', e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <h3 style={{ fontSize: 13, margin: '16px 0 8px' }}>Slack bridge</h3>
        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>Enable Slack</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              Jarvis replies to @mentions and DMs in your Slack workspace.
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={!!form.slackEnabled} onChange={e => set('slackEnabled', e.target.checked)} />
            <span className="slider" />
          </label>
        </div>
        <div className="field">
          <label>Bot Token (xoxb-…)</label>
          <input type="password" value={form.slackBotToken} onChange={e => set('slackBotToken', e.target.value)} />
        </div>
        <div className="field">
          <label>App-Level Token (xapp-…)</label>
          <input type="password" value={form.slackAppToken} onChange={e => set('slackAppToken', e.target.value)} />
          <div className="hint">Needs <code>connections:write</code> scope. See SLACK_SETUP.md.</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <span className={`status-pill ${status?.connected ? 'on' : 'off'}`}>
            ● {status?.connected ? 'Connected to Slack' : status?.enabled ? 'Configured — not connected' : 'Slack disabled'}
          </span>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>Voice output</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Speak Jarvis replies aloud (uses system speech).</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={!!form.voiceOutput} onChange={e => set('voiceOutput', e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>Conversation mode</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>After Jarvis speaks, mic auto-restarts — hands-free voice loop.</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={!!form.convoMode} onChange={e => set('convoMode', e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>Speech-to-speech mode</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Local voice AI (whisper + piper) — speak, Jarvis replies with voice. Needs Python engine running.</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={!!form.s2sMode} onChange={e => set('s2sMode', e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>Demo activity</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Simulated teammate messages so the workspace feels alive.</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={!!form.demoActivity} onChange={e => set('demoActivity', e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

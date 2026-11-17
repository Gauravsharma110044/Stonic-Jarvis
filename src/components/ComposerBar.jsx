import React, { useRef } from 'react'

export default function ComposerBar({ value, onChange, onSend, onMic, listening, interim, micSupported,
  attachments, onFiles, onRemoveAttachment }) {
  const fileRef = useRef(null)
  const taRef = useRef(null)

  return (
    <div className="composer-wrap">
      {attachments.length > 0 && (
        <div className="attach-chips">
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip">
              📎 {a.name}
              <button onClick={() => onRemoveAttachment(i)}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className={`composer-bar ${listening ? 'listening' : ''}`}>
        <input ref={fileRef} type="file" multiple hidden
          accept=".txt,.md,.markdown,.json,.log,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yaml,.yml,.env,.sql,.sh"
          onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
        <button className="cbtn" title="Attach text file" onClick={() => fileRef.current?.click()}>📎</button>
        <button className={`cbtn mic ${listening ? 'on' : ''}`}
          title={micSupported ? (listening ? 'Stop listening' : 'Voice input') : 'Voice input unavailable'}
          disabled={!micSupported} onClick={onMic}>
          {listening ? '⏹' : '🎙'}
        </button>
        <textarea
          ref={taRef}
          id="composer-input"
          rows={1}
          placeholder={listening && interim ? interim : 'Ask me anything...'}
          value={listening && interim ? interim : value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
          }}
        />
        <button className="cbtn send" title="Send (Enter)" onClick={onSend} disabled={!value.trim() && !interim}>➤</button>
      </div>
      <div className="composer-hint">
        <b>Enter</b> send · <b>Shift+Enter</b> newline · <b>/</b> focus · <b>Esc</b> blur · <b>Ctrl+,</b> settings
      </div>
    </div>
  )
}

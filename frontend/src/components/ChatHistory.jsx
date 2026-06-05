import React, { useRef, useEffect, useState, useCallback } from 'react';
import './ChatHistory.css';

const QUICK = [
  'Draw a dog for me!',
  'Tell me about colors',
  'What can I draw next?',
  'Give me a challenge!',
];

// ── Speech utilities ──────────────────────────────────────────────────────────
const stripEmojis = (text) => {
  return text
    // Remove all emoji unicode ranges
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u2000-\u206F]/g, '')
    .replace(/[\u2700-\u27BF]/g, '')
    // Clean up extra spaces left behind
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const speak = (text) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const cleanText = stripEmojis(text);
  const utt = new SpeechSynthesisUtterance(cleanText);
  utt.rate  = 0.95;
  utt.pitch = 1.1;
  utt.volume = 1;
  // Prefer a friendly voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.name.includes('Samantha') || v.name.includes('Google UK English Female') || v.name.includes('Karen'));
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
};

const stopSpeaking = () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); };

export default function ChatHistory({ messages, onSendMessage, loading, sessionName }) {
  const [input,      setInput]      = useState('');
  const [listening,  setListening]  = useState(false);
  const [speakingId, setSpeakingId] = useState(null); // id of message being spoken
  const [voiceError, setVoiceError] = useState('');
  const bottomRef   = useRef(null);
  const recognizerRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-speak last assistant message when it arrives
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant') {
      setSpeakingId(last.id);
      speak(last.content);
    }
  }, [messages]);

  // Stop speaking when unmounted
  useEffect(() => () => stopSpeaking(), []);

  // ── Speech-to-text ──────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceError('Speech recognition not supported in this browser. Try Chrome.'); return; }

    stopSpeaking(); // stop Sparky so we can hear the child
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;

    rec.onstart  = () => { setListening(true); setVoiceError(''); };
    rec.onend    = () => setListening(false);
    rec.onerror  = (e) => { setListening(false); setVoiceError('Could not hear you. Try again!'); };
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput('');
      onSendMessage(transcript);
    };

    recognizerRef.current = rec;
    rec.start();
  }, [onSendMessage]);

  const stopListening = useCallback(() => {
    recognizerRef.current?.stop();
    setListening(false);
  }, []);

  // ── Send ────────────────────────────────────────────────────────────────────
  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    onSendMessage(text);
  };

  // ── Replay a message ────────────────────────────────────────────────────────
  const handleReplay = (msg) => {
    setSpeakingId(msg.id);
    speak(msg.content);
  };

  const formatTime = ts =>
    ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="chat-wrap">
      {/* Sparky header */}
      <div className="chat-sparky-bar">
        <div className="sparky-avi">🤖</div>
        <div className="sparky-info">
          <div className="sparky-name">Sparky AI</div>
          <div className="sparky-status"><span className="online-dot" />Your learning buddy!</div>
        </div>
        <button className="stop-voice-btn" onClick={stopSpeaking} title="Stop speaking">🔇</button>
      </div>

      {/* Messages */}
      <div className="messages-scroll">
        {messages.length === 0 && (
          <div className="chat-welcome fade-up">
            <div className="welcome-wave">👋</div>
            <p>Hey {sessionName || 'there'}! I'm Sparky! Ask me anything — you can also talk to me using the mic!</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={msg.id || i}
            className={`msg-row ${msg.role === 'user' ? 'msg-user' : 'msg-bot'} fade-up`}
            style={{ animationDelay: `${i * 0.03}s` }}>
            {msg.role === 'assistant' && <div className="bot-avi">🤖</div>}
            <div className="msg-bubble">
              <div className="msg-text">{msg.content}</div>
              {msg.steps && msg.steps.length > 0 && (
                <ol className="msg-steps">
                  {msg.steps.map((s, si) => (
                    <li key={si} className="msg-step-item">
                      <span className="msg-step-num">{si + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              )}
              {msg.colors && msg.colors.length > 0 && (
                <div className="msg-colors">
                  <span className="msg-colors-label">Colors:</span>
                  {msg.colors.map((c, ci) => (
                    <span key={ci} className="msg-color-tag">{c}</span>
                  ))}
                </div>
              )}
              {msg.closing && (
                <div className="msg-closing">{msg.closing}</div>
              )}
              <div className="msg-footer">
                <span className="msg-time">{formatTime(msg.created_at)}</span>
                {msg.role === 'assistant' && (
                  <button
                    className={`replay-btn ${speakingId === msg.id ? 'speaking' : ''}`}
                    onClick={() => handleReplay(msg)}
                    title="Read aloud">
                    {speakingId === msg.id ? '🔊' : '🔈'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="msg-row msg-bot fade-up">
            <div className="bot-avi">🤖</div>
            <div className="msg-bubble typing-bubble"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length < 3 && (
        <div className="quick-row">
          {QUICK.map((q, i) => (
            <button key={i} className="quick-chip" onClick={() => onSendMessage(q)}>{q}</button>
          ))}
        </div>
      )}

      {/* Voice error */}
      {voiceError && <div className="voice-error">{voiceError}</div>}

      {/* Listening indicator */}
      {listening && (
        <div className="listening-bar">
          <div className="listening-dots"><span /><span /><span /></div>
          <span>Listening... speak now!</span>
          <button onClick={stopListening} className="stop-listen-btn">Stop</button>
        </div>
      )}

      {/* Input row */}
      <div className="chat-input-bar">
        {/* Mic button */}
        <button
          className={`mic-btn ${listening ? 'active' : ''}`}
          onClick={listening ? stopListening : startListening}
          title={listening ? 'Stop listening' : 'Speak to Sparky'}
          disabled={loading}>
          {listening ? '⏹' : '🎤'}
        </button>

        <input className="chat-input" type="text"
          placeholder="Type or speak to Sparky... 💬"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled={loading || listening} />

        <button className="send-btn" onClick={handleSend}
          disabled={!input.trim() || loading}>
          {loading ? <span className="send-spinner" /> : '➤'}
        </button>
      </div>
    </div>
  );
}
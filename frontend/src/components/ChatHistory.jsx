import React, { useRef, useEffect, useState, useCallback } from 'react';
import './ChatHistory.css';

// ── Supported languages ───────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en-US', label: 'EN', flag: '🇺🇸', name: 'English' },
  { code: 'ta-IN', label: 'TA', flag: '🇮🇳', name: 'Tamil' },
  { code: 'hi-IN', label: 'HI', flag: '🇮🇳', name: 'Hindi' },
  { code: 'te-IN', label: 'TE', flag: '🇮🇳', name: 'Telugu' },
  { code: 'kn-IN', label: 'KN', flag: '🇮🇳', name: 'Kannada' },
  { code: 'ml-IN', label: 'ML', flag: '🇮🇳', name: 'Malayalam' },
  { code: 'mr-IN', label: 'MR', flag: '🇮🇳', name: 'Marathi' },
  { code: 'bn-IN', label: 'BN', flag: '🇮🇳', name: 'Bengali' },
  { code: 'gu-IN', label: 'GU', flag: '🇮🇳', name: 'Gujarati' },
  { code: 'pa-IN', label: 'PA', flag: '🇮🇳', name: 'Punjabi' },
  { code: 'es-ES', label: 'ES', flag: '🇪🇸', name: 'Spanish' },
  { code: 'fr-FR', label: 'FR', flag: '🇫🇷', name: 'French' },
  { code: 'de-DE', label: 'DE', flag: '🇩🇪', name: 'German' },
  { code: 'zh-CN', label: 'ZH', flag: '🇨🇳', name: 'Chinese' },
  { code: 'ar-SA', label: 'AR', flag: '🇸🇦', name: 'Arabic' },
  { code: 'ja-JP', label: 'JA', flag: '🇯🇵', name: 'Japanese' },
  { code: 'ko-KR', label: 'KO', flag: '🇰🇷', name: 'Korean' },
  { code: 'pt-BR', label: 'PT', flag: '🇧🇷', name: 'Portuguese' },
];

// Auto-detect browser/device language and find best match
const detectLanguage = () => {
  const browserLang = navigator.language || navigator.userLanguage || 'en-US';
  // Exact match first
  const exact = LANGUAGES.find(l => l.code === browserLang);
  if (exact) return exact.code;
  // Partial match (e.g. 'ta' matches 'ta-IN')
  const prefix = browserLang.split('-')[0].toLowerCase();
  const partial = LANGUAGES.find(l => l.code.toLowerCase().startsWith(prefix));
  if (partial) return partial.code;
  return 'en-US';
};

// Quick prompts per language
const QUICK_PROMPTS = {
  'en-US': ['Draw a dog for me!', 'Tell me about colors', 'What can I draw next?', 'Give me a challenge!'],
  'ta-IN': ['எனக்கு ஒரு நாயை வரையுங்கள்!', 'நிறங்களைப் பற்றி சொல்லுங்கள்', 'நான் அடுத்து என்ன வரையலாம்?', 'எனக்கு ஒரு சவாலை கொடுங்கள்!'],
  'hi-IN': ['मेरे लिए एक कुत्ता बनाओ!', 'रंगों के बारे में बताओ', 'मैं आगे क्या बना सकता हूं?', 'मुझे एक चुनौती दो!'],
  'te-IN': ['నాకు ఒక కుక్కను గీయండి!', 'రంగుల గురించి చెప్పండి', 'నేను తర్వాత ఏమి గీయగలను?', 'నాకు ఒక సవాలు ఇవ్వండి!'],
  'kn-IN': ['ನನಗೆ ಒಂದು ನಾಯಿ ಬಿಡಿ!', 'ಬಣ್ಣಗಳ ಬಗ್ಗೆ ಹೇಳಿ', 'ನಾನು ಮುಂದೆ ಏನು ಬರೆಯಬಹುದು?', 'ನನಗೆ ಒಂದು ಸವಾಲು ಕೊಡಿ!'],
  'ml-IN': ['എനിക്ക് ഒരു നായയെ വരയ്ക്കൂ!', 'നിറങ്ങളെക്കുറിച്ച് പറയൂ', 'ഞാൻ അടുത്തതായി എന്ത് വരയ്ക്കണം?', 'എനിക്ക് ഒരു വെല്ലുവിളി തരൂ!'],
  'es-ES': ['¡Dibuja un perro para mí!', 'Cuéntame sobre los colores', '¿Qué puedo dibujar después?', '¡Dame un desafío!'],
  'fr-FR': ['Dessine-moi un chien!', 'Parle-moi des couleurs', 'Que puis-je dessiner ensuite?', 'Donne-moi un défi!'],
  'de-DE': ['Zeichen mir einen Hund!', 'Erzähl mir von Farben', 'Was kann ich als nächstes zeichnen?', 'Gib mir eine Herausforderung!'],
  'zh-CN': ['给我画一只狗！', '告诉我关于颜色的事', '我接下来可以画什么？', '给我一个挑战！'],
  'ar-SA': ['ارسم لي كلبًا!', 'أخبرني عن الألوان', 'ماذا يمكنني رسمه بعد ذلك؟', 'تحدني!'],
  'ja-JP': ['犬を描いて！', '色について教えて', '次に何を描こう？', 'チャレンジをください！'],
  'ko-KR': ['강아지 그려줘!', '색깔에 대해 알려줘', '다음에 무엇을 그릴까?', '도전 과제 줘!'],
  'pt-BR': ['Desenha um cachorro para mim!', 'Me fala sobre as cores', 'O que posso desenhar a seguir?', 'Me dê um desafio!'],
};

const getQuickPrompts = (langCode) =>
  QUICK_PROMPTS[langCode] || QUICK_PROMPTS['en-US'];

// ── Speech utilities ──────────────────────────────────────────────────────────
const stripEmojis = (text) =>
  text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u2000-\u206F]/g, '')
    .replace(/[\u2700-\u27BF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

// Voices load asynchronously — wait for them then speak
const speakWithVoice = (text, langCode) => {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const cleanText = stripEmojis(text);
  if (!cleanText) return;

  const utt = new SpeechSynthesisUtterance(cleanText);
  utt.lang   = langCode;
  utt.rate   = 0.92;
  utt.pitch  = 1.1;
  utt.volume = 1;

  const assignVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return; // still loading

    const langPrefix = langCode.split('-')[0].toLowerCase();
    const countryCode = langCode.split('-')[1]?.toLowerCase();

    // Priority 1: exact lang+country match  e.g. "ta-IN"
    let voice = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase());

    // Priority 2: same language prefix + country  e.g. "ta" in "ta-IN"
    if (!voice) voice = voices.find(v =>
      v.lang.toLowerCase().startsWith(langPrefix) &&
      countryCode && v.lang.toLowerCase().includes(countryCode)
    );

    // Priority 3: any voice with same language prefix  e.g. "ta"
    if (!voice) voice = voices.find(v =>
      v.lang.toLowerCase().startsWith(langPrefix)
    );

    // Priority 4: Google voice for that language (Android Chrome)
    if (!voice) voice = voices.find(v =>
      v.name.toLowerCase().includes(langPrefix)
    );

    // Priority 5: fall back to any available voice and just set the lang
    // The browser will still TTS in the right language on most devices
    if (voice) utt.voice = voice;
    // If no voice found, don't assign — browser uses default but lang is set
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    // Voices already loaded (desktop / subsequent calls)
    assignVoice();
    window.speechSynthesis.speak(utt);
  } else {
    // Voices not ready yet (first load on mobile) — wait for the event
    const onVoicesChanged = () => {
      assignVoice();
      window.speechSynthesis.speak(utt);
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    // Fallback: speak after 300ms even if event never fires
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      if (!window.speechSynthesis.speaking) {
        window.speechSynthesis.speak(utt);
      }
    }, 300);
  }
};

const speak = (text, langCode = 'en-US') => speakWithVoice(text, langCode);
const stopSpeaking = () => { if (window.speechSynthesis) window.speechSynthesis.cancel(); };

export default function ChatHistory({ messages, onSendMessage, loading, sessionName, onLanguageChange }) {
  const [input,       setInput]       = useState('');
  const [listening,   setListening]   = useState(false);
  const [speakingId,  setSpeakingId]  = useState(null);
  const [voiceError,  setVoiceError]  = useState('');
  const [micLang,     setMicLang]     = useState(detectLanguage);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const bottomRef    = useRef(null);
  const recognizerRef = useRef(null);
  const langPickerRef = useRef(null);

  // Close lang picker when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target)) {
        setShowLangPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  // Pre-load voices on mount — mobile browsers load them lazily
  useEffect(() => {
    if (!window.speechSynthesis) return;
    // Trigger voice list load
    window.speechSynthesis.getVoices();
    const warmUp = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', warmUp);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', warmUp);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-speak last assistant message in selected language
  useEffect(() => {
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    if (last.role === 'assistant') {
      setSpeakingId(last.id);
      speak(last.content, micLang);
    }
  }, [messages]);

  // Stop speaking on unmount
  useEffect(() => () => stopSpeaking(), []);

  // ── Speech-to-text ──────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceError('Speech recognition not supported. Try Chrome.');
      return;
    }
    stopSpeaking();
    const rec = new SR();
    rec.lang           = micLang;   // ← uses selected language
    rec.continuous     = false;
    rec.interimResults = false;

    rec.onstart  = () => { setListening(true); setVoiceError(''); };
    rec.onend    = () => setListening(false);
    rec.onerror  = () => {
      setListening(false);
      setVoiceError('Could not hear you. Try again!');
    };
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput('');
      onSendMessage(transcript);
    };

    recognizerRef.current = rec;
    rec.start();
  }, [onSendMessage, micLang]);

  const stopListening = useCallback(() => {
    recognizerRef.current?.stop();
    setListening(false);
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    onSendMessage(text);
  };

  const handleReplay = (msg) => {
    setSpeakingId(msg.id);
    speak(msg.content, micLang);
  };

  const formatTime = ts =>
    ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const currentLang = LANGUAGES.find(l => l.code === micLang) || LANGUAGES[0];
  const quickPrompts = getQuickPrompts(micLang);

  return (
    <div className="chat-wrap">

      {/* ── Sparky header ── */}
      <div className="chat-sparky-bar">
        <div className="sparky-avi">🤖</div>
        <div className="sparky-info">
          <div className="sparky-name">Sparky AI</div>
          <div className="sparky-status">
            <span className="online-dot" />
            Your learning buddy!
          </div>
        </div>

        {/* Language picker trigger */}
        <div className="lang-picker-wrap" ref={langPickerRef}>
          <button
            className="lang-trigger-btn"
            onClick={() => setShowLangPicker(p => !p)}
            title={`Language: ${currentLang.name}`}
          >
            <span className="lang-flag">{currentLang.flag}</span>
            <span className="lang-code">{currentLang.label}</span>
            <span className="lang-arrow">{showLangPicker ? '▲' : '▼'}</span>
          </button>

          {/* Dropdown */}
          {showLangPicker && (
            <div className="lang-dropdown">
              <div className="lang-dropdown-title">🌐 Choose Language</div>
              <div className="lang-grid">
                {LANGUAGES.map(l => (
                  <button
                    key={l.code}
                    className={`lang-option${micLang === l.code ? ' active' : ''}`}
                    onClick={() => {
                      setMicLang(l.code);
                      setShowLangPicker(false);
                      onLanguageChange?.(l.code);   // ← notify WhiteboardPage
                    }}
                    title={l.name}
                  >
                    <span className="lang-option-flag">{l.flag}</span>
                    <span className="lang-option-label">{l.label}</span>
                    <span className="lang-option-name">{l.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button className="stop-voice-btn" onClick={stopSpeaking} title="Stop speaking">🔇</button>
      </div>

      {/* ── Messages ── */}
      <div className="messages-scroll">
        {messages.length === 0 && (
          <div className="chat-welcome fade-up">
            <div className="welcome-wave">👋</div>
            <p>
              Hey {sessionName || 'there'}! I'm Sparky!
              Ask me anything — you can also talk to me using the mic!
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={msg.id || i}
            className={`msg-row ${msg.role === 'user' ? 'msg-user' : 'msg-bot'} fade-up`}
            style={{ animationDelay: `${i * 0.03}s` }}
          >
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
              {msg.closing && <div className="msg-closing">{msg.closing}</div>}
              <div className="msg-footer">
                <span className="msg-time">{formatTime(msg.created_at)}</span>
                {msg.role === 'assistant' && (
                  <button
                    className={`replay-btn ${speakingId === msg.id ? 'speaking' : ''}`}
                    onClick={() => handleReplay(msg)}
                    title="Read aloud"
                  >
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

      {/* ── Quick prompts (language-aware) ── */}
      {messages.length < 3 && (
        <div className="quick-row">
          {quickPrompts.map((q, i) => (
            <button key={i} className="quick-chip" onClick={() => onSendMessage(q)}>
              {q}
            </button>
          ))}
        </div>
      )}

      {/* ── Voice error ── */}
      {voiceError && <div className="voice-error">{voiceError}</div>}

      {/* ── Listening indicator ── */}
      {listening && (
        <div className="listening-bar">
          <div className="listening-dots"><span /><span /><span /></div>
          <span>
            {currentLang.flag} Listening in {currentLang.name}...
          </span>
          <button onClick={stopListening} className="stop-listen-btn">Stop</button>
        </div>
      )}

      {/* ── Input row ── */}
      <div className="chat-input-bar">
        <button
          className={`mic-btn ${listening ? 'active' : ''}`}
          onClick={listening ? stopListening : startListening}
          title={listening ? 'Stop listening' : `Speak in ${currentLang.name}`}
          disabled={loading}
        >
          {listening ? '⏹' : '🎤'}
        </button>

        <input
          className="chat-input"
          type="text"
          placeholder={`Type or speak to Sparky... 💬`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          disabled={loading || listening}
        />

        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!input.trim() || loading}
        >
          {loading ? <span className="send-spinner" /> : '➤'}
        </button>
      </div>
    </div>
  );
}
import React, { useState, useEffect, useRef, useCallback } from 'react';
import DrawingCanvas from '../components/DrawingCanvas';
import PredictionPanel from '../components/PredictionPanel';
import ChatHistory from '../components/ChatHistory';
import {
  analyzeDrawing, sendChatMessage, saveDrawing,
  createSession, getSessionStats, getDrawingGuidance,
} from '../utils/api';
import './WhiteboardPage.css';

export default function WhiteboardPage() {
  const canvasRef   = useRef(null);

  // Reset mobile layout when resizing to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMobileView('canvas');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [session,      setSession]      = useState(null);
  const [messages,     setMessages]     = useState([]);
  const [prediction,   setPrediction]   = useState(null);
  const [predLoading,  setPredLoading]  = useState(false);
  const [chatLoading,  setChatLoading]  = useState(false);
  const [userText,     setUserText]     = useState('');
  const [activeTab,    setActiveTab]    = useState('prediction');
  const [stats,        setStats]        = useState({ drawings: 0, predictions: 0, chat_messages: 0 });
  const [showWelcome,  setShowWelcome]  = useState(true);
  const [childName,    setChildName]    = useState('');
  const [childAge,     setChildAge]     = useState(7);
  const [hasDrawing,   setHasDrawing]   = useState(false);
  const [mobileView,   setMobileView]   = useState('canvas');
  const [language,     setLanguage]     = useState('en-US');  // ← NEW: tracks selected language

  const startSession = async () => {
    try {
      const name = childName.trim() || 'Little Artist';
      const res = await createSession({ child_name: name, age: childAge });
      if (res.success && res.session) {
        setSession(res.session);
        setShowWelcome(false);
        setMessages([{
          id: 'welcome', role: 'assistant',
          content: `Hi ${name}! 🎨 I'm Sparky, your AI drawing buddy! Draw something and I'll guess what it is — or just chat with me anytime!`,
          created_at: new Date().toISOString(),
        }]);
      } else {
        alert('Could not create session. Is the backend running on port 5000?');
      }
    } catch {
      alert('Cannot connect to backend. Make sure the server is running on port 5000.');
    }
  };

  const refreshStats = useCallback(async () => {
    if (!session?.id) return;
    try {
      const r = await getSessionStats(session.id);
      if (r.success) setStats(r.stats);
    } catch {}
  }, [session]);

  useEffect(() => { if (session?.id) refreshStats(); }, [session, refreshStats]);

  const handleAnalyze = async () => {
    if (!session?.id || predLoading) return;

    const canvasData    = canvasRef.current?.getCanvasData();
    const traceHint     = canvasRef.current?.getTraceShape();
    const isBlank       = canvasRef.current?.isCanvasBlank?.() ?? true;
    const effectiveText = traceHint
      ? traceHint + (userText.trim() ? ` — ${userText.trim()}` : '')
      : userText;

    // ── Block if nothing to analyse ─────────────────────────────────────────
    // Use BOTH hasDrawing state AND isCanvasBlank as double guard
    // This ensures mobile (where refs may lag) is also caught
    const nothingDrawn = isBlank && !hasDrawing;
    const noText       = !effectiveText.trim();

    if (nothingDrawn && noText) {
      alert('✏️ Draw something first! Sparky needs a drawing to analyse.');
      return;
    }

    // If canvas is blank but user typed a description → text-only analysis, fine
    // Don't send a blank canvas image to the API — waste of tokens
    const sendCanvas = (!isBlank && hasDrawing) ? canvasData : null;

    // Extra safety: if sendCanvas is null AND no text, block (catches edge cases)
    if (!sendCanvas && noText) {
      alert('✏️ Draw something or describe what you want to draw!');
      return;
    }

    setPredLoading(true);
    setActiveTab('prediction');
    setMobileView('panel');

    try {
      if (sendCanvas) {
        await saveDrawing({ session_id: session.id, canvas_data: sendCanvas });
      }
      const res = await analyzeDrawing({
        session_id: session.id,
        canvas_data: sendCanvas,
        user_text: effectiveText,
        input_type: sendCanvas && effectiveText ? 'both' : sendCanvas ? 'drawing' : 'text',
        child_age: session.age || childAge,
        language,                              // ← pass language
      });
      if (res.success) {
        setPrediction({ result: res.result, id: res.prediction_id });
        setMessages(prev => [...prev, {
          id: res.prediction_id || Date.now().toString(),
          role: 'assistant',
          content: `I see a ${res.result.identified_object}! ${res.result.encouragement}`,
          created_at: new Date().toISOString(),
          message_type: 'prediction',
        }]);
        refreshStats();
      } else {
        alert('Oops! Sparky had trouble. Please try again.');
      }
    } catch {
      alert('Oops! Sparky had trouble. Please try again.');
    } finally {
      setPredLoading(false);
    }
  };

  // Detect "draw a X" / "draw X" / "how to draw X" requests
  const extractDrawSubject = (text) => {
    const t = text.trim().toLowerCase();
    const patterns = [
      /^(?:can you |please )?draw (?:a |an |me a |me an )?(.+?)[\?\!\.]*$/,
      /^(?:how (?:do i|to) draw(?: a| an)?) (.+?)[\?\!\.]*$/,
      /^(?:show me how to draw(?: a| an)?) (.+?)[\?\!\.]*$/,
      /^(?:teach me (?:to|how to) draw(?: a| an)?) (.+?)[\?\!\.]*$/,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return m[1].trim();
    }
    return null;
  };

  const handleChatMessage = async (text) => {
    if (!session?.id || chatLoading) return;
    setMessages(prev => [...prev, {
      id: Date.now().toString(), role: 'user',
      content: text, created_at: new Date().toISOString(),
    }]);
    setChatLoading(true);

    const drawSubject = extractDrawSubject(text);
    if (drawSubject) {
      try {
        const res = await getDrawingGuidance({
          object_name: drawSubject,
          child_age: session.age || childAge,
          session_id: session.id,
          language,                            // ← pass language
        });
        if (res.success && res.guidance) {
          const g = res.guidance;
          setMessages(prev => [...prev, {
            id: Date.now().toString(), role: 'assistant',
            content: `Here is how to draw a ${drawSubject}!`,
            steps: g.steps.map(s => `${s.instruction}${s.tip ? ' — ' + s.tip : ''}`),
            colors: g.color_palette || [],
            closing: g.final_encouragement || '',
            created_at: new Date().toISOString(),
          }]);
          setActiveTab('chat');
          setChatLoading(false);
          return;
        }
      } catch {}
    }

    try {
      const res = await sendChatMessage({
        session_id: session.id,
        message: text,
        child_age: session.age || childAge,
        language,                              // ← pass language
      });
      if (res.success) {
        setMessages(prev => [...prev, {
          id: res.assistant_message_id || Date.now().toString(),
          role: 'assistant', content: res.response, created_at: new Date().toISOString(),
        }]);
        refreshStats();
      }
    } catch {
      setMessages(prev => [...prev, {
        id: 'err-' + Date.now(), role: 'assistant',
        content: "Oops! I had a little trouble. Try again!",
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleClear = () => {
    canvasRef.current?.clearCanvas();
    setHasDrawing(false);
    setPrediction(null);
    setUserText('');
    setMobileView('canvas');
  };

  const handleNewSession = () => {
    setSession(null); setMessages([]); setPrediction(null);
    setUserText(''); setStats({ drawings: 0, predictions: 0, chat_messages: 0 });
    setChildName(''); setChildAge(7); setShowWelcome(true); setMobileView('canvas');
    setHasDrawing(false);
    canvasRef.current?.clearCanvas();
  };

  /* ── WELCOME ── */
  if (showWelcome) {
    return (
      <div className="welcome-screen">
        <div className="welcome-bg-blobs">
          <div className="blob blob1" /><div className="blob blob2" /><div className="blob blob3" />
        </div>
        <div className="welcome-card pop-in">
          <div className="welcome-mascot">
            <div className="mascot-circle">🤖</div>
            <div className="mascot-sparkle">✨</div>
          </div>
          <h1 className="welcome-title">AI Whiteboard</h1>
          <p className="welcome-sub">Your magical drawing &amp; learning companion!</p>
          <div className="welcome-form">
            <div className="form-field">
              <label>What's your name?</label>
              <input type="text" placeholder="Enter your name..."
                value={childName} onChange={e => setChildName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startSession()} autoFocus />
            </div>
            <div className="form-field">
              <label>How old are you?</label>
              <div className="age-grid">
                {[4,5,6,7,8,9,10,11,12].map(a => (
                  <button key={a} className={`age-btn ${childAge===a?'active':''}`}
                    onClick={() => setChildAge(a)}>{a}</button>
                ))}
              </div>
            </div>
            <button className="start-btn" onClick={startSession}>🚀 Start Drawing!</button>
          </div>
          <div className="welcome-chips">
            <span className="chip">✏️ Draw &amp; Create</span>
            <span className="chip">🤖 AI Magic</span>
            <span className="chip">📚 Learn &amp; Play</span>
          </div>
        </div>
      </div>
    );
  }

  /* ── MAIN APP ── */
  return (
    <div className="app-shell">

      {/* ── HEADER ── */}
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-icon">🎨</div>
          <div>
            <div className="brand-name">AI Whiteboard</div>
            <div className="brand-user">Hi, {session?.child_name}! 👋</div>
          </div>
        </div>
        <div className="header-stats">
          <div className="stat-pill"><span className="stat-icon">🖼️</span><span>{stats.drawings}</span><span className="stat-label">drawings</span></div>
          <div className="stat-pill"><span className="stat-icon">🤖</span><span>{stats.predictions}</span><span className="stat-label">predictions</span></div>
          <div className="stat-pill"><span className="stat-icon">💬</span><span>{stats.chat_messages}</span><span className="stat-label">chats</span></div>
        </div>
        <button className="new-session-btn" onClick={handleNewSession}>🔄 New</button>
      </header>

      {/* ── BODY ── */}
      <div className="main-layout">

        {/* Canvas section */}
        <div className={`canvas-section${mobileView === 'panel' ? ' mob-hide' : ''}`}>
          <div className="canvas-card">
            <DrawingCanvas ref={canvasRef}
              onDrawingChange={() => setHasDrawing(true)} />
          </div>
          <div className="canvas-controls">
            <input type="text" className="hint-input"
              placeholder="💬 Describe your drawing (optional)..."
              value={userText} onChange={e => setUserText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()} />
            <div className="ctrl-row">
              <button className="analyze-btn" onClick={handleAnalyze} disabled={predLoading}>
                {predLoading
                  ? <><span className="spinner" /> Analyzing...</>
                  : <><span>🔍</span> Analyze with AI</>}
              </button>
              <button className="clear-btn" onClick={handleClear}>🗑️ Clear</button>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className={`side-panel${mobileView === 'canvas' ? ' mob-hide' : ''}`}>
          <div className="side-tabs">
            <button className={`side-tab${activeTab==='prediction'?' active':''}`}
              onClick={() => setActiveTab('prediction')}>
              🤖 Prediction
            </button>
            <button className={`side-tab${activeTab==='chat'?' active':''}`}
              onClick={() => setActiveTab('chat')}>
              💬 Chat{messages.length > 0 && <span className="tab-badge">{messages.length}</span>}
            </button>
          </div>
          <div className="side-body">
            {activeTab === 'prediction' && <PredictionPanel prediction={prediction} loading={predLoading} />}
            {activeTab === 'chat'       && <ChatHistory messages={messages} onSendMessage={handleChatMessage} loading={chatLoading} sessionName={session?.child_name} onLanguageChange={setLanguage} />}
          </div>
        </div>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mob-nav">
        <button className={`mob-nav-btn${mobileView==='canvas'?' mob-active':''}`}
          onClick={() => setMobileView('canvas')}>
          <span className="mob-nav-icon">✏️</span>
          <span className="mob-nav-label">Draw</span>
        </button>

        <button className="mob-nav-btn mob-nav-center"
          onClick={handleAnalyze} disabled={predLoading}>
          <span className="mob-nav-icon">{predLoading ? '⏳' : '🔍'}</span>
          <span className="mob-nav-label">{predLoading ? 'Thinking…' : 'Analyze'}</span>
        </button>

        <button className={`mob-nav-btn${mobileView==='panel'?' mob-active':''}`}
          onClick={() => setMobileView('panel')}>
          <span className="mob-nav-icon">🤖</span>
          <span className="mob-nav-label">
            Sparky
            {(prediction || messages.length > 1) && <span className="mob-dot" />}
          </span>
        </button>
      </nav>

    </div>
  );
}
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
  const [language,     setLanguage]     = useState('en-US');
  const [refImage,     setRefImage]     = useState(null); // { url, label } shown in canvas corner

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

  // Detect drawing guidance requests in any phrasing
  const extractDrawSubject = (text) => {
    const t = text.trim().toLowerCase();
    const patterns = [
      /^(?:can you |please )?draw (?:a |an |me a |me an )?(.+?)[\?\!\.]*$/,
      /^(?:how (?:do i|to) draw(?: a| an)?) (.+?)[\?\!\.]*$/,
      /^(?:show me how to draw(?: a| an)?) (.+?)[\?\!\.]*$/,
      /^(?:teach me (?:to|how to) draw(?: a| an)?) (.+?)[\?\!\.]*$/,
      // NEW: "guide me to draw X", "guide me on drawing X"
      /^(?:guide me (?:to draw|on drawing|to|on)(?: a| an)?) (.+?)[\?\!\.]*$/,
      // NEW: "help me draw X"
      /^(?:help me (?:draw|to draw)(?: a| an)?) (.+?)[\?\!\.]*$/,
      // NEW: "I want to draw X"
      /^(?:i (?:want|would like) to draw(?: a| an)?) (.+?)[\?\!\.]*$/,
      // NEW: "steps to draw X"
      /^(?:steps (?:to|for) draw(?:ing)?(?: a| an)?) (.+?)[\?\!\.]*$/,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) return (m[1] || m[2] || '').trim();
    }
    return null;
  };

  // ── Reference image lookup ────────────────────────────────────────────────
  // Uses Wikimedia direct image URLs (no API call, no CORS) + emoji fallback
  const REF_IMAGES = {
    // Animals
    cat:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Kittyply_edit1.jpg/220px-Kittyply_edit1.jpg', emoji: '🐱' },
    dog:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/220px-YellowLabradorLooking_new.jpg', emoji: '🐶' },
    lion:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Lion_waiting_in_Namibia.jpg/220px-Lion_waiting_in_Namibia.jpg', emoji: '🦁' },
    rabbit:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Oryctolagus_cuniculus_Rcdo.jpg/220px-Oryctolagus_cuniculus_Rcdo.jpg', emoji: '🐰' },
    elephant:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/African_Bush_Elephant.jpg/220px-African_Bush_Elephant.jpg', emoji: '🐘' },
    penguin:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/South_Shetland-2016-Deception_Island%E2%80%93Chinstrap_penguin_%28Pygoscelis_antarctica%29_04.jpg/220px-South_Shetland-2016-Deception_Island%E2%80%93Chinstrap_penguin_%28Pygoscelis_antarctica%29_04.jpg', emoji: '🐧' },
    fish:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/220px-Camponotus_flavomarginatus_ant.jpg', emoji: '🐟' },
    bird:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/220px-Camponotus_flavomarginatus_ant.jpg', emoji: '🐦' },
    butterfly:   { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Monarch_Butterfly_Danaus_plexippus_Feeding_Down.jpg/220px-Monarch_Butterfly_Danaus_plexippus_Feeding_Down.jpg', emoji: '🦋' },
    owl:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Big_owl.jpg/220px-Big_owl.jpg', emoji: '🦉' },
    whale:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Humpback_Whale_underwater_shot.jpg/220px-Humpback_Whale_underwater_shot.jpg', emoji: '🐋' },
    turtle:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Florida_Box_Turtle_Digon3_re-edited.jpg/220px-Florida_Box_Turtle_Digon3_re-edited.jpg', emoji: '🐢' },
    dinosaur:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Diplodocus_Carnegie2.jpg/220px-Diplodocus_Carnegie2.jpg', emoji: '🦕' },
    fox:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Red_Fox_%28Vulpes_vulpes%29_-_British_Wildlife_Centre-3.jpg/220px-Red_Fox_%28Vulpes_vulpes%29_-_British_Wildlife_Centre-3.jpg', emoji: '🦊' },
    bear:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/ThreeGrizzlyBears.jpg/220px-ThreeGrizzlyBears.jpg', emoji: '🐻' },
    frog:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Anotheca_spinosa.jpg/220px-Anotheca_spinosa.jpg', emoji: '🐸' },
    // Nature
    tree:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/24701-nature-natural-beauty.jpg/220px-24701-nature-natural-beauty.jpg', emoji: '🌳' },
    flower:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Sunflower_from_Silesia2.jpg/220px-Sunflower_from_Silesia2.jpg', emoji: '🌸' },
    sun:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/The_Sun_by_the_Atmospheric_Imaging_Assembly_of_NASA%27s_Solar_Dynamics_Observatory_-_20100819.jpg/220px-The_Sun_by_the_Atmospheric_Imaging_Assembly_of_NASA%27s_Solar_Dynamics_Observatory_-_20100819.jpg', emoji: '☀️' },
    moon:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/FullMoon2010.jpg/220px-FullMoon2010.jpg', emoji: '🌙' },
    rainbow:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Double-alaskan-rainbow.jpg/220px-Double-alaskan-rainbow.jpg', emoji: '🌈' },
    cloud:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Above_Gotham.jpg/220px-Above_Gotham.jpg', emoji: '☁️' },
    mountain:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg/220px-Everest_North_Face_toward_Base_Camp_Tibet_Luca_Galuzzi_2006.jpg', emoji: '⛰️' },
    cactus:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Cactus_-_Desert_Botanical_Garden.jpg/220px-Cactus_-_Desert_Botanical_Garden.jpg', emoji: '🌵' },
    mushroom:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Amanita_muscaria_3_vliegenzwammen_op_rij.jpg/220px-Amanita_muscaria_3_vliegenzwammen_op_rij.jpg', emoji: '🍄' },
    leaf:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Quercus_robur_leaf_in_Eastwoodhill_Arboretum.jpg/220px-Quercus_robur_leaf_in_Eastwoodhill_Arboretum.jpg', emoji: '🍃' },
    // Food
    apple:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Red_Apple.jpg/220px-Red_Apple.jpg', emoji: '🍎' },
    banana:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Banana-Fruit-Pieces.jpg/220px-Banana-Fruit-Pieces.jpg', emoji: '🍌' },
    pizza:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Eq_it-na_pizza-margherita_sep2005_sml.jpg/220px-Eq_it-na_pizza-margherita_sep2005_sml.jpg', emoji: '🍕' },
    cake:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Baumkuchen_%28Juchheim%29.jpg/220px-Baumkuchen_%28Juchheim%29.jpg', emoji: '🎂' },
    watermelon:  { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_Watermelon_1.jpg/220px-PNG_Watermelon_1.jpg', emoji: '🍉' },
    donut:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Glazed-Donut.jpg/220px-Glazed-Donut.jpg', emoji: '🍩' },
    burger:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Grilled_Cheese_Bacon_Burger.jpg/220px-Grilled_Cheese_Bacon_Burger.jpg', emoji: '🍔' },
    'ice cream': { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Ice_Cream_dessert_02.jpg/220px-Ice_Cream_dessert_02.jpg', emoji: '🍦' },
    icecream:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Ice_Cream_dessert_02.jpg/220px-Ice_Cream_dessert_02.jpg', emoji: '🍦' },
    // Vehicles
    car:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/2019_Honda_Civic_%28FC%2C_facelift%2C_sedan%29_1.6_VTi_front_8.14.19.jpg/220px-2019_Honda_Civic_%28FC%2C_facelift%2C_sedan%29_1.6_VTi_front_8.14.19.jpg', emoji: '🚗' },
    bus:         { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Mk1metro.JPG/220px-Mk1metro.JPG', emoji: '🚌' },
    train:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Thomas_the_tank_engine_%26_friends_%2815600675248%29.jpg/220px-Thomas_the_tank_engine_%26_friends_%2815600675248%29.jpg', emoji: '🚂' },
    airplane:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/220px-PNG_transparency_demonstration_1.png', emoji: '✈️' },
    bicycle:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Bicycle_with_Rider.jpg/220px-Bicycle_with_Rider.jpg', emoji: '🚲' },
    boat:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Wooden_boat.jpg/220px-Wooden_boat.jpg', emoji: '⛵' },
    // Objects
    house:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Collage_of_Nine_Dogs.jpg/220px-Collage_of_Nine_Dogs.jpg', emoji: '🏠' },
    star:        { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/White_shark.jpg/220px-White_shark.jpg', emoji: '⭐' },
    heart:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Heart_coraz%C3%B3n.svg/220px-Heart_coraz%C3%B3n.svg.png', emoji: '❤️' },
    balloon:     { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Red_balloon_02.jpg/220px-Red_balloon_02.jpg', emoji: '🎈' },
    crown:       { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Golden_crown.jpg/220px-Golden_crown.jpg', emoji: '👑' },
    guitar:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/GuitareClassique5.png/220px-GuitareClassique5.png', emoji: '🎸' },
    umbrella:    { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Umbrella_-_black_-_open.jpg/220px-Umbrella_-_black_-_open.jpg', emoji: '☂️' },
    rocket:      { url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Rocket_man_alternative.jpg/220px-Rocket_man_alternative.jpg', emoji: '🚀' },
  };

  const fetchRefImage = async (subject) => {
    const key = subject.toLowerCase().trim();

    // 1. Check pre-mapped images first (instant, no API call)
    if (REF_IMAGES[key]) {
      setRefImage({ ...REF_IMAGES[key], label: subject });
      return;
    }

    // 2. Try partial match (e.g. "red apple" → "apple")
    const partialKey = Object.keys(REF_IMAGES).find(k => key.includes(k) || k.includes(key));
    if (partialKey) {
      setRefImage({ ...REF_IMAGES[partialKey], label: subject });
      return;
    }

    // 3. Fallback: Wikipedia REST API (works for many subjects)
    try {
      const res  = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject)}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = await res.json();
      if (data.thumbnail?.source) {
        setRefImage({ url: data.thumbnail.source, emoji: '📷', label: subject });
        return;
      }
    } catch {}

    // 4. Last fallback: just show emoji card with no image
    const emojiMap = { cat:'🐱',dog:'🐶',tree:'🌳',house:'🏠',sun:'☀️',moon:'🌙',
      flower:'🌸',fish:'🐟',bird:'🐦',apple:'🍎',banana:'🍌',car:'🚗',boat:'⛵' };
    const emoji = emojiMap[key] || '🎨';
    setRefImage({ url: null, emoji, label: subject });
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
          language,
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
          // Fetch and show reference image in canvas corner
          fetchRefImage(drawSubject);
          // Switch mobile view to canvas so child can see the reference image
          if (window.innerWidth <= 900) setMobileView('canvas');
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
    setRefImage(null);
  };

  const handleNewSession = () => {
    setSession(null); setMessages([]); setPrediction(null);
    setUserText(''); setStats({ drawings: 0, predictions: 0, chat_messages: 0 });
    setChildName(''); setChildAge(7); setShowWelcome(true); setMobileView('canvas');
    setHasDrawing(false);
    setRefImage(null);
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
            <DrawingCanvas
              ref={canvasRef}
              onDrawingChange={() => setHasDrawing(true)}
              refImage={refImage}
              onRefImageClose={() => setRefImage(null)}
            />
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
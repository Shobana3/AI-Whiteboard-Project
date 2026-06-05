"""
main.py — fixed version:
1. Single FastAPI app instance (was defined twice — killed all routes)
2. lifespan handler replaces deprecated @app.on_event('startup')
3. init_db() is now called on startup
4. async routes use asyncio.to_thread for blocking Groq calls
5. Global error handler so server never crashes
"""
import os
import json
import uuid
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from database import init_db, db_run, db_get, db_all
from ml_service import analyze_drawing, chat_with_ai, generate_drawing_guidance, generate_dot_to_dot

load_dotenv()


# ── Lifespan: runs init_db on startup, nothing extra on shutdown ───────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()                        # creates tables if they don't exist
    yield                            # server runs here
    # (add shutdown cleanup here if needed)


# ── Single app instance — defined ONCE with lifespan ──────────────────────────
app = FastAPI(title='AI Whiteboard API', version='2.0.0', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:3000', 'http://localhost:5173', '*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


# ── Global error handler — server never crashes on unhandled error ─────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f'Unhandled error on {request.url}: {exc}')
    return JSONResponse(
        status_code=500,
        content={'success': False, 'error': 'Server error. Please try again.'}
    )


# ── Models ─────────────────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    child_name: Optional[str] = 'Little Artist'
    age: Optional[int] = 6

class DrawingCreate(BaseModel):
    session_id: str
    canvas_data: str
    width: Optional[int] = 800
    height: Optional[int] = 500

class PredictRequest(BaseModel):
    session_id: str
    canvas_data: Optional[str] = None
    user_text: Optional[str] = ''
    input_type: Optional[str] = 'drawing'
    child_age: Optional[int] = 6

class ChatRequest(BaseModel):
    session_id: str
    message: str
    child_age: Optional[int] = 6

class GuidanceRequest(BaseModel):
    object_name: str
    child_age: Optional[int] = 6
    session_id: Optional[str] = None

class DotToDotRequest(BaseModel):
    object_name: str
    child_age: Optional[int] = 6
    session_id: Optional[str] = None


# ── Health ─────────────────────────────────────────────────────────────────────
@app.get('/health')
def health():
    return {'status': 'ok', 'message': '🎨 AI Whiteboard is running!'}


# ── Sessions ───────────────────────────────────────────────────────────────────
@app.post('/api/sessions')
def create_session(data: SessionCreate):
    try:
        session_id = str(uuid.uuid4())
        db_run(
            'INSERT INTO sessions (id, child_name, age) VALUES (?, ?, ?)',
            (session_id, data.child_name or 'Little Artist', data.age or 6)
        )
        return {'success': True, 'session': {
            'id': session_id,
            'child_name': data.child_name or 'Little Artist',
            'age': data.age or 6,
            'created_at': datetime.now().isoformat()
        }}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/sessions/{session_id}')
def get_session(session_id: str):
    session = db_get('SELECT * FROM sessions WHERE id = ?', (session_id,))
    if not session:
        raise HTTPException(status_code=404, detail='Session not found')
    return {'success': True, 'session': session}

@app.get('/api/sessions')
def get_all_sessions():
    sessions = db_all('SELECT * FROM sessions ORDER BY created_at DESC')
    return {'success': True, 'sessions': sessions}


# ── Drawings ───────────────────────────────────────────────────────────────────
@app.post('/api/drawings')
def save_drawing(data: DrawingCreate):
    try:
        drawing_id = str(uuid.uuid4())
        db_run(
            'INSERT INTO drawings (id, session_id, canvas_data, width, height) VALUES (?, ?, ?, ?, ?)',
            (drawing_id, data.session_id, data.canvas_data, data.width, data.height)
        )
        return {'success': True, 'drawing_id': drawing_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/api/drawings/session/{session_id}')
def get_drawings(session_id: str):
    drawings = db_all(
        'SELECT id, session_id, width, height, created_at FROM drawings WHERE session_id = ? ORDER BY created_at DESC',
        (session_id,)
    )
    return {'success': True, 'drawings': drawings}


# ── Predict ────────────────────────────────────────────────────────────────────
@app.post('/api/predict')
async def predict(data: PredictRequest):
    try:
        result = await asyncio.to_thread(
            analyze_drawing,
            data.canvas_data,
            data.user_text or '',
            data.child_age or 6
        )
        prediction_id = str(uuid.uuid4())
        db_run(
            '''INSERT INTO predictions
               (id, session_id, input_type, user_text, prediction_result, confidence_score)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (prediction_id, data.session_id,
             data.input_type or 'drawing',
             data.user_text or '',
             json.dumps(result),
             result.get('confidence', 0.0))
        )
        return {'success': True, 'result': result, 'prediction_id': prediction_id}
    except Exception as e:
        print(f'Predict error: {e}')
        raise HTTPException(status_code=500, detail='AI analysis failed. Please try again.')


# ── Chat ───────────────────────────────────────────────────────────────────────
@app.post('/api/chat')
async def chat(data: ChatRequest):
    try:
        msg_id = str(uuid.uuid4())
        db_run(
            'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
            (msg_id, data.session_id, 'user', data.message)
        )
        history = db_all(
            'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 6',
            (data.session_id,)
        )
        messages = list(reversed(history))
        response = await asyncio.to_thread(
            chat_with_ai,
            messages,
            data.child_age or 6
        )
        resp_id = str(uuid.uuid4())
        db_run(
            'INSERT INTO chat_messages (id, session_id, role, content) VALUES (?, ?, ?, ?)',
            (resp_id, data.session_id, 'assistant', response)
        )
        return {'success': True, 'response': response, 'assistant_message_id': resp_id}
    except Exception as e:
        print(f'Chat error: {e}')
        raise HTTPException(status_code=500, detail='Chat failed. Please try again.')


# ── Guidance ───────────────────────────────────────────────────────────────────
@app.post('/api/guidance')
async def guidance(data: GuidanceRequest):
    try:
        result = await asyncio.to_thread(
            generate_drawing_guidance,
            data.object_name,
            data.child_age or 6
        )
        return {'success': True, 'guidance': result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Dot-to-dot ─────────────────────────────────────────────────────────────────
@app.post('/api/dot-to-dot')
async def dot_to_dot(data: DotToDotRequest):
    try:
        result = await asyncio.to_thread(
            generate_dot_to_dot,
            data.object_name,
            data.child_age or 6
        )
        return {'success': True, 'dot_to_dot': result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Stats ──────────────────────────────────────────────────────────────────────
@app.get('/api/stats/session/{session_id}')
def get_stats(session_id: str):
    drawings    = db_get('SELECT COUNT(*) as c FROM drawings WHERE session_id = ?',    (session_id,))
    predictions = db_get('SELECT COUNT(*) as c FROM predictions WHERE session_id = ?', (session_id,))
    chats       = db_get('SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ? AND role = ?', (session_id, 'user'))
    return {'success': True, 'stats': {
        'drawings':      drawings['c']    if drawings    else 0,
        'predictions':   predictions['c'] if predictions else 0,
        'chat_messages': chats['c']       if chats       else 0,
    }}


# ── History ────────────────────────────────────────────────────────────────────
@app.get('/api/chat/session/{session_id}')
def get_chat_history(session_id: str, limit: int = 50):
    messages = db_all(
        'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?',
        (session_id, limit)
    )
    return {'success': True, 'messages': messages}

@app.get('/api/predictions/session/{session_id}')
def get_predictions(session_id: str):
    preds = db_all(
        'SELECT * FROM predictions WHERE session_id = ? ORDER BY created_at DESC',
        (session_id,)
    )
    return {'success': True, 'predictions': preds}


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
import sqlite3
import os
import time
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'whiteboard.db')

# How long to wait for a locked database before giving up (seconds)
DB_TIMEOUT = 10


def get_db():
    """
    Open a SQLite connection with:
    - WAL mode: multiple readers + one writer simultaneously
    - Timeout: wait up to 10s if DB is locked instead of crashing
    - Row factory: results come back as dicts not tuples
    """
    conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=10000')  # wait 10s on lock
    conn.execute('PRAGMA synchronous=NORMAL')   # faster writes, still safe
    conn.execute('PRAGMA cache_size=1000')      # cache 1000 pages in memory
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    """Create all tables on startup if they don't exist."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            child_name TEXT,
            age INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS drawings (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            canvas_data TEXT NOT NULL,
            width INTEGER DEFAULT 800,
            height INTEGER DEFAULT 500,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS predictions (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            drawing_id TEXT,
            input_type TEXT NOT NULL,
            user_text TEXT,
            prediction_result TEXT NOT NULL,
            confidence_score REAL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            message_type TEXT DEFAULT 'chat',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_drawings_session   ON drawings(session_id);
        CREATE INDEX IF NOT EXISTS idx_predictions_session ON predictions(session_id);
        CREATE INDEX IF NOT EXISTS idx_chat_session        ON chat_messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_chat_created        ON chat_messages(created_at);
    """)
    conn.commit()
    conn.close()
    print('✅ Database initialized')


def db_run(sql: str, params: tuple = (), retries: int = 3):
    """
    Execute INSERT / UPDATE / DELETE.
    Retries up to 3 times if the database is temporarily locked.
    """
    for attempt in range(retries):
        conn = get_db()
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            conn.commit()
            return cursor.lastrowid
        except sqlite3.OperationalError as e:
            conn.rollback()
            if 'locked' in str(e) and attempt < retries - 1:
                time.sleep(0.1 * (attempt + 1))  # wait 100ms, 200ms, ...
                continue
            raise
        finally:
            conn.close()


def db_get(sql: str, params: tuple = ()):
    """Execute SELECT and return first row as dict, or None."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def db_all(sql: str, params: tuple = ()):
    """Execute SELECT and return all rows as list of dicts."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()
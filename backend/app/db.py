"""SQLite connection helpers."""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from threading import Lock

from . import config

log = logging.getLogger(__name__)

_SCHEMA_PATH = Path(__file__).parent / "indexer" / "schema.sql"
_init_lock = Lock()
_initialized = False

SCHEMA_VERSION = 2
_reindex_requested = False


def get_conn() -> sqlite3.Connection:
    config.ensure_dirs()
    conn = sqlite3.connect(config.INDEX_DB, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn


def needs_reindex() -> bool:
    global _reindex_requested
    if _reindex_requested:
        _reindex_requested = False
        return True
    return False


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def _migrate(conn: sqlite3.Connection) -> None:
    """Idempotent ALTER-only migrations keyed by PRAGMA user_version."""
    global _reindex_requested
    cur_ver = conn.execute("PRAGMA user_version").fetchone()[0]
    if cur_ver >= SCHEMA_VERSION:
        return
    log.info("schema migration %d → %d", cur_ver, SCHEMA_VERSION)
    if cur_ver < 2:
        # Add cache token columns if not already present (fresh schema already has them).
        if not _column_exists(conn, "messages", "cache_creation_input_tokens"):
            conn.execute("ALTER TABLE messages ADD COLUMN cache_creation_input_tokens INTEGER")
        if not _column_exists(conn, "messages", "cache_read_input_tokens"):
            conn.execute("ALTER TABLE messages ADD COLUMN cache_read_input_tokens INTEGER")
        _reindex_requested = True
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    global _initialized
    with _init_lock:
        if _initialized:
            return
        sql = _SCHEMA_PATH.read_text()
        conn.executescript(sql)
        _migrate(conn)
        conn.commit()
        _initialized = True

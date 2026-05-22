"""Session detail endpoints."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException, Query

from ..db import get_conn
from ..indexer import jsonl_reader
from ..models import MessageRow, SessionDetail, SessionSummary
from .projects import _row_to_summary

router = APIRouter()


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: str,
    limit: int = Query(2000, ge=1, le=20000),
    offset: int = Query(0, ge=0),
    includeRaw: bool = Query(True),
) -> SessionDetail:
    conn = get_conn()
    s = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    if s is None:
        raise HTTPException(404, "session not found")
    msgs = conn.execute(
        """
        SELECT uuid, session_id, parent_uuid, ts, role, model, tool_name, cwd, git_branch,
               has_thinking, tokens_in, tokens_out, raw_offset, raw_length, preview
        FROM messages WHERE session_id = ?
        ORDER BY ts ASC, rowid ASC LIMIT ? OFFSET ?
        """,
        (session_id, limit, offset),
    ).fetchall()

    full_path = Path(s["full_path"])
    rows: list[MessageRow] = []
    if includeRaw and full_path.exists():
        # Bulk read sorted by offset for efficiency.
        sorted_msgs = sorted(msgs, key=lambda r: r["raw_offset"] or 0)
        with full_path.open("rb") as f:
            raw_map: dict[str, dict] = {}
            for r in sorted_msgs:
                if r["raw_offset"] is None:
                    continue
                f.seek(r["raw_offset"])
                blob = f.read(r["raw_length"])
                try:
                    raw_map[r["uuid"]] = json.loads(blob)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass
        for r in msgs:
            rows.append(_row(r, raw_map.get(r["uuid"])))
    else:
        for r in msgs:
            rows.append(_row(r, None))

    next_cursor = str(offset + len(msgs)) if len(msgs) == limit else None
    return SessionDetail(session=_row_to_summary(s), messages=rows, nextCursor=next_cursor)


@router.get("/sessions/{session_id}/raw")
def get_session_raw(session_id: str):
    from fastapi.responses import FileResponse

    conn = get_conn()
    r = conn.execute("SELECT full_path FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "session not found")
    return FileResponse(r["full_path"], media_type="application/x-ndjson")


@router.patch("/sessions/{session_id}")
def rename_session(session_id: str, body: dict = Body(...)) -> dict:
    """Update a session's summary (displayed as its title in the sidebar)."""
    summary = body.get("summary")
    if not isinstance(summary, str):
        raise HTTPException(400, "summary required")
    summary = summary.strip()[:200]
    conn = get_conn()
    cur = conn.execute("UPDATE sessions SET summary = ? WHERE session_id = ?", (summary, session_id))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "session not found")
    return {"ok": True, "summary": summary}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str) -> dict:
    """Delete a session: remove jsonl file + indexed rows."""
    conn = get_conn()
    r = conn.execute("SELECT full_path FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    if r is None:
        raise HTTPException(404, "session not found")
    full_path = Path(r["full_path"])
    try:
        if full_path.exists():
            full_path.unlink()
    except OSError as e:
        raise HTTPException(500, f"failed to delete file: {e}")
    # Also clean up FTS rows
    rowids = [row["rowid"] for row in conn.execute("SELECT rowid FROM messages WHERE session_id = ?", (session_id,)).fetchall()]
    if rowids:
        conn.executemany("DELETE FROM messages_fts WHERE rowid = ?", [(r,) for r in rowids])
    conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    return {"ok": True}


def _row(r, raw: dict | None) -> MessageRow:
    return MessageRow(
        uuid=r["uuid"],
        sessionId=r["session_id"],
        parentUuid=r["parent_uuid"],
        ts=r["ts"],
        role=r["role"],
        model=r["model"],
        toolName=r["tool_name"],
        cwd=r["cwd"],
        gitBranch=r["git_branch"],
        hasThinking=bool(r["has_thinking"]),
        tokensIn=r["tokens_in"],
        tokensOut=r["tokens_out"],
        preview=r["preview"],
        raw=raw,
    )

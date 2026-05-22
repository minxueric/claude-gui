"""Projects + sessions list endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .. import config
from ..db import get_conn
from ..models import ProjectInfo, SessionSummary

router = APIRouter()


def _decode_cwd(encoded: str) -> str:
    return "/" + encoded.lstrip("-").replace("-", "/")


@router.get("/projects", response_model=list[ProjectInfo])
def list_projects() -> list[ProjectInfo]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT p.encoded, p.cwd, p.last_modified, COUNT(s.session_id) AS cnt
        FROM projects p LEFT JOIN sessions s ON s.encoded_project = p.encoded
        GROUP BY p.encoded ORDER BY p.last_modified DESC NULLS LAST
        """
    ).fetchall()
    return [
        ProjectInfo(
            encoded=r["encoded"],
            cwd=r["cwd"] or _decode_cwd(r["encoded"]),
            sessionCount=r["cnt"] or 0,
            lastModified=r["last_modified"],
        )
        for r in rows
    ]


@router.get("/projects/{encoded}/sessions", response_model=list[SessionSummary])
def list_sessions(
    encoded: str,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    q: str | None = None,
) -> list[SessionSummary]:
    conn = get_conn()
    sql = "SELECT * FROM sessions WHERE encoded_project = ?"
    params: list = [encoded]
    if q:
        sql += " AND (first_prompt LIKE ? OR summary LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    sql += f" ORDER BY modified {'DESC' if order == 'desc' else 'ASC'} NULLS LAST LIMIT ? OFFSET ?"
    params += [limit, offset]
    rows = conn.execute(sql, params).fetchall()
    return [_row_to_summary(r) for r in rows]


@router.get("/sessions", response_model=list[SessionSummary])
def list_recent_sessions(limit: int = Query(40, ge=1, le=200)) -> list[SessionSummary]:
    """Most-recently modified sessions across all projects."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM sessions ORDER BY modified DESC NULLS LAST LIMIT ?",
        (limit,),
    ).fetchall()
    return [_row_to_summary(r) for r in rows]


def _row_to_summary(r) -> SessionSummary:
    return SessionSummary(
        sessionId=r["session_id"],
        encodedProject=r["encoded_project"],
        firstPrompt=r["first_prompt"],
        summary=r["summary"],
        messageCount=r["message_count"],
        created=r["created"],
        modified=r["modified"],
        gitBranch=r["git_branch"],
        projectPath=r["project_path"],
        isSidechain=bool(r["is_sidechain"]),
    )

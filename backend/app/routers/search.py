"""FTS5 search endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import get_conn
from ..models import SearchHit, SearchResponse

router = APIRouter()


def _sanitize_fts(q: str) -> str:
    # If user supplied operators, trust them; else build a safe prefix query.
    if any(ch in q for ch in '"*:()'):
        return q
    out: list[str] = []
    for tok in q.split():
        # Drop characters that have special meaning in FTS5 bareword tokens.
        cleaned = "".join(ch for ch in tok if ch.isalnum() or ch in "_-")
        if cleaned:
            out.append(f"{cleaned}*")
    return " ".join(out) if out else q


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1),
    project: str | None = None,
    role: str | None = None,
    model: str | None = None,
    tool: str | None = None,
    fromTs: float | None = None,
    toTs: float | None = None,
    gitBranch: str | None = None,
    hasThinking: bool | None = None,
    hasToolUse: bool | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> SearchResponse:
    conn = get_conn()
    fts = _sanitize_fts(q)

    where = ["messages_fts MATCH ?"]
    params: list = [fts]
    if project:
        where.append("s.encoded_project = ?")
        params.append(project)
    if role:
        where.append("m.role = ?")
        params.append(role)
    if model:
        where.append("m.model = ?")
        params.append(model)
    if tool:
        where.append("m.tool_name = ?")
        params.append(tool)
    if fromTs is not None:
        where.append("m.ts >= ?")
        params.append(fromTs)
    if toTs is not None:
        where.append("m.ts <= ?")
        params.append(toTs)
    if gitBranch:
        where.append("m.git_branch = ?")
        params.append(gitBranch)
    if hasThinking is not None:
        where.append("m.has_thinking = ?")
        params.append(1 if hasThinking else 0)
    if hasToolUse:
        where.append("m.tool_name IS NOT NULL")

    where_sql = " AND ".join(where)

    total = conn.execute(
        f"""
        SELECT COUNT(*) FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        JOIN sessions s ON s.session_id = m.session_id
        WHERE {where_sql}
        """,
        params,
    ).fetchone()[0]

    rows = conn.execute(
        f"""
        SELECT m.uuid, m.session_id, m.ts, m.role, m.tool_name, s.first_prompt, s.encoded_project,
               snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snip
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        JOIN sessions s ON s.session_id = m.session_id
        WHERE {where_sql}
        ORDER BY m.ts DESC
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    hits = [
        SearchHit(
            sessionId=r["session_id"],
            uuid=r["uuid"],
            ts=r["ts"],
            role=r["role"],
            toolName=r["tool_name"],
            snippet=r["snip"],
            sessionFirstPrompt=r["first_prompt"],
            encodedProject=r["encoded_project"],
        )
        for r in rows
    ]
    return SearchResponse(total=total, hits=hits)


@router.get("/search/facets")
def facets(project: str | None = None) -> dict:
    """Return distinct values for filter dropdowns."""
    conn = get_conn()
    join = "FROM messages m"
    where = ""
    params: list = []
    if project:
        join += " JOIN sessions s ON s.session_id = m.session_id"
        where = " AND s.encoded_project = ?"
        params = [project]
    models = [r[0] for r in conn.execute(
        f"SELECT DISTINCT m.model {join} WHERE m.model IS NOT NULL{where}", params,
    )]
    tools = [r[0] for r in conn.execute(
        f"SELECT DISTINCT m.tool_name {join} WHERE m.tool_name IS NOT NULL{where}", params,
    )]
    branches = [r[0] for r in conn.execute(
        f"SELECT DISTINCT m.git_branch {join} WHERE m.git_branch IS NOT NULL{where}", params,
    )]
    roles = [r[0] for r in conn.execute("SELECT DISTINCT role FROM messages WHERE role IS NOT NULL")]
    return {"models": sorted(models), "tools": sorted(tools), "branches": sorted(branches), "roles": sorted(roles)}

"""Index scanner: full + incremental sync of ~/.claude/projects → SQLite/FTS5."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Iterable

from .. import config
from ..db import get_conn
from . import jsonl_reader

log = logging.getLogger(__name__)


def _to_epoch(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Heuristic: treat large numbers as ms.
        return value / 1000.0 if value > 1e12 else float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def _is_meta_prompt(text: str | None) -> bool:
    """Detect CLI-injected meta prompts that should not be used as a title."""
    if not text:
        return True
    t = text.strip()
    if not t:
        return True
    # Claude Code injects synthetic prompts wrapped in tags like
    # <local-command-stdout>, <local-command-caveat>, <command-name>, etc.
    if t.startswith("<local-command-") or t.startswith("<command-"):
        return True
    if t.startswith("<system-reminder>") or t.startswith("<persisted-output>"):
        return True
    # Slash-command echoes start with a bare slash
    if t.startswith("/") and len(t.split()) <= 2:
        return True
    return False


def _decode_cwd(encoded: str) -> str:
    # Claude Code encodes cwd by replacing "/" with "-" (preserving leading slash as "-").
    return "/" + encoded.lstrip("-").replace("-", "/")


def list_projects() -> list[Path]:
    if not config.PROJECTS_DIR.exists():
        return []
    return [p for p in config.PROJECTS_DIR.iterdir() if p.is_dir()]


def index_session_file(conn, encoded_project: str, jsonl_path: Path, session_meta: dict | None = None) -> int:
    """Re-index a single session jsonl file. Returns rows inserted."""
    session_id = jsonl_path.stem
    file_mtime = jsonl_path.stat().st_mtime

    cur = conn.cursor()
    # Preserve any user-set summary across re-indexing.
    prev = cur.execute("SELECT summary FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
    existing_summary = prev["summary"] if prev else None
    # Wipe prior rows for this session.
    cur.execute("SELECT rowid FROM messages WHERE session_id = ?", (session_id,))
    old_rowids = [r[0] for r in cur.fetchall()]
    if old_rowids:
        cur.executemany("DELETE FROM messages_fts WHERE rowid = ?", [(r,) for r in old_rowids])
        cur.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))

    meta = session_meta or {}

    # First pass: parse jsonl entries and derive fallbacks (firstPrompt, cwd, gitBranch, ts).
    msg_rows: list[tuple] = []
    derived_first_prompt: str | None = None
    derived_assistant_summary: str | None = None
    derived_cwd: str | None = None
    derived_branch: str | None = None
    first_ts: float | None = None
    last_ts: float | None = None

    for entry in jsonl_reader.iter_jsonl(jsonl_path):
        d = entry.data
        uuid = d.get("uuid") or d.get("messageId")
        if not uuid:
            continue
        info = jsonl_reader.classify(d)
        ts = _to_epoch(d.get("timestamp"))
        if ts is not None:
            if first_ts is None or ts < first_ts:
                first_ts = ts
            if last_ts is None or ts > last_ts:
                last_ts = ts
        if derived_cwd is None and d.get("cwd"):
            derived_cwd = d.get("cwd")
        if derived_branch is None and d.get("gitBranch"):
            derived_branch = d.get("gitBranch")
        if derived_first_prompt is None and info["role"] == "user":
            preview = jsonl_reader.extract_preview(d, max_chars=200)
            if preview and not _is_meta_prompt(preview):
                derived_first_prompt = preview.strip()
        if derived_assistant_summary is None and info["role"] == "assistant":
            ap = jsonl_reader.extract_preview(d, max_chars=120)
            if ap and ap.strip():
                # Skip tool-only assistant messages (no human-readable text)
                tap = ap.strip()
                if not tap.startswith("{") and tap != "(no content)":
                    # Take the first non-empty line, strip markdown bullets/headers
                    first_line = next((ln.strip().lstrip("#- *>") for ln in tap.split("\n") if ln.strip()), "")
                    if first_line:
                        derived_assistant_summary = first_line[:80]
        text = jsonl_reader.extract_text_for_index(d, cap=config.FTS_TEXT_CAP)
        preview = jsonl_reader.extract_preview(d)
        msg_rows.append(
            (
                uuid,
                session_id,
                d.get("parentUuid"),
                ts,
                info["role"],
                info["model"],
                info["tool_name"],
                d.get("cwd"),
                d.get("gitBranch"),
                info["has_thinking"],
                info["tokens_in"],
                info["tokens_out"],
                info["cache_creation_input_tokens"],
                info["cache_read_input_tokens"],
                entry.raw_offset,
                entry.raw_length,
                preview,
                text,  # carry text alongside for FTS step
            )
        )

    # Upsert session row with meta + derived fallbacks.
    first_prompt = meta.get("firstPrompt") or derived_first_prompt
    # Title heuristic:
    #   1. existing user-set summary in DB (preserve renames)
    #   2. summary from sessions-index.json meta
    #   3. first assistant reply first line (skips tool-only / synthetic msgs)
    #   4. firstPrompt (truncated)
    summary = (
        existing_summary
        or meta.get("summary")
        or derived_assistant_summary
        or (first_prompt[:80] if first_prompt else None)
    )
    project_path = meta.get("projectPath") or derived_cwd or _decode_cwd(encoded_project)
    git_branch = meta.get("gitBranch") or derived_branch
    message_count = meta.get("messageCount") or len(msg_rows)
    created = _to_epoch(meta.get("created")) or first_ts
    modified = _to_epoch(meta.get("modified")) or last_ts or file_mtime

    cur.execute(
        """
        INSERT INTO sessions (session_id, encoded_project, full_path, first_prompt, summary,
                              message_count, created, modified, file_mtime, git_branch,
                              project_path, is_sidechain)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(session_id) DO UPDATE SET
            encoded_project=excluded.encoded_project,
            full_path=excluded.full_path,
            first_prompt=excluded.first_prompt,
            summary=excluded.summary,
            message_count=excluded.message_count,
            created=excluded.created,
            modified=excluded.modified,
            file_mtime=excluded.file_mtime,
            git_branch=excluded.git_branch,
            project_path=excluded.project_path,
            is_sidechain=excluded.is_sidechain
        """,
        (
            session_id,
            encoded_project,
            str(jsonl_path),
            first_prompt,
            summary,
            message_count,
            created,
            modified,
            file_mtime,
            git_branch,
            project_path,
            1 if meta.get("isSidechain") else 0,
        ),
    )

    inserted = 0
    fts_rows: list[tuple] = []

    if msg_rows:
        for row in msg_rows:
            cur.execute(
                """
                INSERT OR IGNORE INTO messages (uuid, session_id, parent_uuid, ts, role, model,
                                                tool_name, cwd, git_branch, has_thinking,
                                                tokens_in, tokens_out,
                                                cache_creation_input_tokens, cache_read_input_tokens,
                                                raw_offset, raw_length, preview)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                row[:-1],
            )
            if cur.rowcount:
                rowid = cur.lastrowid
                fts_rows.append((rowid, row[-1]))
                inserted += 1
        cur.executemany("INSERT INTO messages_fts (rowid, text) VALUES (?, ?)", fts_rows)

    conn.commit()
    return inserted


def _read_index_json(idx_path: Path) -> dict[str, dict]:
    try:
        data = json.loads(idx_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {e["sessionId"]: e for e in data.get("entries", []) if "sessionId" in e}


def sync_project(conn, project_dir: Path) -> int:
    """Sync a single project directory. Returns number of newly indexed files."""
    encoded = project_dir.name
    idx_path = project_dir / "sessions-index.json"
    meta_map = _read_index_json(idx_path)

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO projects (encoded, cwd, last_modified) VALUES (?,?,?)
        ON CONFLICT(encoded) DO UPDATE SET cwd=excluded.cwd, last_modified=excluded.last_modified
        """,
        (encoded, _decode_cwd(encoded), project_dir.stat().st_mtime),
    )
    conn.commit()

    indexed_files = 0
    for jsonl_path in project_dir.glob("*.jsonl"):
        session_id = jsonl_path.stem
        file_mtime = jsonl_path.stat().st_mtime
        cur.execute("SELECT file_mtime FROM sessions WHERE session_id = ?", (session_id,))
        row = cur.fetchone()
        if row and row[0] is not None and abs(row[0] - file_mtime) < 1e-6:
            continue
        try:
            index_session_file(conn, encoded, jsonl_path, meta_map.get(session_id))
            indexed_files += 1
        except Exception as e:  # noqa: BLE001
            log.warning("index failed for %s: %s", jsonl_path, e)

    # Refresh project cwd from the most recent session's project_path.
    row = cur.execute(
        "SELECT project_path FROM sessions WHERE encoded_project = ? AND project_path IS NOT NULL "
        "ORDER BY modified DESC LIMIT 1",
        (encoded,),
    ).fetchone()
    if row and row[0]:
        cur.execute("UPDATE projects SET cwd = ? WHERE encoded = ?", (row[0], encoded))
        conn.commit()
    return indexed_files


def full_sync() -> dict:
    start = time.time()
    conn = get_conn()
    total_files = 0
    projects = list_projects()
    for p in projects:
        total_files += sync_project(conn, p)
    elapsed = time.time() - start
    log.info("indexed %d files across %d projects in %.2fs", total_files, len(projects), elapsed)
    return {"projects": len(projects), "indexed_files": total_files, "elapsed": elapsed}


def sync_path(changed_path: Path) -> None:
    """Re-sync the project that contains a changed file."""
    try:
        rel = changed_path.relative_to(config.PROJECTS_DIR)
    except ValueError:
        return
    if not rel.parts:
        return
    project_dir = config.PROJECTS_DIR / rel.parts[0]
    if project_dir.is_dir():
        conn = get_conn()
        sync_project(conn, project_dir)

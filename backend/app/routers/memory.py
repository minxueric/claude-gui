"""CLAUDE.md memory editor.

Endpoints:
  - GET  /memory?cwd=...          read project + user CLAUDE.md
  - POST /memory/append           append a single line (the `#` prefix flow)
  - PUT  /memory                  overwrite project or user CLAUDE.md

Sandboxing: project CLAUDE.md must live under the supplied cwd (resolved).
User CLAUDE.md lives at ~/.claude/CLAUDE.md (only).
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config

router = APIRouter()

MAX_MEMORY_BYTES = 256 * 1024
MAX_LINE_LENGTH = 2000


class MemoryDoc(BaseModel):
    scope: Literal["project", "user"]
    path: str
    exists: bool
    text: str


class MemoryResponse(BaseModel):
    project: Optional[MemoryDoc] = None
    user: MemoryDoc


def _user_path() -> Path:
    return config.CLAUDE_HOME / "CLAUDE.md"


def _project_path(cwd: str) -> Path:
    base = Path(cwd).expanduser().resolve(strict=True)
    if not base.is_dir():
        raise HTTPException(400, "cwd is not a directory")
    target = (base / "CLAUDE.md").resolve()
    # ensure no symlink escape
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(403, "path escapes cwd")
    return target


def _read_doc(scope: Literal["project", "user"], path: Path) -> MemoryDoc:
    if path.exists() and path.is_file():
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            text = ""
        return MemoryDoc(scope=scope, path=str(path), exists=True, text=text[:MAX_MEMORY_BYTES])
    return MemoryDoc(scope=scope, path=str(path), exists=False, text="")


@router.get("/memory", response_model=MemoryResponse)
def get_memory(cwd: str = "") -> MemoryResponse:
    user_doc = _read_doc("user", _user_path())
    project_doc = None
    if cwd:
        try:
            project_doc = _read_doc("project", _project_path(cwd))
        except HTTPException:
            project_doc = None
    return MemoryResponse(project=project_doc, user=user_doc)


class AppendRequest(BaseModel):
    cwd: str
    line: str
    scope: Literal["project", "user"] = "project"


@router.post("/memory/append")
def append_memory(req: AppendRequest) -> dict:
    line = req.line.strip()
    if not line:
        raise HTTPException(400, "empty line")
    if len(line) > MAX_LINE_LENGTH:
        raise HTTPException(400, "line too long")
    if req.scope == "user":
        target = _user_path()
    else:
        target = _project_path(req.cwd)
    target.parent.mkdir(parents=True, exist_ok=True)
    existing = ""
    if target.exists():
        try:
            existing = target.read_text(encoding="utf-8", errors="replace")
        except Exception:
            existing = ""
    if len(existing.encode("utf-8")) + len(line.encode("utf-8")) + 2 > MAX_MEMORY_BYTES:
        raise HTTPException(413, "memory file is full")
    sep = "" if existing.endswith("\n") or not existing else "\n"
    target.write_text(existing + sep + line + "\n", encoding="utf-8")
    return {"ok": True, "path": str(target)}


class SaveRequest(BaseModel):
    cwd: str
    scope: Literal["project", "user"]
    text: str


@router.put("/memory")
def save_memory(req: SaveRequest) -> dict:
    if len(req.text.encode("utf-8")) > MAX_MEMORY_BYTES:
        raise HTTPException(413, "text too large")
    if req.scope == "user":
        target = _user_path()
    else:
        target = _project_path(req.cwd)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(req.text, encoding="utf-8")
    return {"ok": True, "path": str(target)}

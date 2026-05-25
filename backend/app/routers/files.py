"""File system access constrained to a chosen project cwd.

Three endpoints:
  - GET /files/tree?cwd=...&path=...     shallow directory listing
  - GET /files/match?cwd=...&q=...       fuzzy match (for @-mentions)
  - GET /files/read?cwd=...&path=...     bounded read for diffing

Every path is resolved with `Path.resolve()` and asserted to be relative to the
caller-supplied `cwd` (also resolved). Symlink escape is rejected.
"""
from __future__ import annotations

import base64
import mimetypes
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()

MAX_READ_BYTES = 256 * 1024
MAX_TREE_ENTRIES = 5000
MAX_MATCH_RESULTS = 50

IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache",
    ".pytest_cache", "dist", "build", ".next", ".turbo", ".ruff_cache",
    ".idea", ".vscode", "target",
}


def _decode_cwd(cwd: str, encoding: str = "") -> str:
    if encoding == "base64":
        try:
            return base64.b64decode(cwd).decode("utf-8")
        except Exception:
            raise HTTPException(400, "invalid base64 cwd")
    return cwd


def _safe_resolve(cwd: str, sub: str = "") -> Path:
    if not cwd:
        raise HTTPException(400, "cwd required")
    try:
        base = Path(cwd).expanduser().resolve(strict=True)
    except Exception:
        raise HTTPException(400, f"cwd not found: {cwd}")
    if not base.is_dir():
        raise HTTPException(400, "cwd is not a directory")
    target = (base / sub).resolve() if sub else base
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(403, "path escapes cwd")
    return target


class TreeEntry(BaseModel):
    name: str
    path: str  # relative to cwd
    isDir: bool
    size: Optional[int] = None
    modified: Optional[float] = None


class TreeResponse(BaseModel):
    cwd: str
    path: str
    entries: list[TreeEntry]


@router.get("/files/pick-folder")
def pick_folder() -> dict:
    """Open a native OS folder-picker dialog and return the chosen path."""
    import subprocess, sys
    # Use osascript on macOS for a native Finder folder picker
    if sys.platform == "darwin":
        script = 'POSIX path of (choose folder with prompt "Select working directory")'
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            # User cancelled
            return {"path": None}
        path = result.stdout.strip().rstrip("/")
        return {"path": path}
    # Fallback: tkinter
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", True)
        path = filedialog.askdirectory(title="Select working directory")
        root.destroy()
        return {"path": path or None}
    except Exception as e:
        raise HTTPException(500, f"folder picker failed: {e}")


@router.get("/files/browse")
def browse(path: str = Query("~")) -> dict:
    """List directories at an arbitrary filesystem path, for an in-app
    folder picker UI. Returns only sub-directories (files filtered out)."""
    try:
        target = Path(path).expanduser().resolve()
    except Exception:
        raise HTTPException(400, "invalid path")
    if not target.exists():
        raise HTTPException(404, "path not found")
    if not target.is_dir():
        raise HTTPException(400, "not a directory")
    entries: list[dict] = []
    try:
        for child in sorted(target.iterdir(), key=lambda p: p.name.lower()):
            if not child.is_dir():
                continue
            # skip well-known noise dirs
            if child.name.startswith(".") and child.name not in {".claude", ".config"}:
                continue
            if child.name in IGNORE_DIRS:
                continue
            entries.append({"name": child.name, "path": str(child)})
    except PermissionError:
        raise HTTPException(403, "permission denied")
    parent = str(target.parent) if str(target) != "/" else None
    return {
        "path": str(target),
        "parent": parent,
        "home": str(Path.home()),
        "entries": entries,
    }



@router.get("/files/tree", response_model=TreeResponse)
def tree(cwd: str = Query(...), path: str = Query(""), encoding: str = Query("")) -> TreeResponse:
    cwd = _decode_cwd(cwd, encoding)
    base = Path(cwd).expanduser().resolve()
    target = _safe_resolve(cwd, path)
    if not target.is_dir():
        raise HTTPException(400, "not a directory")
    entries: list[TreeEntry] = []
    try:
        for child in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name in IGNORE_DIRS:
                continue
            if child.name.startswith("."):
                # Allow dotfiles but skip the very common opaque ones
                if child.name in {".DS_Store"}:
                    continue
            try:
                st = child.stat()
            except Exception:
                continue
            entries.append(
                TreeEntry(
                    name=child.name,
                    path=str(child.relative_to(base)),
                    isDir=child.is_dir(),
                    size=st.st_size if child.is_file() else None,
                    modified=st.st_mtime,
                )
            )
            if len(entries) >= MAX_TREE_ENTRIES:
                break
    except PermissionError:
        raise HTTPException(403, "permission denied")
    return TreeResponse(cwd=str(base), path=str(target.relative_to(base)), entries=entries)


class FileMatch(BaseModel):
    path: str
    name: str
    isDir: bool
    score: int


def _walk(base: Path, limit: int = 20000):
    count = 0
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS and not d.startswith(".git")]
        for d in dirs:
            yield Path(root) / d, True
            count += 1
            if count >= limit:
                return
        for f in files:
            if f.startswith(".") and f in {".DS_Store"}:
                continue
            yield Path(root) / f, False
            count += 1
            if count >= limit:
                return


def _fuzzy_score(name: str, path: str, q: str) -> int:
    """Higher = better. 0 means no match."""
    if not q:
        return 1
    ql = q.lower()
    nl = name.lower()
    pl = path.lower()
    score = 0
    if nl == ql:
        score += 200
    if nl.startswith(ql):
        score += 80
    if ql in nl:
        score += 50
    if ql in pl:
        score += 20
    # subsequence match
    j = 0
    for ch in pl:
        if j < len(ql) and ch == ql[j]:
            j += 1
    if j == len(ql):
        score += 10
        # bonus for early hit
        first = pl.find(ql[0])
        if first >= 0:
            score += max(0, 10 - first)
    return score


@router.get("/files/match", response_model=list[FileMatch])
def match(cwd: str = Query(...), q: str = Query(""), limit: int = Query(MAX_MATCH_RESULTS, ge=1, le=100), encoding: str = Query("")) -> list[FileMatch]:
    cwd = _decode_cwd(cwd, encoding)
    base = Path(cwd).expanduser().resolve()
    if not base.is_dir():
        raise HTTPException(400, "cwd not a directory")
    out: list[FileMatch] = []
    for p, is_dir in _walk(base):
        try:
            rel = str(p.relative_to(base))
        except ValueError:
            continue
        s = _fuzzy_score(p.name, rel, q)
        if s <= 0:
            continue
        out.append(FileMatch(path=rel, name=p.name, isDir=is_dir, score=s))
    out.sort(key=lambda m: (-m.score, len(m.path), m.path))
    return out[:limit]


class FileReadResponse(BaseModel):
    cwd: str
    path: str
    size: int
    truncated: bool
    text: str


MAX_RAW_BYTES = 20 * 1024 * 1024  # 20 MB cap for binary (pdf, image) raw responses


@router.get("/files/read")
def read(
    cwd: str = Query(...),
    path: str = Query(...),
    encoding: str = Query(""),
    raw: int = Query(0),
):
    cwd = _decode_cwd(cwd, encoding)
    base = Path(cwd).expanduser().resolve()
    target = _safe_resolve(cwd, path)
    if target.is_dir():
        raise HTTPException(400, "is a directory")
    try:
        size = target.stat().st_size
    except FileNotFoundError:
        raise HTTPException(404, "file not found")

    if raw:
        # Stream the raw file bytes with a sensible Content-Type so browsers
        # can render PDFs in an <iframe>, images directly, etc.
        if size > MAX_RAW_BYTES:
            raise HTTPException(413, f"file too large for raw response ({size} bytes)")
        media_type, _ = mimetypes.guess_type(target.name)
        return FileResponse(
            target,
            media_type=media_type or "application/octet-stream",
            filename=target.name,
        )

    # JSON text response (truncated UTF-8)
    truncated = size > MAX_READ_BYTES
    try:
        with target.open("rb") as f:
            data = f.read(MAX_READ_BYTES)
    except PermissionError:
        raise HTTPException(403, "permission denied")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("utf-8", errors="replace")
    return FileReadResponse(
        cwd=str(base),
        path=str(target.relative_to(base)),
        size=size,
        truncated=truncated,
        text=text,
    )


@router.post("/files/reveal")
def reveal(payload: dict = Body(...)) -> dict:
    """Reveal a file/folder in the OS file manager (Finder on macOS)."""
    cwd_in = payload.get("cwd", "")
    path_in = payload.get("path", "")
    encoding = payload.get("encoding", "")
    cwd = _decode_cwd(cwd_in, encoding)
    target = _safe_resolve(cwd, path_in)
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", "-R", str(target)], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", str(target.parent)], check=False)
        elif sys.platform == "win32":
            subprocess.run(["explorer", "/select,", str(target)], check=False)
        else:
            raise HTTPException(501, "unsupported platform")
    except FileNotFoundError as e:
        raise HTTPException(500, f"reveal failed: {e}")
    return {"ok": True}

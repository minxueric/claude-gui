"""Tasks: walk ~/.claude/tasks/{uuid}/ subdirectories."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import config
from ..models import TaskNode

router = APIRouter()

MAX_BYTES = 1_000_000


@router.get("/tasks", response_model=list[TaskNode])
def list_tasks() -> list[TaskNode]:
    if not config.TASKS_DIR.exists():
        return []
    out: list[TaskNode] = []
    for d in sorted(config.TASKS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if d.is_dir():
            out.append(_node(d, depth=1))
    return out


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> TaskNode:
    p = config.TASKS_DIR / task_id
    if not p.exists() or not p.is_dir():
        raise HTTPException(404, "task not found")
    return _node(p, depth=4)


@router.get("/tasks/{task_id}/file")
def read_file(task_id: str, path: str) -> dict:
    base = (config.TASKS_DIR / task_id).resolve()
    target = (base / path).resolve()
    if not str(target).startswith(str(base)):
        raise HTTPException(400, "path escape")
    if not target.is_file():
        raise HTTPException(404, "file not found")
    size = target.stat().st_size
    if size > MAX_BYTES:
        return {"truncated": True, "size": size, "content": target.read_bytes()[:MAX_BYTES].decode("utf-8", errors="replace")}
    return {"truncated": False, "size": size, "content": target.read_text(errors="replace")}


def _node(p: Path, depth: int) -> TaskNode:
    st = p.stat()
    children = None
    if p.is_dir() and depth > 0:
        children = []
        for c in sorted(p.iterdir()):
            children.append(_node(c, depth - 1))
    return TaskNode(
        name=p.name,
        path=str(p.relative_to(config.TASKS_DIR)),
        isDir=p.is_dir(),
        modified=st.st_mtime,
        size=st.st_size if p.is_file() else None,
        children=children,
    )

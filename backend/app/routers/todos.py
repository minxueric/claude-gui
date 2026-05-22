"""Todos endpoint — aggregates ~/.claude/todos/*.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter

from .. import config
from ..models import TodoItem, TodosFile

router = APIRouter()

_AGENT_RE = re.compile(r"-agent-(?P<agent>[0-9a-f-]{36})\.json$")


@router.get("/todos", response_model=list[TodosFile])
def list_todos() -> list[TodosFile]:
    if not config.TODOS_DIR.exists():
        return []
    out: list[TodosFile] = []
    for f in sorted(config.TODOS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(f.read_text() or "[]")
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, list):
            continue
        m = _AGENT_RE.search(f.name)
        out.append(
            TodosFile(
                file=f.name,
                agentId=m.group("agent") if m else None,
                modified=f.stat().st_mtime,
                todos=[
                    TodoItem(
                        id=str(item.get("id")) if item.get("id") is not None else None,
                        subject=item.get("subject") or item.get("content"),
                        description=item.get("description"),
                        status=item.get("status"),
                        activeForm=item.get("activeForm"),
                    )
                    for item in data
                    if isinstance(item, dict)
                ],
            )
        )
    return out

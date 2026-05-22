"""Chat router: SSE stream + REST control."""
from __future__ import annotations

import asyncio
import json
import logging
import time

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from ..config import PROJECTS_DIR
from ..db import get_conn
from ..indexer import scanner
from ..models import (
    ChatEffortRequest,
    ChatInputRequest,
    ChatPermissionModeRequest,
    ChatPermissionRequest,
    ChatStartRequest,
    ChatStartResponse,
)
from ..services.claude_session import registry

router = APIRouter()

log = logging.getLogger(__name__)


# A jsonl file modified within this window is treated as a live CLI session.
# Generous window so CLI sessions that are idle (waiting for user input)
# don't drop off — they still represent a usable, resumable conversation.
LIVE_WINDOW_SEC = 300


@router.get("/chat/active")
async def active_sessions() -> dict:
    result = []
    seen_session_ids: set[str] = set()
    # GUI-managed sessions (this backend's own registry)
    for chat_id, s in registry.sessions.items():
        result.append({"chatId": chat_id, "sessionId": s.session_id, "source": "gui"})
        if s.session_id:
            seen_session_ids.add(s.session_id)
    # CLI sessions detected by recent jsonl mtime
    cutoff = time.time() - LIVE_WINDOW_SEC
    if PROJECTS_DIR.exists():
        for proj in PROJECTS_DIR.iterdir():
            if not proj.is_dir():
                continue
            for jsonl in proj.glob("*.jsonl"):
                try:
                    if jsonl.stat().st_mtime < cutoff:
                        continue
                except OSError:
                    continue
                sid = jsonl.stem
                if sid in seen_session_ids:
                    continue
                seen_session_ids.add(sid)
                result.append({"chatId": None, "sessionId": sid, "source": "cli"})
    return {"sessions": result}


@router.post("/chat/sessions", response_model=ChatStartResponse)
async def start_chat(req: ChatStartRequest) -> ChatStartResponse:
    s = await registry.create(
        cwd=req.cwd,
        resume=req.resume,
        model=req.model,
        permission_mode=req.permissionMode,
        allowed_tools=req.allowedTools,
        system_prompt=req.systemPrompt,
        effort=req.effort,
    )
    # Make sure the project dir is indexed right away so a brand-new cwd
    # shows up in the sidebar without waiting for the watcher debounce
    # cycle (or the first jsonl write).
    if req.cwd:
        encoded = "-" + req.cwd.lstrip("/").replace("/", "-")
        proj_dir = PROJECTS_DIR / encoded
        if proj_dir.exists():
            try:
                scanner.sync_project(get_conn(), proj_dir)
            except Exception:  # noqa: BLE001
                log.exception("post-create sync_project failed for %s", proj_dir)
    return ChatStartResponse(chatId=s.chat_id)


@router.post("/chat/{chat_id}/input")
async def send_input(chat_id: str, req: ChatInputRequest) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    await s.send(req.content)
    return {"ok": True}


@router.post("/chat/{chat_id}/permission")
async def respond_permission(chat_id: str, req: ChatPermissionRequest) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    ok = await s.respond_permission(req.requestId, req.decision, req.updatedInput, req.message or "")
    return {"ok": ok}


@router.post("/chat/{chat_id}/permission_mode")
async def set_mode(chat_id: str, req: ChatPermissionModeRequest) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    ok = await s.set_permission_mode(req.mode)
    return {"ok": ok, "mode": s.permission_mode}


@router.post("/chat/{chat_id}/effort")
async def set_effort(chat_id: str, req: ChatEffortRequest) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    s.effort = req.effort or None
    return {"ok": True, "effort": s.effort}


@router.get("/chat/{chat_id}/usage")
async def usage(chat_id: str) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    return s._usage_snapshot()


@router.get("/chat/{chat_id}/mcp")
async def mcp(chat_id: str) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    status = await s.get_mcp_status()
    return {"status": status, "available": status is not None}


@router.post("/chat/{chat_id}/interrupt")
async def interrupt(chat_id: str) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    await s.interrupt()
    return {"ok": True}


@router.delete("/chat/{chat_id}")
async def delete_chat(chat_id: str) -> dict:
    await registry.remove(chat_id)
    return {"ok": True}


@router.get("/chat/{chat_id}/stream")
async def stream(chat_id: str):
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")

    async def gen():
        try:
            while True:
                try:
                    evt = await asyncio.wait_for(s.queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                try:
                    data_str = json.dumps(evt.get("data", {}), ensure_ascii=False, default=str)
                except Exception as e:
                    data_str = json.dumps({"_serialization_error": str(e)})
                yield {"event": evt["event"], "data": data_str}
                # `done` is a soft turn-boundary signal: do NOT close the
                # stream — the SDK pump keeps running for subsequent turns.
                # Only fatal errors should terminate the SSE generator.
        except asyncio.CancelledError:
            return

    return EventSourceResponse(gen())

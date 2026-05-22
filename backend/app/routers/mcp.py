"""MCP router: list configured MCP servers + live status from an active chat."""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import config
from ..services.claude_session import registry

log = logging.getLogger(__name__)
router = APIRouter()


def _read_settings() -> dict[str, Any]:
    f = config.SETTINGS_FILE
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        log.warning("failed to parse %s", f)
        return {}


@router.get("/mcp/servers")
def list_servers() -> dict:
    """Servers configured in ~/.claude/settings.json (best-effort)."""
    data = _read_settings()
    servers_obj = data.get("mcpServers") or data.get("mcp_servers") or {}
    servers: list[dict] = []
    if isinstance(servers_obj, dict):
        for name, cfg in servers_obj.items():
            if not isinstance(cfg, dict):
                continue
            servers.append(
                {
                    "name": name,
                    "command": cfg.get("command"),
                    "args": cfg.get("args") or [],
                    "url": cfg.get("url"),
                    "transport": cfg.get("transport") or ("stdio" if cfg.get("command") else "http"),
                }
            )
    return {"settingsFile": str(config.SETTINGS_FILE), "servers": servers}


@router.get("/mcp/status/{chat_id}")
async def chat_mcp_status(chat_id: str) -> dict:
    s = registry.get(chat_id)
    if s is None:
        raise HTTPException(404, "chat not found")
    status = await s.get_mcp_status()
    return {"status": status, "available": status is not None}

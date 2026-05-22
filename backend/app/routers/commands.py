"""Slash-command discovery.

Walks two directories for markdown slash-command definitions:
  - global:  ~/.claude/commands/**/*.md
  - project: <cwd>/.claude/commands/**/*.md

Each file may have YAML front-matter (`---\nkey: value\n---`) with optional
keys: `description`, `argument-hint`, `allowed-tools`. The body is the prompt
template; the frontend substitutes `$ARGUMENTS` before sending.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from .. import config

router = APIRouter()


class SlashCommand(BaseModel):
    name: str            # without leading slash, e.g. "review-pr"
    scope: str           # "user" | "project" | "builtin"
    source: str          # absolute path of file (empty for builtin)
    description: Optional[str] = None
    argumentHint: Optional[str] = None
    allowedTools: Optional[list[str]] = None
    body: str = ""


BUILTINS: list[SlashCommand] = [
    SlashCommand(name="clear", scope="builtin", source="", description="Clear the current conversation"),
    SlashCommand(name="compact", scope="builtin", source="", description="Compact the conversation"),
    SlashCommand(name="help", scope="builtin", source="", description="Show help"),
    SlashCommand(name="model", scope="builtin", source="", description="Change the active model"),
    SlashCommand(name="memory", scope="builtin", source="", description="Open the memory editor"),
    SlashCommand(name="cost", scope="builtin", source="", description="Show token / cost usage"),
    SlashCommand(name="reset", scope="builtin", source="", description="Reset the chat session"),
]


def _parse_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    header = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    meta: dict = {}
    # tiny YAML-ish parser — sufficient for the small surface area we expect
    for line in header.splitlines():
        line = line.rstrip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        k = k.strip()
        v = v.strip()
        if v.startswith("[") and v.endswith("]"):
            inner = v[1:-1].strip()
            items = [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()]
            meta[k] = items
        else:
            v = v.strip('"').strip("'")
            meta[k] = v
    return meta, body


def _scan_dir(root: Path, scope: str) -> list[SlashCommand]:
    out: list[SlashCommand] = []
    if not root.is_dir():
        return out
    try:
        for p in sorted(root.rglob("*.md")):
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            meta, body = _parse_front_matter(text)
            rel = p.relative_to(root).with_suffix("")
            name = ":".join(rel.parts)
            out.append(
                SlashCommand(
                    name=name,
                    scope=scope,
                    source=str(p),
                    description=meta.get("description"),
                    argumentHint=meta.get("argument-hint") or meta.get("argumentHint"),
                    allowedTools=(
                        meta.get("allowed-tools")
                        if isinstance(meta.get("allowed-tools"), list)
                        else None
                    ),
                    body=body,
                )
            )
    except Exception:
        pass
    return out


@router.get("/commands", response_model=list[SlashCommand])
def list_commands(cwd: str = Query("")) -> list[SlashCommand]:
    user_root = config.CLAUDE_HOME / "commands"
    items: list[SlashCommand] = list(BUILTINS)
    items.extend(_scan_dir(user_root, "user"))
    if cwd:
        try:
            proj_root = Path(cwd).expanduser().resolve() / ".claude" / "commands"
            items.extend(_scan_dir(proj_root, "project"))
        except Exception:
            pass
    # de-dup by (scope,name) preserving first occurrence
    seen: set[tuple[str, str]] = set()
    deduped: list[SlashCommand] = []
    for c in items:
        key = (c.scope, c.name)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(c)
    return deduped

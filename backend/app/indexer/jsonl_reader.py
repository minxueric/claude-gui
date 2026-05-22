"""Streaming JSONL parser for Claude Code session logs.

Yields one record per line with byte offsets so the API can re-fetch raw bytes.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


@dataclass
class JsonlEntry:
    raw_offset: int
    raw_length: int
    data: dict


def iter_jsonl(path: Path) -> Iterator[JsonlEntry]:
    """Iterate a JSONL file producing parsed entries with byte offsets.

    Skips malformed lines silently.
    """
    with path.open("rb") as f:
        offset = 0
        for line in f:
            length = len(line)
            stripped = line.strip()
            if stripped:
                try:
                    data = json.loads(stripped)
                    yield JsonlEntry(raw_offset=offset, raw_length=length, data=data)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass
            offset += length


def read_raw_slice(path: Path, offset: int, length: int) -> bytes:
    with path.open("rb") as f:
        f.seek(offset)
        return f.read(length)


# ---------- block helpers ----------


def extract_text_for_index(data: dict, cap: int = 32 * 1024) -> str:
    """Concatenate searchable text from a jsonl entry into one string."""
    parts: list[str] = []
    msg = data.get("message")
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    parts.append(block.get("text", "") or "")
                elif btype == "thinking":
                    parts.append(block.get("thinking", "") or "")
                elif btype == "tool_use":
                    parts.append(f"[tool:{block.get('name','')}]")
                    try:
                        parts.append(json.dumps(block.get("input", {}), ensure_ascii=False))
                    except Exception:
                        pass
                elif btype == "tool_result":
                    inner = block.get("content")
                    if isinstance(inner, str):
                        parts.append(inner)
                    elif isinstance(inner, list):
                        for ib in inner:
                            if isinstance(ib, dict) and ib.get("type") == "text":
                                parts.append(ib.get("text", "") or "")
    text = "\n".join(p for p in parts if p)
    if len(text) > cap:
        text = text[:cap]
    return text


def extract_preview(data: dict, max_chars: int = 240) -> str:
    msg = data.get("message")
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, str):
            return content[:max_chars]
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    t = block.get("text", "") or ""
                    if t:
                        return t[:max_chars]
    return ""


def classify(data: dict) -> dict:
    """Derive role/tool_name/has_thinking/tokens for a jsonl entry."""
    role = data.get("type") or ""
    tool_name = None
    has_thinking = 0
    tokens_in = None
    tokens_out = None
    cache_creation_input_tokens = None
    cache_read_input_tokens = None
    model = None

    msg = data.get("message")
    if isinstance(msg, dict):
        model = msg.get("model")
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "thinking":
                    has_thinking = 1
                elif btype == "tool_use" and tool_name is None:
                    tool_name = block.get("name")
                elif btype == "tool_result" and role == "user":
                    # User message carrying a tool_result — reclassify.
                    role = "tool_result"
        usage = msg.get("usage")
        if isinstance(usage, dict):
            tokens_in = usage.get("input_tokens")
            tokens_out = usage.get("output_tokens")
            cache_creation_input_tokens = usage.get("cache_creation_input_tokens")
            cache_read_input_tokens = usage.get("cache_read_input_tokens")

    return {
        "role": role,
        "tool_name": tool_name,
        "has_thinking": has_thinking,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cache_creation_input_tokens": cache_creation_input_tokens,
        "cache_read_input_tokens": cache_read_input_tokens,
        "model": model,
    }

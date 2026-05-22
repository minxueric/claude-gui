"""Per-model pricing for usage → USD estimation.

Defaults are conservative public list prices (USD per million tokens).
Override by placing a JSON map at `~/.claude_gui/pricing.json` like:

    {
      "claude-opus-4-5":   {"input": 15, "output": 75, "cacheRead": 1.5, "cacheWrite": 18.75},
      "claude-sonnet-4-5": {"input":  3, "output": 15, "cacheRead": 0.3, "cacheWrite":  3.75}
    }

Lookup is prefix-friendly: the most-specific matching key wins.
"""
from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Optional

from .. import config

log = logging.getLogger(__name__)


# USD per 1M tokens.
DEFAULT_PRICES: dict[str, dict[str, float]] = {
    "claude-opus-4":         {"input": 15.0,  "output": 75.0,  "cacheRead": 1.50,  "cacheWrite": 18.75},
    "claude-opus-4-5":       {"input": 15.0,  "output": 75.0,  "cacheRead": 1.50,  "cacheWrite": 18.75},
    "claude-opus-4-6":       {"input": 15.0,  "output": 75.0,  "cacheRead": 1.50,  "cacheWrite": 18.75},
    "claude-sonnet-4":       {"input":  3.0,  "output": 15.0,  "cacheRead": 0.30,  "cacheWrite":  3.75},
    "claude-sonnet-4-5":     {"input":  3.0,  "output": 15.0,  "cacheRead": 0.30,  "cacheWrite":  3.75},
    "claude-sonnet-4-6":     {"input":  3.0,  "output": 15.0,  "cacheRead": 0.30,  "cacheWrite":  3.75},
    "claude-haiku-4":        {"input":  1.0,  "output":  5.0,  "cacheRead": 0.10,  "cacheWrite":  1.25},
    "claude-haiku-4-5":      {"input":  1.0,  "output":  5.0,  "cacheRead": 0.10,  "cacheWrite":  1.25},
    "claude-3-5-sonnet":     {"input":  3.0,  "output": 15.0,  "cacheRead": 0.30,  "cacheWrite":  3.75},
    "claude-3-5-haiku":      {"input":  0.80, "output":  4.0,  "cacheRead": 0.08,  "cacheWrite":  1.00},
    "claude-3-opus":         {"input": 15.0,  "output": 75.0,  "cacheRead": 1.50,  "cacheWrite": 18.75},
}


@lru_cache(maxsize=1)
def _load_overrides() -> dict[str, dict[str, float]]:
    path = config.GUI_HOME / "pricing.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if isinstance(v, dict)}
    except (OSError, json.JSONDecodeError) as e:
        log.warning("pricing override unreadable: %s", e)
    return {}


def reload_overrides() -> None:
    _load_overrides.cache_clear()


def _table() -> dict[str, dict[str, float]]:
    merged: dict[str, dict[str, float]] = {k: dict(v) for k, v in DEFAULT_PRICES.items()}
    for k, v in _load_overrides().items():
        merged.setdefault(k, {}).update(v)
    return merged


def price_for(model: Optional[str]) -> dict[str, float]:
    """Resolve price entry for a model id. Prefix match, fall back to sonnet rates."""
    if not model:
        return DEFAULT_PRICES["claude-sonnet-4-5"]
    table = _table()
    # Exact hit first.
    if model in table:
        return table[model]
    # Longest matching prefix.
    best_key: str | None = None
    for k in table:
        if model.startswith(k) and (best_key is None or len(k) > len(best_key)):
            best_key = k
    if best_key:
        return table[best_key]
    return DEFAULT_PRICES["claude-sonnet-4-5"]


def estimate_cost(
    model: Optional[str],
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
) -> float:
    p = price_for(model)
    return (
        (input_tokens / 1_000_000.0) * p.get("input", 0.0)
        + (output_tokens / 1_000_000.0) * p.get("output", 0.0)
        + (cache_creation_input_tokens / 1_000_000.0) * p.get("cacheWrite", 0.0)
        + (cache_read_input_tokens / 1_000_000.0) * p.get("cacheRead", 0.0)
    )

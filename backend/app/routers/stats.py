"""Aggregate token / cost / tool usage statistics from the index."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query

from ..db import get_conn
from ..services import pricing

router = APIRouter(prefix="/stats", tags=["stats"])


def _day_key(ts: Optional[float]) -> Optional[str]:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except (OSError, OverflowError, ValueError):
        return None


@router.get("/daily")
def daily(days: int = Query(30, ge=1, le=365)) -> dict:
    """Per-day token totals and estimated USD over the last N days."""
    conn = get_conn()
    cutoff = datetime.now(tz=timezone.utc).timestamp() - days * 86400
    rows = conn.execute(
        """
        SELECT ts, model, tokens_in, tokens_out,
               cache_creation_input_tokens, cache_read_input_tokens
        FROM messages
        WHERE ts IS NOT NULL AND ts >= ?
        """,
        (cutoff,),
    ).fetchall()

    buckets: dict[str, dict[str, float]] = {}
    for r in rows:
        day = _day_key(r["ts"])
        if not day:
            continue
        b = buckets.setdefault(
            day,
            {"input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0, "cost": 0.0},
        )
        ti = r["tokens_in"] or 0
        to = r["tokens_out"] or 0
        cw = r["cache_creation_input_tokens"] or 0
        cr = r["cache_read_input_tokens"] or 0
        b["input"] += ti
        b["output"] += to
        b["cacheWrite"] += cw
        b["cacheRead"] += cr
        b["cost"] += pricing.estimate_cost(r["model"], ti, to, cw, cr)

    series = [
        {
            "date": day,
            "input": b["input"],
            "output": b["output"],
            "cacheWrite": b["cacheWrite"],
            "cacheRead": b["cacheRead"],
            "cost": round(b["cost"], 6),
        }
        for day, b in sorted(buckets.items())
    ]
    return {"days": days, "series": series}


@router.get("/models")
def models(days: int = Query(30, ge=1, le=365)) -> dict:
    """Per-model token totals and estimated USD over the last N days."""
    conn = get_conn()
    cutoff = datetime.now(tz=timezone.utc).timestamp() - days * 86400
    rows = conn.execute(
        """
        SELECT model,
               COALESCE(SUM(tokens_in), 0)                      AS input,
               COALESCE(SUM(tokens_out), 0)                     AS output,
               COALESCE(SUM(cache_creation_input_tokens), 0)    AS cache_write,
               COALESCE(SUM(cache_read_input_tokens), 0)        AS cache_read
        FROM messages
        WHERE ts IS NOT NULL AND ts >= ? AND model IS NOT NULL AND model != ''
        GROUP BY model
        ORDER BY input + output DESC
        """,
        (cutoff,),
    ).fetchall()

    out = []
    for r in rows:
        cost = pricing.estimate_cost(
            r["model"], r["input"], r["output"], r["cache_write"], r["cache_read"]
        )
        out.append(
            {
                "model": r["model"],
                "input": r["input"],
                "output": r["output"],
                "cacheWrite": r["cache_write"],
                "cacheRead": r["cache_read"],
                "cost": round(cost, 6),
            }
        )
    return {"days": days, "models": out}


@router.get("/tools")
def tools(days: int = Query(30, ge=1, le=365), limit: int = Query(15, ge=1, le=100)) -> dict:
    """Top tool_use counts over the last N days."""
    conn = get_conn()
    cutoff = datetime.now(tz=timezone.utc).timestamp() - days * 86400
    rows = conn.execute(
        """
        SELECT tool_name, COUNT(*) AS uses
        FROM messages
        WHERE ts IS NOT NULL AND ts >= ? AND tool_name IS NOT NULL AND tool_name != ''
        GROUP BY tool_name
        ORDER BY uses DESC
        LIMIT ?
        """,
        (cutoff, limit),
    ).fetchall()
    return {
        "days": days,
        "tools": [{"name": r["tool_name"], "uses": r["uses"]} for r in rows],
    }


@router.get("/totals")
def totals(days: int = Query(30, ge=1, le=365)) -> dict:
    """Grand totals over the last N days."""
    conn = get_conn()
    cutoff = datetime.now(tz=timezone.utc).timestamp() - days * 86400
    rows = conn.execute(
        """
        SELECT model, tokens_in, tokens_out,
               cache_creation_input_tokens, cache_read_input_tokens
        FROM messages
        WHERE ts IS NOT NULL AND ts >= ?
        """,
        (cutoff,),
    ).fetchall()
    ti = to = cw = cr = 0
    cost = 0.0
    for r in rows:
        a = r["tokens_in"] or 0
        b = r["tokens_out"] or 0
        c = r["cache_creation_input_tokens"] or 0
        d = r["cache_read_input_tokens"] or 0
        ti += a
        to += b
        cw += c
        cr += d
        cost += pricing.estimate_cost(r["model"], a, b, c, d)
    return {
        "days": days,
        "input": ti,
        "output": to,
        "cacheWrite": cw,
        "cacheRead": cr,
        "cost": round(cost, 6),
        "messages": len(rows),
    }

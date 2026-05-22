"""Filesystem watcher for ~/.claude/projects."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from watchfiles import Change, awatch

from .. import config
from ..db import get_conn
from . import scanner

log = logging.getLogger(__name__)


async def watch_loop(stop_event: asyncio.Event) -> None:
    if not config.PROJECTS_DIR.exists():
        log.warning("PROJECTS_DIR %s does not exist; watcher idle", config.PROJECTS_DIR)
        await stop_event.wait()
        return

    log.info("watching %s", config.PROJECTS_DIR)
    try:
        async for changes in awatch(
            config.PROJECTS_DIR,
            stop_event=stop_event,
            debounce=config.WATCH_DEBOUNCE_MS,
            recursive=True,
        ):
            touched_projects: set[Path] = set()
            for _change, p in changes:
                path = Path(p)
                if path.suffix in {".jsonl", ".json"}:
                    try:
                        rel = path.relative_to(config.PROJECTS_DIR)
                        touched_projects.add(config.PROJECTS_DIR / rel.parts[0])
                    except (ValueError, IndexError):
                        continue
            for proj in touched_projects:
                try:
                    scanner.sync_project(get_conn(), proj)
                except Exception as e:  # noqa: BLE001
                    log.warning("watcher sync failed for %s: %s", proj, e)
    except asyncio.CancelledError:
        pass

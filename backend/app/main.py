"""FastAPI entrypoint."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from . import config, db
from .indexer import scanner, watcher
from .routers import (
    chat,
    commands,
    files,
    mcp,
    memory,
    plans,
    projects,
    search,
    sessions,
    stats,
    tasks,
    todos,
)
from .services.claude_session import registry as chat_registry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("claude-gui")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    # Touch a connection so schema migration runs once before scanning.
    db.get_conn().close()
    if db.needs_reindex():
        log.info("schema bumped — clearing message rows to force full backfill")
        conn = db.get_conn()
        conn.execute("DELETE FROM messages_fts")
        conn.execute("DELETE FROM messages")
        conn.execute("UPDATE sessions SET file_mtime = NULL")
        conn.commit()
        conn.close()
    log.info("initial sync from %s", config.PROJECTS_DIR)
    try:
        result = await asyncio.to_thread(scanner.full_sync)
        log.info("initial sync: %s", result)
    except Exception as e:  # noqa: BLE001
        log.exception("initial sync failed: %s", e)

    stop_event = asyncio.Event()
    watch_task = asyncio.create_task(watcher.watch_loop(stop_event))
    # Rehydrate any chat sessions that were live before a backend restart —
    # this is what lets a user refresh their browser (or wait through a dev
    # --reload) and find their turn still in progress.
    try:
        n = await chat_registry.rehydrate_from_disk()
        if n:
            log.info("rehydrated %d chat session(s) from registry.json", n)
    except Exception:  # noqa: BLE001
        log.exception("registry rehydrate failed")
    try:
        yield
    finally:
        stop_event.set()
        watch_task.cancel()
        try:
            await watch_task
        except asyncio.CancelledError:
            pass
        # Tear down any live ChatSessions so their SDK subprocesses don't
        # outlive the FastAPI process (matters under `uvicorn --reload`).
        # Use close() directly (not registry.remove()) so the persisted
        # registry.json file survives — rehydrate_from_disk() on the next
        # startup will use it to rebuild the sessions.
        for chat_id, s in list(chat_registry.sessions.items()):
            try:
                await s.close()
            except Exception:  # noqa: BLE001
                log.exception("failed to close chat %s on shutdown", chat_id)
        # Persist the final state explicitly so registry.json reflects the
        # last known mode/effort/model of each chat.
        chat_registry._persist()


app = FastAPI(title="Claude GUI", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(todos.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(commands.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(memory.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(mcp.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "claudeHome": str(config.CLAUDE_HOME), "indexDb": str(config.INDEX_DB)}


@app.post("/api/admin/reindex")
def reindex() -> dict:
    return scanner.full_sync()


# Serve frontend in production if dist exists.
_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = _DIST / full_path
        if f.is_file():
            return FileResponse(f)
        return FileResponse(_DIST / "index.html")

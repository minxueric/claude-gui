"""Configuration: paths and constants."""
from __future__ import annotations

import os
from pathlib import Path

CLAUDE_HOME = Path(os.environ.get("CLAUDE_HOME", Path.home() / ".claude")).expanduser()
PROJECTS_DIR = CLAUDE_HOME / "projects"
TODOS_DIR = CLAUDE_HOME / "todos"
TASKS_DIR = CLAUDE_HOME / "tasks"
PLANS_DIR = CLAUDE_HOME / "plans"
SETTINGS_FILE = CLAUDE_HOME / "settings.json"

GUI_HOME = Path(os.environ.get("CLAUDE_GUI_HOME", Path.home() / ".claude_gui")).expanduser()
INDEX_DB = GUI_HOME / "index.db"

# FTS text size cap per message row
FTS_TEXT_CAP = 32 * 1024

# Watcher debounce
WATCH_DEBOUNCE_MS = 500


def ensure_dirs() -> None:
    GUI_HOME.mkdir(parents=True, exist_ok=True)

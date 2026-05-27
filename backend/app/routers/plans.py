"""Plans: list & read ~/.claude/plans/*.md."""
from __future__ import annotations

import subprocess
import sys
from fastapi import APIRouter, HTTPException

from .. import config
from ..models import PlanFile

router = APIRouter()


@router.get("/plans", response_model=list[PlanFile])
def list_plans() -> list[PlanFile]:
    if not config.PLANS_DIR.exists():
        return []
    out: list[PlanFile] = []
    for f in sorted(config.PLANS_DIR.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True):
        title = ""
        try:
            with f.open("r", errors="replace") as fp:
                for line in fp:
                    line = line.strip()
                    if line.startswith("#"):
                        title = line.lstrip("#").strip()
                        break
                    if line:
                        title = line
                        break
        except OSError:
            continue
        out.append(PlanFile(name=f.name, title=title or f.stem, modified=f.stat().st_mtime, size=f.stat().st_size))
    return out


@router.get("/plans/{name}")
def get_plan(name: str) -> dict:
    if "/" in name or ".." in name:
        raise HTTPException(400, "bad name")
    p = config.PLANS_DIR / name
    if not p.is_file():
        raise HTTPException(404, "not found")
    return {"name": name, "content": p.read_text(errors="replace"), "modified": p.stat().st_mtime}


@router.post("/plans/{name}/reveal")
def reveal_plan(name: str) -> dict:
    """Reveal the plan .md file in Finder (macOS) or file manager."""
    if "/" in name or ".." in name:
        raise HTTPException(400, "bad name")
    p = config.PLANS_DIR / name
    if not p.is_file():
        raise HTTPException(404, "not found")
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", "-R", str(p)], check=False)
        elif sys.platform.startswith("linux"):
            subprocess.run(["xdg-open", str(p.parent)], check=False)
        else:
            raise HTTPException(501, "unsupported platform")
    except FileNotFoundError as e:
        raise HTTPException(500, f"reveal failed: {e}")
    return {"ok": True}

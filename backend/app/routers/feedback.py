"""Feedback router: submit GitHub issues and list open issues."""
from __future__ import annotations

import json
import subprocess
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

REPO = "minxueric/claude-gui"

router = APIRouter()


class FeedbackRequest(BaseModel):
    title: str
    description: str
    includeSystemInfo: bool = True
    systemInfo: Optional[dict] = None  # ua, url, version, lastError
    isAutoReport: bool = False


def _build_body(req: FeedbackRequest) -> str:
    parts = ["## 描述\n", req.description.strip(), "\n"]
    if req.includeSystemInfo and req.systemInfo:
        si = req.systemInfo
        parts += [
            "\n## 系统信息\n",
            f"- GUI 版本: {si.get('version', '未知')}\n",
            f"- OS/Browser: {si.get('ua', '未知')}\n",
            f"- 页面: {si.get('url', '未知')}\n",
        ]
        if si.get("lastError"):
            parts.append(f"- 最近错误: `{si['lastError']}`\n")
    parts.append("\n---\n*由 claude-gui 内置反馈功能自动提交*")
    return "".join(parts)


@router.post("/feedback/issue")
async def create_issue(req: FeedbackRequest) -> dict:
    label = "bug"
    body = _build_body(req)
    try:
        result = subprocess.run(
            ["gh", "issue", "create",
             "--repo", REPO,
             "--title", req.title,
             "--body", body,
             "--label", label],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError:
        raise HTTPException(500, "gh CLI not found — please install GitHub CLI")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "gh CLI timed out")
    if result.returncode != 0:
        raise HTTPException(500, result.stderr.strip() or "gh issue create failed")
    url = result.stdout.strip()
    # Extract issue number from URL (https://github.com/owner/repo/issues/N)
    number = None
    if url:
        try:
            number = int(url.rstrip("/").rsplit("/", 1)[-1])
        except (ValueError, IndexError):
            pass
    return {"url": url, "number": number}


@router.get("/feedback/issues")
async def list_issues(state: str = "open", label: str = "bug", limit: int = 20) -> dict:
    """List GitHub issues for the maintainer to review."""
    try:
        result = subprocess.run(
            ["gh", "issue", "list",
             "--repo", REPO,
             "--state", state,
             "--label", label,
             "--limit", str(limit),
             "--json", "number,title,body,createdAt,url,labels"],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError:
        raise HTTPException(500, "gh CLI not found")
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "gh CLI timed out")
    if result.returncode != 0:
        raise HTTPException(500, result.stderr.strip())
    try:
        issues = json.loads(result.stdout)
    except json.JSONDecodeError:
        issues = []
    return {"issues": issues, "repo": REPO}

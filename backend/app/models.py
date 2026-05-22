"""Pydantic response models."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ProjectInfo(BaseModel):
    encoded: str
    cwd: str
    sessionCount: int
    lastModified: Optional[float] = None


class SessionSummary(BaseModel):
    sessionId: str
    encodedProject: str
    firstPrompt: Optional[str] = None
    summary: Optional[str] = None
    messageCount: Optional[int] = None
    created: Optional[float] = None
    modified: Optional[float] = None
    gitBranch: Optional[str] = None
    projectPath: Optional[str] = None
    isSidechain: bool = False


class MessageRow(BaseModel):
    uuid: str
    sessionId: str
    parentUuid: Optional[str] = None
    ts: Optional[float] = None
    role: str
    model: Optional[str] = None
    toolName: Optional[str] = None
    cwd: Optional[str] = None
    gitBranch: Optional[str] = None
    hasThinking: bool = False
    tokensIn: Optional[int] = None
    tokensOut: Optional[int] = None
    preview: Optional[str] = None
    raw: Optional[dict] = None  # populated when fetching full session


class SessionDetail(BaseModel):
    session: SessionSummary
    messages: list[MessageRow]
    nextCursor: Optional[str] = None


class SearchHit(BaseModel):
    sessionId: str
    uuid: str
    ts: Optional[float] = None
    role: str
    toolName: Optional[str] = None
    snippet: str
    sessionFirstPrompt: Optional[str] = None
    encodedProject: Optional[str] = None


class SearchResponse(BaseModel):
    total: int
    hits: list[SearchHit]


class TodoItem(BaseModel):
    id: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    activeForm: Optional[str] = None


class TodosFile(BaseModel):
    file: str
    agentId: Optional[str] = None
    modified: float
    todos: list[TodoItem] = []


class PlanFile(BaseModel):
    name: str
    title: str
    modified: float
    size: int


class TaskNode(BaseModel):
    name: str
    path: str
    isDir: bool
    modified: float
    size: Optional[int] = None
    children: Optional[list["TaskNode"]] = None


TaskNode.model_rebuild()


class ChatStartRequest(BaseModel):
    cwd: str
    resume: Optional[str] = None
    model: Optional[str] = None
    permissionMode: Optional[str] = "default"
    allowedTools: Optional[list[str]] = None
    systemPrompt: Optional[str] = None
    effort: Optional[str] = None  # low | medium | high | xhigh | max


class ChatStartResponse(BaseModel):
    chatId: str


class ChatInputRequest(BaseModel):
    # `content` may be a plain string OR a list of content-blocks like
    # `[{"type":"text","text":"..."}, {"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}]`.
    content: Any


class ChatPermissionRequest(BaseModel):
    requestId: str
    decision: str  # allow | deny | allow_once
    updatedInput: Optional[dict[str, Any]] = None
    message: Optional[str] = None


class ChatPermissionModeRequest(BaseModel):
    mode: str  # default | acceptEdits | bypassPermissions | plan


class ChatEffortRequest(BaseModel):
    effort: str = ""  # "" | low | medium | high | xhigh | max

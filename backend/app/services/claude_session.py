"""Wraps claude_agent_sdk.ClaudeSDKClient for the GUI.

Each chat owns one client + one async pump that converts SDK messages into a
queue of normalized SSE-friendly dicts. Tool permission requests pause inside
`can_use_tool` until the frontend posts a decision.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

log = logging.getLogger(__name__)


def _sanitize(obj: Any, depth: int = 0) -> Any:
    """Recursively convert any non-JSON-native value to a serializable form.
    Prevents SDK dataclass instances or other objects from blowing up the SSE stream."""
    if depth > 8:
        return str(obj)
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _sanitize(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_sanitize(v, depth + 1) for v in obj]
    # Fallback for dataclasses / other objects
    if hasattr(obj, "__dict__"):
        try:
            return _sanitize(vars(obj), depth + 1)
        except Exception:  # noqa: BLE001
            return repr(obj)
    return str(obj)


def _block_to_dict(block: Any) -> dict:
    if isinstance(block, TextBlock):
        return {"type": "text", "text": block.text}
    if isinstance(block, ThinkingBlock):
        return {"type": "thinking", "thinking": block.thinking}
    if isinstance(block, ToolUseBlock):
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": _sanitize(block.input)}
    if isinstance(block, ToolResultBlock):
        content = block.content
        if not isinstance(content, (str, list)):
            content = str(content)
        return {
            "type": "tool_result",
            "tool_use_id": block.tool_use_id,
            "content": _sanitize(content),
            "is_error": getattr(block, "is_error", False),
        }
    return {"type": "unknown", "repr": repr(block)}


def _message_to_event(msg: Any) -> dict | None:
    if isinstance(msg, UserMessage):
        # Drop tool-result messages — their content is entirely ToolResultBlocks.
        # The SDK sets parent_tool_use_id=None on these, so we detect by content type.
        content = msg.content
        if isinstance(content, list) and content and all(isinstance(b, ToolResultBlock) for b in content):
            return None
        if isinstance(content, list):
            blocks = [_block_to_dict(b) for b in content]
        else:
            blocks = [{"type": "text", "text": str(content)}]
        return {"event": "user_message", "data": {"content": blocks}}
    if isinstance(msg, AssistantMessage):
        return {
            "event": "assistant_message",
            "data": {
                "model": getattr(msg, "model", None),
                "content": [_block_to_dict(b) for b in msg.content],
            },
        }
    if isinstance(msg, SystemMessage):
        subtype = getattr(msg, "subtype", None)
        # Drop init/meta system messages — they are not useful to the UI.
        if subtype == "init":
            return None
        return {"event": "system", "data": {"subtype": subtype, "raw": _sanitize(getattr(msg, "data", None))}}
    if isinstance(msg, ResultMessage):
        return {
            "event": "result",
            "data": {
                "subtype": getattr(msg, "subtype", None),
                "duration_ms": getattr(msg, "duration_ms", None),
                "total_cost_usd": getattr(msg, "total_cost_usd", None),
                "session_id": getattr(msg, "session_id", None),
                "usage": _sanitize(getattr(msg, "usage", None)),
            },
        }
    # Unknown SDK message type — log and silently drop.
    cls = type(msg).__name__
    log.debug("unknown SDK message type: %s repr=%s", cls, repr(msg)[:300])
    return None


class ChatSession:
    def __init__(self, chat_id: str, options: ClaudeAgentOptions):
        self.chat_id = chat_id
        self.options = options
        self.client: ClaudeSDKClient | None = None
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=1024)
        self.permission_waiters: dict[str, asyncio.Future] = {}
        # Snapshot of each outstanding permission/ask request so a reconnecting
        # client (after a page refresh) can re-render the prompts without
        # having missed the original SSE event.
        self.pending_requests: dict[str, dict] = {}
        self.pump_task: asyncio.Task | None = None
        self.created = time.time()
        self._turn_started_at: float | None = None
        self.session_id: str | None = None
        self._closed = False
        self.permission_mode: str = options.permission_mode or "default"
        # Remember the mode we were in before entering "plan", so we can
        # restore (or auto-upgrade to acceptEdits) after ExitPlanMode.
        self._pre_plan_mode: str = self.permission_mode if self.permission_mode != "plan" else "default"
        self.effort: str | None = getattr(options, "effort", None)
        # cumulative usage across turns
        self.usage_totals: dict[str, float | int] = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "total_cost_usd": 0.0,
        }
        self.last_model: str | None = None

    async def _put(self, evt: dict) -> None:
        """Bounded enqueue: drop non-critical events under backpressure."""
        try:
            self.queue.put_nowait(evt)
        except asyncio.QueueFull:
            # drop pings / usage if we've hit the cap, never drop messages
            if evt.get("event") in {"ping", "usage"}:
                return
            await self.queue.put(evt)

    async def start(self) -> None:
        # Wire can_use_tool to ourselves before constructing the client.
        self.options.can_use_tool = self._on_tool
        self.client = ClaudeSDKClient(options=self.options)
        await self.client.connect()
        # _send_event is set each time send() is called, waking the pump loop.
        self._send_event: asyncio.Event = asyncio.Event()
        self._pending_content: Any = None
        self._turn_active: bool = False
        self.pump_task = asyncio.create_task(self._pump())

    # Tools whose effects are write-like (mutate filesystem / spawn shells).
    # In acceptEdits mode we auto-allow these; in default mode we ask.
    _EDIT_LIKE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}

    async def _on_tool(self, tool_name: str, tool_input: dict, context: Any):
        # Honor the current permission_mode without round-tripping through the
        # GUI: bypass and accept-edits never block the SDK.
        mode = self.permission_mode
        if mode in ("bypassPermissions", "auto"):
            return PermissionResultAllow(updated_input=tool_input)
        if mode == "acceptEdits" and tool_name in self._EDIT_LIKE_TOOLS:
            return PermissionResultAllow(updated_input=tool_input)

        # AskUserQuestion is a special CLI-builtin "ask the user" tool whose
        # result is just a formatted answer string. We render an interactive
        # picker in the GUI, then synthesize the answer string back to Claude
        # via PermissionResultDeny(message=...). Deny-with-message is the SDK
        # path that produces an arbitrary tool_result string for the model.
        # ExitPlanMode is Claude's signal that it's ready to leave plan mode
        # and start executing. CLI behavior: surface the plan to the user,
        # let them Approve (→ auto-switch to acceptEdits or restore the mode
        # the user was in before plan), Keep planning (deny — plan mode
        # stays, Claude revises), or Approve + stay in default.
        if tool_name == "ExitPlanMode":
            request_id = uuid.uuid4().hex
            loop = asyncio.get_event_loop()
            fut: asyncio.Future = loop.create_future()
            self.permission_waiters[request_id] = fut
            plan_text = ""
            if isinstance(tool_input, dict):
                plan_text = str(tool_input.get("plan") or "")
            snap = {
                "kind": "plan_exit",
                "requestId": request_id,
                "plan": plan_text,
                "prePlanMode": self._pre_plan_mode,
            }
            self.pending_requests[request_id] = snap
            await self._put({"event": "plan_exit", "data": snap})
            try:
                decision = await fut
            finally:
                self.permission_waiters.pop(request_id, None)
                self.pending_requests.pop(request_id, None)
            choice = decision.get("decision")  # "approve_auto" | "approve_keep" | "keep_planning"
            if choice == "approve_auto":
                # Switch to acceptEdits (or whatever pre-plan if it was already permissive)
                target = "acceptEdits" if self._pre_plan_mode in ("default", "plan") else self._pre_plan_mode
                await self.set_permission_mode(target)
                return PermissionResultAllow(updated_input=tool_input)
            if choice == "approve_keep":
                # Restore the user's pre-plan mode exactly.
                await self.set_permission_mode(self._pre_plan_mode)
                return PermissionResultAllow(updated_input=tool_input)
            # "keep_planning" or anything else: deny so Claude keeps planning.
            msg = decision.get("message") or "User wants to refine the plan; do not exit plan mode yet."
            return PermissionResultDeny(message=msg)

        if tool_name == "AskUserQuestion":
            request_id = uuid.uuid4().hex
            loop = asyncio.get_event_loop()
            fut: asyncio.Future = loop.create_future()
            self.permission_waiters[request_id] = fut
            snap_input = _sanitize(tool_input)
            self.pending_requests[request_id] = {
                "kind": "ask",
                "requestId": request_id,
                "input": snap_input,
            }
            await self._put(
                {
                    "event": "ask_user_question",
                    "data": {
                        "requestId": request_id,
                        "input": snap_input,
                    },
                }
            )
            try:
                decision = await fut
            finally:
                self.permission_waiters.pop(request_id, None)
                self.pending_requests.pop(request_id, None)
            # Build the formatted answer string Claude expects.
            answers = decision.get("answers") or {}
            parts = []
            for q, a in answers.items():
                parts.append(f'"{q}"="{a}"')
            if parts:
                msg = "User has answered your questions: " + ", ".join(parts) + ". You can now continue with the user's answers in mind."
            else:
                msg = decision.get("message", "User did not answer.")
            return PermissionResultDeny(message=msg)

        # plan mode: SDK itself enforces read-only; we still surface the prompt
        # so the user can deny if needed. default mode: always ask.

        request_id = uuid.uuid4().hex
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self.permission_waiters[request_id] = fut
        log.info("can_use_tool[%s] request_id=%s tool=%s mode=%s", self.chat_id[:8], request_id, tool_name, mode)
        snap_input = _sanitize(tool_input)
        self.pending_requests[request_id] = {
            "kind": "permission",
            "requestId": request_id,
            "toolName": tool_name,
            "input": snap_input,
        }
        # Drop suggestions — they're SDK PermissionUpdate objects that aren't
        # JSON-serializable. The frontend doesn't use them anyway.
        await self._put(
            {
                "event": "permission_request",
                "data": {
                    "requestId": request_id,
                    "toolName": tool_name,
                    "input": snap_input,
                },
            }
        )
        try:
            decision = await fut
        finally:
            self.permission_waiters.pop(request_id, None)
            self.pending_requests.pop(request_id, None)
        log.info("can_use_tool[%s] resolved request_id=%s decision=%s", self.chat_id[:8], request_id, decision.get("decision"))
        if decision.get("decision") == "allow" or decision.get("decision") == "allow_once":
            upd = decision.get("updatedInput")
            # SDK signature: PermissionResultAllow(updated_input=None) falls back to original_input.
            # But some SDK versions require the dict explicitly; pass through original on None.
            return PermissionResultAllow(updated_input=upd if upd is not None else tool_input)
        return PermissionResultDeny(message=decision.get("message", "denied by user"))

    async def _pump(self) -> None:
        assert self.client is not None
        try:
            while not self._closed:
                # Wait for send() to signal a new turn.
                await self._send_event.wait()
                self._send_event.clear()
                if self._closed:
                    break
                content = self._pending_content
                self._pending_content = None
                self._turn_active = True
                self._turn_started_at = time.time()

                # Issue query then drain this turn's messages.
                try:
                    if isinstance(content, list):
                        session_id = self.session_id or "default"

                        async def _stream():
                            yield {
                                "type": "user",
                                "message": {"role": "user", "content": content},
                                "parent_tool_use_id": None,
                                "session_id": session_id,
                            }

                        await self.client.query(_stream())
                    else:
                        await self.client.query(content)

                    async for msg in self.client.receive_messages():
                        evt = _message_to_event(msg)
                        if evt is None:
                            continue
                        if evt["event"] == "assistant_message":
                            self.last_model = evt["data"].get("model") or self.last_model
                        if evt["event"] == "result":
                            data = evt["data"]
                            if data.get("session_id"):
                                self.session_id = data["session_id"]
                            self._accumulate_usage(data)
                            await self._put({"event": "usage", "data": self._usage_snapshot()})
                            await self._put(evt)
                            break  # one turn done, go back to waiting for next send()
                        await self._put(evt)
                except Exception as e:  # noqa: BLE001
                    log.exception("pump turn error")
                    await self._put({"event": "error", "data": {"message": str(e)}})
                finally:
                    self._turn_active = False
                    self._turn_started_at = None
        finally:
            await self._put({"event": "done", "data": {}})

    def _accumulate_usage(self, result_data: dict) -> None:
        usage = result_data.get("usage") or {}
        if isinstance(usage, dict):
            for k in ("input_tokens", "output_tokens",
                      "cache_creation_input_tokens", "cache_read_input_tokens"):
                v = usage.get(k)
                if isinstance(v, (int, float)):
                    self.usage_totals[k] = int(self.usage_totals.get(k, 0)) + int(v)
        cost = result_data.get("total_cost_usd")
        if isinstance(cost, (int, float)):
            self.usage_totals["total_cost_usd"] = float(self.usage_totals.get("total_cost_usd", 0.0)) + float(cost)

    def _usage_snapshot(self) -> dict:
        return {
            "totals": dict(self.usage_totals),
            "model": self.last_model,
        }

    async def send(self, content: Any) -> None:
        # Lazy-start the SDK on first send for rehydrated (placeholder)
        # sessions: rehydrate_from_disk leaves client=None so we don't spawn
        # a process for chats the user may never touch again.
        if self.client is None:
            log.info("lazy-starting SDK client for chat %s", self.chat_id[:8])
            await self.start()
        # If the previous turn is still hanging inside receive_messages (e.g.
        # SDK got stuck waiting for an assistant_message after a failed
        # WebFetch tool_result), interrupt it so the pump loop can flush and
        # pick up this new message instead of having it silently overwrite
        # the pending slot and never be processed.
        if self._turn_active:
            log.info("send while turn_active — interrupting prior turn first")
            try:
                await self.client.interrupt()
            except Exception:  # noqa: BLE001
                log.exception("interrupt-before-send failed")
            # Cancel any pending permission waiters too
            for fut in list(self.permission_waiters.values()):
                if not fut.done():
                    fut.set_result({"decision": "deny", "message": "superseded by new message"})
        self._pending_content = content
        self._send_event.set()

    async def set_permission_mode(self, mode: str) -> bool:
        if mode not in {"default", "acceptEdits", "bypassPermissions", "plan", "auto"}:
            return False
        # Track the mode we had before entering plan so ExitPlanMode can
        # restore it (or auto-upgrade to acceptEdits, matching CLI behavior).
        if mode == "plan" and self.permission_mode != "plan":
            self._pre_plan_mode = self.permission_mode
        # Always remember the mode locally — _on_tool consults it directly to
        # auto-allow tools, so this works even when the SDK refuses the
        # control request (e.g. switching to bypassPermissions on a session
        # that wasn't launched with --dangerously-skip-permissions: the SDK
        # blocks but our GUI-side bypass still kicks in).
        changed = self.permission_mode != mode
        self.permission_mode = mode
        if changed:
            # Notify any connected GUI so its mode dropdown stays in sync
            # with backend-initiated transitions (e.g. ExitPlanMode auto-
            # upgrade to acceptEdits).
            try:
                await self._put({"event": "mode_changed", "data": {"mode": mode}})
            except Exception:  # noqa: BLE001
                pass
        if self.client is None:
            return True
        fn = getattr(self.client, "set_permission_mode", None)
        if callable(fn):
            try:
                await fn(mode)
            except Exception as e:  # noqa: BLE001
                log.warning("SDK rejected set_permission_mode(%s): %s — local mode kept", mode, e)
                # local mode already set; GUI bypass logic in _on_tool will
                # still honor it
                return True
        return True

    async def set_model(self, model: str) -> bool:
        """Switch the active model on the running SDK client (effective on
        subsequent turns). Empty string falls back to the SDK default."""
        if self.client is None:
            return False
        fn = getattr(self.client, "set_model", None)
        if not callable(fn):
            return False
        try:
            res = fn(model or None)
            if asyncio.iscoroutine(res):
                await res
            self.last_model = model or None
            return True
        except Exception:  # noqa: BLE001
            log.exception("set_model failed")
            return False

    async def get_mcp_status(self) -> Any:
        if self.client is None:
            return None
        fn = getattr(self.client, "get_mcp_status", None) or getattr(self.client, "mcp_status", None)
        if callable(fn):
            try:
                res = fn()
                if asyncio.iscoroutine(res):
                    res = await res
                return res
            except Exception:  # noqa: BLE001
                log.exception("get_mcp_status failed")
                return None
        return None

    async def respond_permission(self, request_id: str, decision: str, updated_input: dict | None = None, message: str = "", answers: dict | None = None) -> bool:
        fut = self.permission_waiters.get(request_id)
        log.info(
            "respond_permission[%s] request_id=%s decision=%s found=%s done=%s",
            self.chat_id[:8], request_id, decision,
            fut is not None, fut.done() if fut is not None else None,
        )
        if fut is None or fut.done():
            return False
        fut.set_result({"decision": decision, "updatedInput": updated_input, "message": message, "answers": answers})
        return True

    async def interrupt(self) -> None:
        # Tell the SDK to abort the in-flight turn
        if self.client is not None:
            try:
                await self.client.interrupt()
            except Exception:  # noqa: BLE001
                log.exception("client.interrupt failed")
        # If a tool is paused waiting for permission, deny it so _on_tool returns
        # and the pump can exit receive_messages() naturally.
        for req_id, fut in list(self.permission_waiters.items()):
            if not fut.done():
                fut.set_result({"decision": "deny", "message": "interrupted"})
        # Emit a synthetic result so the front-end unlocks even if the SDK
        # doesn't produce one before the next turn.
        await self._put({"event": "result", "data": {"interrupted": True}})

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # Wake the pump loop so it can see _closed and exit cleanly.
        if hasattr(self, "_send_event"):
            self._send_event.set()
        if self.pump_task:
            self.pump_task.cancel()
        if self.client is not None:
            try:
                await self.client.disconnect()
            except Exception:  # noqa: BLE001
                pass


class ChatRegistry:
    def __init__(self) -> None:
        self.sessions: dict[str, ChatSession] = {}
        # Persist enough metadata for a restarted backend (dev --reload, or a
        # crash) to rebuild the SDK client and re-attach to the existing
        # JSONL session. SDK subprocess is gone after a restart — we can only
        # resume by re-launching `claude --resume <sessionId>`, which the SDK
        # handles transparently when we pass `resume=`.
        from .. import config as _cfg
        self._persist_path = _cfg.GUI_HOME / "registry.json"

    def _persist(self) -> None:
        """Write the chatId → metadata map. Called whenever a session is
        created, has its mode/effort/model updated, or is removed."""
        try:
            self._persist_path.parent.mkdir(parents=True, exist_ok=True)
            data = {
                chat_id: {
                    "sessionId": s.session_id,
                    "cwd": getattr(s.options, "cwd", None),
                    "model": getattr(s.options, "model", None),
                    "permissionMode": s.permission_mode,
                    "effort": s.effort,
                    "lastModel": s.last_model,
                }
                for chat_id, s in self.sessions.items()
            }
            tmp = self._persist_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(self._persist_path)
        except Exception:  # noqa: BLE001
            log.exception("registry persist failed")

    def _load_persisted(self) -> dict:
        if not self._persist_path.exists():
            return {}
        try:
            return json.loads(self._persist_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return {}

    async def rehydrate_from_disk(self) -> int:
        """Called on startup. Re-create *placeholder* ChatSession entries for
        previously-live chats. We do NOT start a fresh SDK subprocess here:
        an unfinished prior turn cannot be resumed mid-flight (the SDK has
        no "continue this turn" primitive), and immediately spawning a
        client would race with the frontend's lazy-start path. Instead we
        keep the chatId → metadata association so the frontend's existing
        sessionStorage lock still maps to a known chat, and the next time
        the user sends a message we lazily start the SDK with resume=<sid>.

        Returns the count of placeholders restored."""
        persisted = self._load_persisted()
        n = 0
        for chat_id, meta in persisted.items():
            try:
                sid = meta.get("sessionId")
                if not sid:
                    continue  # no jsonl to resume — drop
                opts = ClaudeAgentOptions(
                    cwd=meta.get("cwd") or "",
                    resume=sid,
                    model=meta.get("model") or None,
                    permission_mode=meta.get("permissionMode") or "default",
                    effort=meta.get("effort") or None,
                )
                s = ChatSession(chat_id, opts)
                s.session_id = sid
                s.effort = meta.get("effort")
                s.last_model = meta.get("lastModel")
                # NOTE: do NOT call s.start() here. The SDK client is brought
                # up on the first user message via ChatSession.start_lazy().
                self.sessions[chat_id] = s
                n += 1
                log.info("rehydrated placeholder chat %s (session=%s)", chat_id[:8], sid[:8])
            except Exception:  # noqa: BLE001
                log.exception("failed to rehydrate chat %s", chat_id[:8])
        return n

    async def create(self, *, cwd: str, resume: str | None, model: str | None,
                     permission_mode: str | None, allowed_tools: list[str] | None,
                     system_prompt: str | None, effort: str | None = None) -> ChatSession:
        opts = ClaudeAgentOptions(
            cwd=cwd,
            resume=resume,
            model=model,
            permission_mode=permission_mode or "default",
            allowed_tools=allowed_tools or [],
            system_prompt=system_prompt,
            effort=effort or None,
        )
        chat_id = uuid.uuid4().hex
        s = ChatSession(chat_id, opts)
        if resume:
            s.session_id = resume
        await s.start()
        self.sessions[chat_id] = s
        self._persist()
        return s

    def get(self, chat_id: str) -> ChatSession | None:
        return self.sessions.get(chat_id)

    async def remove(self, chat_id: str) -> None:
        s = self.sessions.pop(chat_id, None)
        if s:
            await s.close()
        self._persist()


registry = ChatRegistry()

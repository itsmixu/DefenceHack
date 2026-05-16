"""In-memory collab session registry.

A `Session` represents one open browser tab that has opened a specific file
for live editing. The first session to join a file becomes its `leader`;
all subsequent sessions are `followers`. Followers receive the leader's
edit broadcasts over SSE and apply them read-only.

State is process-local — restart of the backend wipes all sessions. This
matches the project's "single dev box for the hackathon" model. For
multi-process / multi-host deployment, swap the in-memory dicts for
Redis pub/sub.

The actual edit payloads are opaque dicts — the backend doesn't care what
they contain. Whatever the leader posts, the followers receive verbatim.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

# Followers that fall this far behind get dropped (queue full / disconnected).
MAX_QUEUE = 64
# Stale leader without recent activity → first follower can claim leadership.
LEADER_HEARTBEAT_TIMEOUT_S = 30.0


@dataclass
class Session:
    id: str
    display_name: str
    joined_at: float
    last_seen: float
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(maxsize=MAX_QUEUE))


@dataclass
class FileSession:
    file_id: str
    leader_id: str | None = None
    members: dict[str, Session] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    # Last edit patch from the leader — replayed to joiners so followers who
    # refresh or arrive late get the current map state immediately.
    last_patch: dict[str, Any] | None = None


_files: dict[str, FileSession] = {}
_global_lock = asyncio.Lock()

# NATO phonetic alphabet — names auto-assigned in join order. After Zulu we
# wrap to Alpha-2, Bravo-2, …
_PHONETIC = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf",
    "Hotel", "India", "Juliett", "Kilo", "Lima", "Mike", "November",
    "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform",
    "Victor", "Whiskey", "Xray", "Yankee", "Zulu",
]


def _assign_callsign(fs: FileSession) -> str:
    """Pick the lowest-index phonetic name not currently taken in this file."""
    taken = {m.display_name for m in fs.members.values()}
    for i in range(0, 1000):
        suffix = "" if i == 0 else f"-{i + 1}"
        for base in _PHONETIC:
            candidate = base + suffix
            if candidate not in taken:
                return candidate
    return "Operator"  # unreachable in practice


async def _get_or_create(file_id: str) -> FileSession:
    async with _global_lock:
        fs = _files.get(file_id)
        if fs is None:
            fs = FileSession(file_id=file_id)
            _files[file_id] = fs
        return fs


def _public_session(s: Session, role: str) -> dict[str, Any]:
    return {
        "session_id": s.id,
        "display_name": s.display_name,
        "role": role,
        "joined_at": s.joined_at,
    }


def _snapshot(fs: FileSession) -> dict[str, Any]:
    """Public view of who's currently in this file's session."""
    sessions = []
    for sid, s in fs.members.items():
        role = "leader" if sid == fs.leader_id else "follower"
        sessions.append(_public_session(s, role))
    return {
        "file_id": fs.file_id,
        "leader_session_id": fs.leader_id,
        "follower_count": max(0, len(fs.members) - (1 if fs.leader_id else 0)),
        "sessions": sessions,
    }


async def _fanout(fs: FileSession, event: dict[str, Any]) -> None:
    """Enqueue an event for every member. Drop on full queue."""
    for s in list(fs.members.values()):
        try:
            s.queue.put_nowait(event)
        except asyncio.QueueFull:
            # Slow consumer — drop oldest, push newest.
            try:
                s.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                s.queue.put_nowait(event)
            except asyncio.QueueFull:
                pass


async def join(file_id: str) -> dict[str, Any]:
    """Register a new session. First joiner becomes leader.

    Display names are auto-assigned NATO phonetic (Alpha, Bravo, …) in join
    order; the frontend doesn't pick its own name.
    """
    fs = await _get_or_create(file_id)
    async with fs.lock:
        now = time.monotonic()
        session_id = str(uuid.uuid4())
        callsign = _assign_callsign(fs)
        s = Session(id=session_id, display_name=callsign, joined_at=now, last_seen=now)
        fs.members[session_id] = s
        if fs.leader_id is None or fs.leader_id not in fs.members:
            fs.leader_id = session_id
        snapshot = _snapshot(fs)
        await _fanout(fs, {"type": "roster", "snapshot": snapshot})
        # Replay the last known map state so the new joiner isn't blank.
        if fs.last_patch is not None:
            replay = {"type": "edit", "from": "__replay__", "patch": fs.last_patch, "ts": time.time()}
            try:
                s.queue.put_nowait(replay)
            except asyncio.QueueFull:
                pass
        return {"session_id": session_id, "snapshot": snapshot}


async def leave(file_id: str, session_id: str) -> None:
    fs = _files.get(file_id)
    if fs is None:
        return
    async with fs.lock:
        s = fs.members.pop(session_id, None)
        if s is None:
            return
        # Sentinel telling the SSE stream for this session to close.
        try:
            s.queue.put_nowait({"type": "_close"})
        except asyncio.QueueFull:
            pass
        # Promote oldest remaining member if the leader left.
        if fs.leader_id == session_id:
            if fs.members:
                fs.leader_id = min(fs.members.values(), key=lambda m: m.joined_at).id
            else:
                fs.leader_id = None
        await _fanout(fs, {"type": "roster", "snapshot": _snapshot(fs)})
    # Garbage-collect empty files.
    if not fs.members:
        async with _global_lock:
            _files.pop(file_id, None)


async def takeover(file_id: str, session_id: str) -> dict[str, Any]:
    """Make `session_id` the leader. Auto-grant — no consent for the MVP."""
    fs = _files.get(file_id)
    if fs is None or session_id not in (fs.members if fs else {}):
        raise KeyError("session not found")
    async with fs.lock:
        fs.leader_id = session_id
        snapshot = _snapshot(fs)
        await _fanout(fs, {"type": "roster", "snapshot": snapshot})
        return snapshot


async def broadcast_edit(file_id: str, session_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Leader posts an edit. Rejected if the caller isn't the current leader."""
    fs = _files.get(file_id)
    if fs is None or session_id not in fs.members:
        raise KeyError("session not found")
    if fs.leader_id != session_id:
        raise PermissionError("not leader")
    fs.last_patch = patch  # cache for late-joiners / refreshers
    event = {"type": "edit", "from": session_id, "patch": patch, "ts": time.time()}
    await _fanout(fs, event)
    return {"delivered_to": len(fs.members)}


async def heartbeat(file_id: str, session_id: str) -> dict[str, Any]:
    """Mark a session as alive. Returns current snapshot for client reconcile."""
    fs = _files.get(file_id)
    if fs is None or session_id not in fs.members:
        raise KeyError("session not found")
    fs.members[session_id].last_seen = time.monotonic()
    return _snapshot(fs)


async def stream(file_id: str, session_id: str):
    """Async generator yielding SSE-formatted lines for one subscriber."""
    fs = _files.get(file_id)
    if fs is None or session_id not in fs.members:
        return
    session = fs.members[session_id]
    # Send initial roster.
    yield _format_sse({"type": "roster", "snapshot": _snapshot(fs)})
    try:
        while True:
            try:
                event = await asyncio.wait_for(session.queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                # Keepalive comment — keeps proxies from closing the socket.
                yield ": keepalive\n\n"
                continue
            if event.get("type") == "_close":
                return
            yield _format_sse(event)
    finally:
        # Best-effort cleanup if the client disconnects.
        await leave(file_id, session_id)


def _format_sse(payload: dict[str, Any]) -> str:
    import json
    return f"data: {json.dumps(payload)}\n\n"

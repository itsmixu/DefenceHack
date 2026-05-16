"""Process-wide async HTTP client.

Providers previously opened a fresh `httpx.AsyncClient` per request. Each
client allocates its own connection pool and per-connection read buffers, so
under load the backend held dozens of clients × upstream response buffers in
memory at once. A single shared client with bounded connection limits caps
that footprint and reuses keep-alive sockets across requests.
"""
from __future__ import annotations

import httpx

_DEFAULT_HEADERS = {"User-Agent": "DefenceHack-IPB/0.1"}
_DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=10.0, pool=10.0)
_DEFAULT_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=_DEFAULT_TIMEOUT,
            headers=_DEFAULT_HEADERS,
            limits=_DEFAULT_LIMITS,
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None

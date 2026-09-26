"""WebSocket channel — the realtime backbone of the app.

Mounted at ``<api_prefix>/ws`` (``/api/ws`` in dev). Together with the
Speculation Rules API on the frontend this is the spine the product is
built on: instant navigation via prerendered routes, live state pushed over
a single socket per client.

Wire format — one JSON envelope in both directions::

    {"type": "<name>", "data": {...}}

Server-built-in types: ``hello`` (sent once on connect), ``ping``/``pong``,
and ``error`` for malformed or unknown messages. Feature routers register
additional types by extending :func:`dispatch_message` — keep this module
the single place that owns connection bookkeeping.

Authentication: when ``AMIGOACT_JWT_SECRET`` is configured, clients must
pass a valid access token as ``?token=<jwt>`` (browsers cannot send
headers on a WebSocket handshake). With no secret configured the channel
runs anonymous — acceptable for local dev only.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from typing import Any

import jwt.exceptions
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.config import Settings, get_settings
from backend.domain.ids import new_id
from backend.security import decode_access_token

logger = logging.getLogger("backend")

WS_CLOSE_UNAUTHORIZED = 4401


class ConnectionManager:
    """Track open sockets by connection id and by user (JWT subject).

    One instance lives on ``app.state.ws_manager`` for the app's lifetime.
    ``_by_user`` maps a token subject to every connection id opened with
    it, so services can push events to "this user on all their tabs".
    """

    def __init__(self) -> None:
        """Start with no connections."""
        self._connections: dict[str, WebSocket] = {}
        self._by_user: dict[str, set[str]] = {}
        self._subject_by_connection: dict[str, str] = {}

    @property
    def size(self) -> int:
        """Current number of open connections (observability + tests)."""
        return len(self._connections)

    async def connect(self, websocket: WebSocket, subject: str | None = None) -> str:
        """Accept the socket, register it, and return its UUIDv7 id.

        When ``subject`` is given (an authenticated user id) the connection
        is additionally indexed under it for :meth:`send_to_users`.
        """
        await websocket.accept()
        connection_id = str(new_id())
        self._connections[connection_id] = websocket
        if subject is not None:
            self._by_user.setdefault(subject, set()).add(connection_id)
            self._subject_by_connection[connection_id] = subject
        return connection_id

    def disconnect(self, connection_id: str) -> None:
        """Forget a socket; safe to call twice."""
        self._connections.pop(connection_id, None)
        subject = self._subject_by_connection.pop(connection_id, None)
        if subject is not None:
            connection_ids = self._by_user.get(subject)
            if connection_ids is not None:
                connection_ids.discard(connection_id)
                if not connection_ids:
                    del self._by_user[subject]

    async def send(self, connection_id: str, message: dict[str, Any]) -> None:
        """Send an envelope to one connection."""
        await self._connections[connection_id].send_json(message)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send an envelope to every connection, dropping sockets that died."""
        dead: list[str] = []
        for connection_id, websocket in self._connections.items():
            try:
                await websocket.send_json(message)
            except Exception:
                dead.append(connection_id)
        for connection_id in dead:
            self.disconnect(connection_id)

    async def send_to_users(self, user_ids: Iterable[str], message: dict[str, Any]) -> None:
        """Send an envelope to every socket owned by any of ``user_ids``.

        Unknown users and dead sockets are skipped/pruned, same discipline
        as :meth:`broadcast`.
        """
        targets: set[str] = set()
        for user_id in user_ids:
            targets.update(self._by_user.get(user_id, ()))
        dead: list[str] = []
        for connection_id in targets:
            websocket = self._connections.get(connection_id)
            if websocket is None:
                dead.append(connection_id)
                continue
            try:
                await websocket.send_json(message)
            except Exception:
                dead.append(connection_id)
        for connection_id in dead:
            self.disconnect(connection_id)


router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Accept a socket, greet it, then dispatch envelopes until it closes."""
    settings = get_settings()
    if settings.jwt_secret:
        subject = await _require_subject(websocket, settings)
        if subject is None:
            return  # socket already closed with 4401
    else:
        subject = None

    manager: ConnectionManager = websocket.app.state.ws_manager
    connection_id = await manager.connect(websocket, subject)
    logger.info("ws %s connected (subject=%s)", connection_id, subject or "anonymous")
    await manager.send(
        connection_id,
        {"type": "hello", "data": {"connection_id": connection_id, "subject": subject}},
    )

    try:
        while True:
            raw = await websocket.receive_text()
            await _dispatch(manager, connection_id, raw)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(connection_id)
        logger.info("ws %s disconnected", connection_id)


async def _require_subject(websocket: WebSocket, settings: Settings) -> str | None:
    """Validate the ``?token=`` JWT, returning its subject.

    Returns ``None`` after closing the socket with ``4401`` when the token
    is missing or invalid.
    """
    token = websocket.query_params.get("token")
    if token:
        try:
            claims = decode_access_token(token, settings)
        except jwt.exceptions.InvalidTokenError:
            pass
        else:
            return str(claims.get("sub"))
    await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
    return None


async def _dispatch(manager: ConnectionManager, connection_id: str, raw: str) -> None:
    """Route one raw frame: built-in protocol here, features extend later."""
    try:
        message: Any = json.loads(raw)
    except json.JSONDecodeError:
        await manager.send(connection_id, _error("message is not valid JSON"))
        return

    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        await manager.send(
            connection_id,
            _error("message must be a JSON object with a string 'type'"),
        )
        return

    if message["type"] == "ping":
        await manager.send(connection_id, {"type": "pong"})
        return

    await manager.send(
        connection_id,
        _error(f"unknown message type: {message['type']}"),
    )


def _error(detail: str) -> dict[str, Any]:
    """Wrap a failure reason in the standard error envelope."""
    return {"type": "error", "data": {"detail": detail}}

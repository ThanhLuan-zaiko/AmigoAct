"""Unit tests for ``ConnectionManager`` — socket bookkeeping, no app.

Layer: **unit**
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest

from backend.websocket import ConnectionManager

pytestmark = pytest.mark.unit


class FakeWebSocket:
    """Records accepted/sent frames instead of owning a real socket."""

    def __init__(self) -> None:
        self.accepted = False
        self.sent: list[dict[str, Any]] = []
        self.fail_send = False

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.fail_send:
            raise RuntimeError("socket already closed")
        self.sent.append(message)


async def _connect(manager: ConnectionManager, socket: FakeWebSocket) -> str:
    return await manager.connect(socket)  # type: ignore[arg-type]


class TestConnectDisconnect:
    """Sockets are registered under a UUIDv7 id and forgotten on disconnect."""

    def test_connect_accepts_and_returns_a_uuid(self) -> None:
        manager, socket = ConnectionManager(), FakeWebSocket()

        connection_id = asyncio.run(_connect(manager, socket))

        assert socket.accepted is True
        assert uuid.UUID(connection_id).version == 7
        assert manager.size == 1

    def test_disconnect_removes_the_socket_and_is_idempotent(self) -> None:
        manager, socket = ConnectionManager(), FakeWebSocket()
        connection_id = asyncio.run(_connect(manager, socket))

        manager.disconnect(connection_id)
        manager.disconnect(connection_id)

        assert manager.size == 0


class TestSendAndBroadcast:
    """Envelopes reach every live socket; dead ones are dropped."""

    def test_send_targets_one_connection(self) -> None:
        manager, socket = ConnectionManager(), FakeWebSocket()
        connection_id = asyncio.run(_connect(manager, socket))

        asyncio.run(manager.send(connection_id, {"type": "pong"}))

        assert socket.sent == [{"type": "pong"}]

    def test_broadcast_reaches_all_and_drops_dead_sockets(self) -> None:
        manager = ConnectionManager()
        alive, dead = FakeWebSocket(), FakeWebSocket()
        dead.fail_send = True
        asyncio.run(_connect(manager, alive))
        asyncio.run(_connect(manager, dead))

        asyncio.run(manager.broadcast({"type": "announce"}))

        assert alive.sent == [{"type": "announce"}]
        assert manager.size == 1  # the dead socket was pruned

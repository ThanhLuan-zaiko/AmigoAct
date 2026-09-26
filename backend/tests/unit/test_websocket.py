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


class TestUserIndexAndSendToUsers:
    """Subject-keyed fan-out: events reach a user on every open socket."""

    def test_send_to_users_reaches_all_sockets_of_that_user(self) -> None:
        manager = ConnectionManager()
        tab_one, tab_two, other = FakeWebSocket(), FakeWebSocket(), FakeWebSocket()
        asyncio.run(manager.connect(tab_one, subject="user-1"))  # type: ignore[arg-type]
        asyncio.run(manager.connect(tab_two, subject="user-1"))  # type: ignore[arg-type]
        asyncio.run(manager.connect(other, subject="user-2"))  # type: ignore[arg-type]

        asyncio.run(manager.send_to_users(["user-1"], {"type": "checkin.recorded"}))

        assert tab_one.sent == [{"type": "checkin.recorded"}]
        assert tab_two.sent == [{"type": "checkin.recorded"}]
        assert other.sent == []

    def test_send_to_users_skips_unknown_users(self) -> None:
        manager, socket = ConnectionManager(), FakeWebSocket()
        asyncio.run(manager.connect(socket, subject="user-1"))  # type: ignore[arg-type]

        asyncio.run(manager.send_to_users(["ghost"], {"type": "x"}))

        assert socket.sent == []

    def test_send_to_users_prunes_dead_sockets(self) -> None:
        manager = ConnectionManager()
        alive, dead = FakeWebSocket(), FakeWebSocket()
        dead.fail_send = True
        asyncio.run(manager.connect(alive, subject="user-1"))  # type: ignore[arg-type]
        asyncio.run(manager.connect(dead, subject="user-1"))  # type: ignore[arg-type]

        asyncio.run(manager.send_to_users(["user-1"], {"type": "x"}))

        assert alive.sent == [{"type": "x"}]
        assert manager.size == 1  # dead socket dropped from both indexes

    def test_disconnect_cleans_the_user_index(self) -> None:
        manager, socket = ConnectionManager(), FakeWebSocket()
        connection_id = asyncio.run(
            manager.connect(socket, subject="user-1")  # type: ignore[arg-type]
        )

        manager.disconnect(connection_id)
        asyncio.run(manager.send_to_users(["user-1"], {"type": "x"}))

        assert socket.sent == []
        assert "user-1" not in manager._by_user

    def test_anonymous_sockets_are_not_user_indexed(self) -> None:
        manager, socket = ConnectionManager(), FakeWebSocket()
        asyncio.run(manager.connect(socket))  # type: ignore[arg-type]  # no subject

        asyncio.run(manager.send_to_users(["user-1"], {"type": "x"}))

        assert socket.sent == []

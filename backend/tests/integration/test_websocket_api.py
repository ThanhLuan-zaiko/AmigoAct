"""Integration tests for the ``/api/ws`` realtime channel.

Real app + real sockets via ``TestClient``; the Oracle pool stays disabled
by the conftest so nothing but the WebSocket path is exercised.

Layer: **integration**
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.config import Settings
from backend.security import create_access_token

pytestmark = pytest.mark.integration

WS_URL = "/api/ws"
WS_SECRET = "integration-secret-0123456789abcdef"


class TestAnonymousChannel:
    """With no JWT secret configured the channel runs anonymous (dev mode)."""

    def test_connect_greets_with_hello(self, client: TestClient, app: FastAPI) -> None:
        with client.websocket_connect(WS_URL) as socket:
            hello = socket.receive_json()

            assert hello["type"] == "hello"
            assert uuid.UUID(hello["data"]["connection_id"]).version == 7
            assert hello["data"]["subject"] is None
            assert app.state.ws_manager.size == 1

        assert app.state.ws_manager.size == 0  # disconnect is cleaned up

    def test_ping_is_answered_with_pong(self, client: TestClient) -> None:
        with client.websocket_connect(WS_URL) as socket:
            socket.receive_json()  # hello

            socket.send_json({"type": "ping"})

            assert socket.receive_json() == {"type": "pong"}

    def test_unknown_message_type_gets_an_error_envelope(self, client: TestClient) -> None:
        with client.websocket_connect(WS_URL) as socket:
            socket.receive_json()

            socket.send_json({"type": "subscribe", "data": {"topic": "x"}})

            reply = socket.receive_json()
            assert reply["type"] == "error"
            assert "unknown message type" in reply["data"]["detail"]

    def test_malformed_frame_gets_an_error_envelope(self, client: TestClient) -> None:
        with client.websocket_connect(WS_URL) as socket:
            socket.receive_json()

            socket.send_text("this is not json")

            reply = socket.receive_json()
            assert reply["type"] == "error"

            socket.send_json(["not", "an", "object"])
            assert socket.receive_json()["type"] == "error"


class TestAuthenticatedChannel:
    """With AMIGOACT_JWT_SECRET set, a valid ``?token=`` is mandatory."""

    def test_missing_token_is_rejected_with_4401(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        with (
            build_client(jwt_secret=WS_SECRET) as client,
            pytest.raises(WebSocketDisconnect) as excinfo,
            client.websocket_connect(WS_URL),
        ):
            pass

        assert excinfo.value.code == 4401

    def test_invalid_token_is_rejected_with_4401(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        with (
            build_client(jwt_secret=WS_SECRET) as client,
            pytest.raises(WebSocketDisconnect) as excinfo,
            client.websocket_connect(f"{WS_URL}?token=not-a-jwt"),
        ):
            pass

        assert excinfo.value.code == 4401

    def test_valid_token_connects_with_subject(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        token = create_access_token("user-uuid-7", Settings(jwt_secret=WS_SECRET))

        with (
            build_client(jwt_secret=WS_SECRET) as client,
            client.websocket_connect(f"{WS_URL}?token={token}") as socket,
        ):
            hello = socket.receive_json()

        assert hello["data"]["subject"] == "user-uuid-7"

    def test_authenticated_socket_is_indexed_by_subject(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        """The manager's user index is what domain-event pushes target."""
        token = create_access_token("user-uuid-7", Settings(jwt_secret=WS_SECRET))

        with (
            build_client(jwt_secret=WS_SECRET) as client,
            client.websocket_connect(f"{WS_URL}?token={token}") as socket,
        ):
            socket.receive_json()  # hello
            app = cast(FastAPI, client.app)
            manager = app.state.ws_manager
            assert "user-uuid-7" in manager._by_user

        # Disconnect must clean both indexes.
        assert "user-uuid-7" not in manager._by_user
        assert manager.size == 0

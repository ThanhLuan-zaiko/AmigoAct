"""Unit tests for the database pool lifecycle and ``get_db_connection``.

No test here touches a real listener — ``oracledb`` is replaced by fakes that
record what the lifecycle did to them.

Layer: **unit**
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import oracledb
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import main
from backend.config import Settings, reset_settings_cache
from backend.database import build_dsn, create_pool, get_db_connection

pytestmark = pytest.mark.unit


class FakeAcquireContext:
    """Stand-in for the async context manager ``pool.acquire()`` returns."""

    def __init__(self, connection: FakeConnection) -> None:
        self._connection = connection

    async def __aenter__(self) -> FakeConnection:
        return self._connection

    async def __aexit__(self, *exc_info: object) -> None:
        return None


class FakeConnection:
    """Records pings instead of talking to Oracle."""

    def __init__(self) -> None:
        self.pings = 0

    async def ping(self) -> None:
        self.pings += 1


class FakePool:
    """Records acquire/close calls made by the lifespan and dependency."""

    def __init__(self) -> None:
        self.connection = FakeConnection()
        self.acquires = 0
        self.closed_with: list[bool] = []

    def acquire(self) -> FakeAcquireContext:
        self.acquires += 1
        return FakeAcquireContext(self.connection)

    async def close(self, force: bool = False) -> None:
        self.closed_with.append(force)


def _enable_db(monkeypatch: pytest.MonkeyPatch, pool: FakePool) -> None:
    """Re-enable the DB path that conftest disables, with a fake pool."""
    monkeypatch.setattr(main, "create_pool", lambda _settings: pool)
    monkeypatch.setenv("AMIGOACT_DB_ENABLED", "true")
    reset_settings_cache()


class TestBuildDsn:
    """The Easy Connect string handed to the driver."""

    def test_combines_host_port_and_service(self) -> None:
        settings = Settings(db_host="db.internal", db_port=1530, db_service="FREEPDB1")

        assert build_dsn(settings) == "db.internal:1530/FREEPDB1"


class TestCreatePool:
    """``create_pool`` forwards settings to ``oracledb.create_pool_async``."""

    def test_passes_settings_through(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = MagicMock(return_value=FakePool())
        monkeypatch.setattr(oracledb, "create_pool_async", factory)

        pool = create_pool(Settings(db_user="scott", db_password="tiger"))

        assert pool is factory.return_value
        factory.assert_called_once_with(
            user="scott",
            password="tiger",
            dsn="localhost:1521/MYORACLEDB",
            min=1,
            max=4,
            increment=1,
        )


class TestLifespanPool:
    """The lifespan creates, verifies, and closes the pool when enabled."""

    def test_enabled_db_creates_and_closes_pool(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        pool = FakePool()
        _enable_db(monkeypatch, pool)
        app = main.create_app()

        with caplog.at_level(logging.INFO, logger="backend"), TestClient(app):
            assert app.state.db_pool is pool
            assert pool.acquires == 1  # startup verification acquired + pinged
            assert pool.connection.pings == 1

        assert pool.closed_with == [True]
        assert "Oracle connection verified" in caplog.text

    def test_disabled_db_leaves_pool_none(
        self, app: FastAPI, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.WARNING, logger="backend"), TestClient(app):
            assert app.state.db_pool is None

        assert "Oracle disabled" in caplog.text

    def test_failed_verification_closes_pool_and_aborts_startup(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        async def _failing_verify(_pool: Any) -> None:
            raise RuntimeError("listener refused")

        pool = FakePool()
        _enable_db(monkeypatch, pool)
        monkeypatch.setattr(main, "verify_pool", _failing_verify)
        app = main.create_app()

        with (
            caplog.at_level(logging.ERROR, logger="backend"),
            pytest.raises(RuntimeError, match="listener refused"),
            TestClient(app),
        ):
            pass

        assert pool.closed_with == [True]
        assert "Oracle connection failed: listener refused" in caplog.text


class TestErrorSummary:
    """Startup failure logs a single compact diagnostic line."""

    def test_multi_line_driver_error_is_flattened(self) -> None:
        exc = RuntimeError(
            "DPY-6005: cannot connect to database (CONNECTION_ID=abc).\n"
            "[WinError 1225] The remote computer refused the network connection\n"
            "Help: https://docs.oracle.com/error-help/db/dpy-6005/"
        )

        assert main._error_summary(exc) == (
            "DPY-6005: cannot connect to database (CONNECTION_ID=abc). "
            "| [WinError 1225] The remote computer refused the network connection"
        )

    def test_messageless_error_falls_back_to_type_name(self) -> None:
        assert main._error_summary(RuntimeError()) == "RuntimeError"


class TestGetDbConnection:
    """The request-scoped dependency that routers will use."""

    def test_raises_when_pool_is_missing(self) -> None:
        request = _request_with_pool(None)

        with pytest.raises(RuntimeError, match="pool is unavailable"):
            asyncio.run(_drain(get_db_connection(request)))

    def test_yields_an_acquired_connection(self) -> None:
        pool = FakePool()
        request = _request_with_pool(pool)

        connections = asyncio.run(_collect(get_db_connection(request)))

        assert connections == [pool.connection]
        assert pool.acquires == 1


def _request_with_pool(pool: object) -> Any:
    app = SimpleNamespace(state=SimpleNamespace(db_pool=pool))
    return SimpleNamespace(app=app)


async def _drain(gen: AsyncIterator[Any]) -> None:
    async for _ in gen:
        pass


async def _collect(gen: AsyncIterator[Any]) -> list[Any]:
    return [item async for item in gen]


class TestBlankEnvValues:
    """Keys-only ``.env`` files must not break validation."""

    def test_blank_string_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AMIGOACT_LOG_LEVEL", "")

        assert Settings().log_level == "INFO"

    def test_blank_list_falls_back_to_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AMIGOACT_CORS_ORIGINS", "")

        assert Settings().cors_origins == []

    def test_present_value_still_wins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AMIGOACT_DB_PORT", "1530")

        assert Settings().db_port == 1530

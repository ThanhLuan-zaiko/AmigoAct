"""Unit tests for the database pool/engine lifecycle and ``get_session``.

No test here touches a real listener — ``oracledb`` and the SQLAlchemy
engine are replaced by fakes that record what the lifecycle did to them.

Layer: **unit**
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import oracledb
import pydantic
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncEngine

from backend import main
from backend.config import Settings, reset_settings_cache
from backend.database import (
    _pin_utc_session,
    build_dsn,
    create_engine_for_pool,
    create_pool,
    get_session,
)

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


class FakeSessionMaker:
    """Async-context-manager factory standing in for ``async_sessionmaker``."""

    def __init__(self, session: object) -> None:
        self.session = session
        self.made = 0

    def __call__(self) -> FakeSessionMaker:
        self.made += 1
        return self

    async def __aenter__(self) -> object:
        return self.session

    async def __aexit__(self, *exc_info: object) -> None:
        return None


def _enable_db(monkeypatch: pytest.MonkeyPatch, pool: FakePool) -> MagicMock:
    """Re-enable the DB path that conftest disables, with fakes.

    ``create_engine_for_pool`` is replaced by a mock returning a fake
    engine so the lifespan never builds a real SQLAlchemy engine (and so
    ``dispose`` can be asserted). Returns the fake engine.
    """
    engine = MagicMock(spec=AsyncEngine)
    engine.dispose = AsyncMock()
    monkeypatch.setattr(main, "create_pool", lambda _settings: pool)
    monkeypatch.setattr(main, "create_engine_for_pool", lambda _pool: engine)
    monkeypatch.setenv("AMIGOACT_DB_ENABLED", "true")
    reset_settings_cache()
    return engine


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
            session_callback=_pin_utc_session,
        )


class TestPinUtcSession:
    """Every fresh pooled session is pinned to UTC so naive binds read as UTC."""

    def test_alters_session_time_zone(self) -> None:
        executed: list[str] = []

        class _Cursor:
            async def execute(self, sql: str) -> None:
                executed.append(sql)

            def close(self) -> None:
                pass

        connection: Any = SimpleNamespace(cursor=lambda: _Cursor())

        asyncio.run(_pin_utc_session(connection, None))

        assert executed == ["ALTER SESSION SET TIME_ZONE = '+00:00'"]


class TestCreateEngineForPool:
    """The SQLAlchemy engine wraps the oracledb pool without connecting."""

    def test_returns_an_async_engine(self) -> None:
        pool: Any = FakePool()

        engine = create_engine_for_pool(pool)

        assert isinstance(engine, AsyncEngine)


class TestLifespanPool:
    """The lifespan creates, verifies, and closes the pool when enabled."""

    def test_enabled_db_creates_and_closes_pool(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        pool = FakePool()
        engine = _enable_db(monkeypatch, pool)
        app = main.create_app()

        with caplog.at_level(logging.INFO, logger="backend"), TestClient(app):
            assert app.state.db_pool is pool
            assert app.state.db_engine is engine
            assert app.state.db_sessionmaker is not None
            assert pool.acquires == 1  # startup verification acquired + pinged
            assert pool.connection.pings == 1

        assert pool.closed_with == [True]
        assert engine.dispose.await_count == 1
        assert "Oracle connection verified" in caplog.text

    def test_disabled_db_leaves_pool_and_sessionmaker_none(
        self, app: FastAPI, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.WARNING, logger="backend"), TestClient(app):
            assert app.state.db_pool is None
            assert app.state.db_engine is None
            assert app.state.db_sessionmaker is None

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


class TestGetSession:
    """The request-scoped dependency that routers use."""

    def test_raises_when_sessionmaker_is_missing(self) -> None:
        request = _request_with_sessionmaker(None)

        with pytest.raises(RuntimeError, match="session factory is unavailable"):
            asyncio.run(_drain(get_session(request)))

    def test_yields_a_session_from_the_factory(self) -> None:
        session = object()
        maker = FakeSessionMaker(session)
        request = _request_with_sessionmaker(maker)

        sessions = asyncio.run(_collect(get_session(request)))

        assert sessions == [session]
        assert maker.made == 1


def _request_with_sessionmaker(maker: object) -> Any:
    app = SimpleNamespace(state=SimpleNamespace(db_sessionmaker=maker))
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

    def test_timezone_default_and_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert Settings().timezone == "Asia/Ho_Chi_Minh"

        monkeypatch.setenv("AMIGOACT_TIMEZONE", "UTC")
        assert Settings().timezone == "UTC"

    def test_bad_timezone_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AMIGOACT_TIMEZONE", "Not/AZone")

        with pytest.raises(pydantic.ValidationError):
            Settings()

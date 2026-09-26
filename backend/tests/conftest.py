"""Shared pytest fixtures for the whole backend test suite.

Layering contract:

* ``unit`` tests use **no** fixture from this file that performs I/O.
* ``integration`` tests build the real app via the :func:`app` fixture and talk
  to it over HTTP with the :func:`client` fixture; the ``db_*`` fixtures swap
  the Oracle pool for a file-backed SQLite database carrying the full ORM
  schema.
* ``regression`` tests reuse both and additionally compare against committed
  snapshots.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from argon2 import PasswordHasher
from argon2.low_level import Type
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import backend.security
from backend.config import ENV_PREFIX, Settings, reset_settings_cache
from backend.database import get_session

# Importing backend.db.base pulls in backend.db, whose __init__ registers
# every model on Base.metadata — so create_all below sees the full schema.
from backend.db.base import Base
from backend.db.session import create_sessionmaker
from backend.main import create_app

# A dedicated secret for the db-backed integration tests; never a real one.
TEST_JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# --------------------------------------------------------------------------
# Environment control
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Force every test to start from a clean, deterministic settings cache.

    ``DB_ENABLED`` is forced off so no test ever needs — or accidentally
    reaches — a real Oracle listener. Tests that exercise the pool path
    override this via ``build_app(db_enabled="true")`` and mock ``oracledb``.

    ``JWT_SECRET`` is blanked so the developer's ``.env`` cannot leak into
    the suite and flip the WebSocket channel into authenticated mode. Tests
    that need auth opt in via ``build_client(jwt_secret=...)``.
    """
    monkeypatch.setenv(f"{ENV_PREFIX}DB_ENABLED", "false")
    monkeypatch.setenv(f"{ENV_PREFIX}JWT_SECRET", "")
    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture
def settings() -> Settings:
    """Return the settings the app under test is using."""
    reset_settings_cache()
    return Settings()


@pytest.fixture
def _fast_password_hasher(monkeypatch: pytest.MonkeyPatch) -> None:
    """Swap in a cheap-parameter argon2id hasher for the duration of a test.

    Still the real algorithm — register/login tests exercise hashing and
    verification end to end — but RFC 9106's default profile (64 MiB, t=3)
    costs ~100 ms+ per call, which would dominate suite time at several
    hashes per request. Opt-in so ``test_security`` keeps checking the real
    production parameters via ``password_needs_rehash``.
    """
    monkeypatch.setattr(
        backend.security,
        "_HASHER",
        PasswordHasher(type=Type.ID, time_cost=1, memory_cost=8192, parallelism=1),
    )


# --------------------------------------------------------------------------
# Integration surface
# --------------------------------------------------------------------------


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    """Build a real application instance for integration and regression tests."""
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A ``TestClient`` bound to :func:`app`, with the lifespan running.

    Entering the context manager triggers the app's ``lifespan`` so that
    ``app.state`` is populated exactly as in production.
    """
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def build_app(monkeypatch: pytest.MonkeyPatch) -> Callable[..., FastAPI]:
    """Return a factory that builds an app with overridden environment.

    ``Settings`` is cached process-wide, so overriding an env var is only
    visible after the cache is cleared. Use this instead of ``monkeypatch``
    alone when a test needs the change to reach the app.

    Example:
        >>> app = build_app(app_name="Staging", api_prefix="/v2")
    """

    def _build(**env_overrides: str) -> FastAPI:
        for key, value in env_overrides.items():
            monkeypatch.setenv(f"{ENV_PREFIX}{key.upper()}", value)
        reset_settings_cache()
        return create_app()

    return _build


@pytest.fixture
def build_client(build_app: Callable[..., FastAPI]) -> Callable[..., TestClient]:
    """Same as :func:`build_app`, returning a live ``TestClient`` instead."""
    return lambda **env_overrides: TestClient(build_app(**env_overrides))


# --------------------------------------------------------------------------
# Database-backed surface (SQLite standing in for Oracle)
# --------------------------------------------------------------------------


def _enable_sqlite_fk(dbapi_connection: Any, _record: Any) -> None:
    """Turn on ``PRAGMA foreign_keys`` for one freshly opened connection.

    SQLite defaults to off; enabling it makes ON DELETE CASCADE/SET NULL
    behave exactly as schema.sql's Oracle constraints do.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@pytest.fixture
def db_sessionmaker(tmp_path: Path) -> Iterator[async_sessionmaker[AsyncSession]]:
    """ORM session factory over a file-backed SQLite database.

    The schema is created with a *sync* engine (plain sqlite3 — no event
    loop subtleties), then queried through an async aiosqlite engine with
    ``NullPool`` so every session checks out a fresh connection that the
    connect listener has already put in foreign-keys mode.
    """
    path = tmp_path / "amigoact-test.db"

    sync_engine = create_engine(f"sqlite:///{path}")
    event.listen(sync_engine, "connect", _enable_sqlite_fk)
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()

    async_engine = create_async_engine(f"sqlite+aiosqlite:///{path}", poolclass=NullPool)
    event.listen(async_engine.sync_engine, "connect", _enable_sqlite_fk)
    yield create_sessionmaker(async_engine)
    async_engine.sync_engine.dispose()


@pytest.fixture
def db_app(
    db_sessionmaker: async_sessionmaker[AsyncSession],
    build_app: Callable[..., FastAPI],
) -> FastAPI:
    """The real app with ``get_session`` pointed at the SQLite test db.

    The Oracle pool stays disabled (``_isolated_settings``), so
    ``app.state.db_sessionmaker`` is ``None`` — the dependency override
    below is what serves sessions to the routers.
    """
    app = build_app(jwt_secret=TEST_JWT_SECRET)

    async def _sqlite_session() -> AsyncIterator[AsyncSession]:
        async with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_session] = _sqlite_session
    return app


@pytest.fixture
def db_client(db_app: FastAPI, _fast_password_hasher: None) -> Iterator[TestClient]:
    """A ``TestClient`` for :func:`db_app` with the lifespan running."""
    with TestClient(db_app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers(
    db_client: TestClient,
) -> Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]:
    """Return a factory registering a user over HTTP.

    The callable returns ``(headers, user)`` — the ``Authorization`` header
    dict for authenticated requests plus the ``user`` payload from the
    register response.
    """

    def _register(
        email: str, password: str, full_name: str
    ) -> tuple[dict[str, str], dict[str, Any]]:
        response = db_client.post(
            "/api/auth/register",
            json={"email": email, "password": password, "full_name": full_name},
        )
        assert response.status_code == 201, response.text
        payload = response.json()
        return {"Authorization": f"Bearer {payload['access_token']}"}, payload["user"]

    return _register


def response_keys(payload: dict[str, Any]) -> set[str]:
    """Return the top-level keys of a JSON payload as a comparable set."""
    return set(payload.keys())

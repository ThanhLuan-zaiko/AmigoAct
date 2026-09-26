"""Shared pytest fixtures for the whole backend test suite.

Layering contract:

* ``unit`` tests use **no** fixture from this file that performs I/O.
* ``integration`` tests build the real app via the :func:`app` fixture and talk
  to it over HTTP with the :func:`client` fixture.
* ``regression`` tests reuse both and additionally compare against committed
  snapshots.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.config import ENV_PREFIX, Settings, reset_settings_cache
from backend.main import create_app

# --------------------------------------------------------------------------
# Environment control
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Force every test to start from a clean, deterministic settings cache.

    ``DB_ENABLED`` is forced off so no test ever needs — or accidentally
    reaches — a real Oracle listener. Tests that exercise the pool path
    override this via ``build_app(db_enabled="true")`` and mock ``oracledb``.
    """
    monkeypatch.setenv(f"{ENV_PREFIX}DB_ENABLED", "false")
    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture
def settings() -> Settings:
    """Return the settings the app under test is using."""
    reset_settings_cache()
    return Settings()


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


def response_keys(payload: dict[str, Any]) -> set[str]:
    """Return the top-level keys of a JSON payload as a comparable set."""
    return set(payload.keys())

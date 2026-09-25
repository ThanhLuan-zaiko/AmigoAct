"""Runtime configuration loaded from the environment.

All settings are read once at import time via :func:`get_settings` so that
tests can override the environment and call :func:`reset_settings_cache`.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_PREFIX = "AMIGOACT_"


class Settings(BaseSettings):
    """Application settings.

    Every field is overridable with an ``AMIGOACT_``-prefixed environment
    variable, e.g. ``AMIGOACT_LOG_LEVEL=debug``.
    """

    model_config = SettingsConfigDict(
        env_prefix=ENV_PREFIX,
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AmigoAct API"
    version: str = "0.1.0"
    environment: str = "development"
    debug: bool = False
    log_level: str = Field(default="INFO", pattern="^(DEBUG|INFO|WARNING|ERROR|CRITICAL)$")
    api_prefix: str = "/api"
    cors_origins: list[str] = Field(default_factory=list)


@lru_cache(maxsize=1)
def _cached_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()


def get_settings() -> Settings:
    """Return the current settings, creating the singleton on first use."""
    return _cached_settings()


def reset_settings_cache() -> None:
    """Drop the cached settings so the next :func:`get_settings` re-reads env.

    Used by the test suite after ``monkeypatch.setenv``.
    """
    _cached_settings.cache_clear()

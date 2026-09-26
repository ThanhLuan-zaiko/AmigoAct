"""Runtime configuration loaded from the environment.

All settings are read once at import time via :func:`get_settings` so that
tests can override the environment and call :func:`reset_settings_cache`.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

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
    # NoDecode: pydantic-settings would JSON-decode the raw env string before
    # validators run, so a blank value would crash before reaching the
    # blank-to-default hook. Decoding happens in _decode_cors_origins instead.
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # Oracle Database connection (python-oracledb, thin mode — no Instant
    # Client needed). The pool is created in the app lifespan when
    # ``db_enabled`` is true; the app fails to start if the database is
    # unreachable.
    db_enabled: bool = True
    db_host: str = "localhost"
    db_port: int = 1521
    db_service: str = "MYORACLEDB"
    db_user: str = "amigoact"
    db_password: str = ""
    db_pool_min: int = 1
    db_pool_max: int = 4
    db_pool_increment: int = 1

    # Admin username used ONLY by scripts/reset_db.py to drop and recreate
    # ``db_user``; the app never uses it. The admin password is deliberately
    # NOT a setting — reset_db.py reads AMIGOACT_DB_ADMIN_PASSWORD from the
    # real environment or prompts for it, so it never lands in .env.
    db_admin_user: str = "SYSTEM"

    # Auth — JWT bearer tokens, issued and verified only by this backend
    # (see security.py). The secret is env-only and has no default: token
    # helpers raise loudly when it is unset.
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_ttl_seconds: int = 3600
    jwt_issuer: str = "amigoact"

    # Business timezone: an IANA name deciding which calendar date a moment
    # falls on (volunteer_records.awarded_on, certificates). All timestamps
    # are stored in UTC; this is only the local-date lens. The ``tzdata``
    # package supplies the IANA database on Windows, which has none.
    timezone: str = "Asia/Ho_Chi_Minh"

    @field_validator("timezone")
    @classmethod
    def _timezone_must_be_iana(cls, value: str) -> str:
        """Reject anything :class:`zoneinfo.ZoneInfo` cannot resolve."""
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            msg = f"unknown IANA timezone: {value!r}"
            raise ValueError(msg) from exc
        return value

    @field_validator("*", mode="before")
    @classmethod
    def _blank_env_falls_back_to_default(cls, value: object, info: ValidationInfo) -> object:
        """Treat an empty ``.env`` value as "unset" so the field default applies.

        ``.env.example`` ships keys with no values; without this hook a copied
        file would fail validation (e.g. ``log_level=""`` breaks the pattern).
        """
        if value == "" and info.field_name is not None:
            return cls.model_fields[info.field_name].get_default()
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _decode_cors_origins(cls, value: object) -> object:
        """Parse the JSON array env value that ``NoDecode`` left as a string."""
        if isinstance(value, str):
            stripped = value.strip()
            parsed: object = json.loads(stripped) if stripped else []
            return parsed
        return value


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

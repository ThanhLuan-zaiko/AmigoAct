"""Liveness and readiness endpoints.

These are the endpoints deployment probes and the CI smoke test rely on, so
their response shape is additionally locked down by
``tests/regression/test_health_contract.py``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from backend.config import get_settings
from backend.domain.greeting import build_greeting

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, Any]:
    """Report that the process is up and serving requests."""
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": settings.version,
        "environment": settings.environment,
    }


@router.get("/health/ready")
async def readiness() -> dict[str, Any]:
    """Report readiness to accept traffic."""
    return {"status": "ready"}


@router.get("/greeting")
async def greeting(name: str | None = None) -> dict[str, Any]:
    """Echo a generated greeting, used to demo the unit test target."""
    return {"message": build_greeting(name)}

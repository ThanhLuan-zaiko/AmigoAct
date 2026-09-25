"""AmigoAct API service.

Exposes the FastAPI application factory and the ASGI ``app`` object used by
``uvicorn backend.main:app`` and by the integration test suite.
"""

from __future__ import annotations

from backend.main import app, create_app

__all__ = ["app", "create_app"]

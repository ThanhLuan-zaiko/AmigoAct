"""FastAPI application factory and ASGI entrypoint.

Run locally with::

    uv run uvicorn backend.main:app --reload
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.routers import health
from backend.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage startup and shutdown resources.

    Args:
        app: The application being started.

    Yields:
        Control back to the server while it handles requests.
    """
    settings = get_settings()
    app.state.settings = settings
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False


def create_app() -> FastAPI:
    """Build and configure a fresh :class:`~fastapi.FastAPI` application."""
    settings = get_settings()

    application = FastAPI(
        title=settings.app_name,
        version=settings.version,
        summary="AmigoAct platform API",
        lifespan=lifespan,
    )

    if settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    application.include_router(health.router, prefix=settings.api_prefix)

    @application.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        """Turn domain ``ValueError``s into a 422 instead of a 500."""
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @application.get("/version", tags=["meta"])
    async def version() -> dict[str, Any]:
        """Return the running service version."""
        return {"name": settings.app_name, "version": settings.version}

    return application


app = create_app()

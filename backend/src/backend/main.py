"""FastAPI application factory and ASGI entrypoint.

Run locally with::

    uv run uvicorn backend.main:app --reload
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import oracledb
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.routers import health
from backend.config import get_settings
from backend.database import build_dsn, create_pool, verify_pool
from backend.websocket import ConnectionManager
from backend.websocket import router as ws_router

logger = logging.getLogger("backend")


def _error_summary(exc: BaseException) -> str:
    """Compress a driver error to its meaningful lines, minus the docs URL.

    oracledb errors span multiple lines — the DPY-/ORA- line, an OS-level
    cause (e.g. ``[WinError 1225] ... refused``), and a ``Help: https://…``
    footer that carries no diagnostic value.
    """
    lines = [
        line.strip()
        for line in str(exc).splitlines()
        if line.strip() and not line.strip().startswith("Help:")
    ]
    return " | ".join(lines) or type(exc).__name__


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

    pool: oracledb.AsyncConnectionPool | None = None
    if settings.db_enabled:
        dsn = build_dsn(settings)
        logger.info("connecting to Oracle at %s as %s", dsn, settings.db_user)
        pool = create_pool(settings)
        try:
            await verify_pool(pool)
        except BaseException as exc:
            await pool.close(force=True)
            logger.error("Oracle connection failed: %s", _error_summary(exc))
            raise
        logger.info("Oracle connection verified: %s", dsn)
    else:
        logger.warning("Oracle disabled (AMIGOACT_DB_ENABLED=false)")
    app.state.db_pool = pool
    app.state.ws_manager = ConnectionManager()

    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False
        if pool is not None:
            await pool.close(force=True)


def create_app() -> FastAPI:
    """Build and configure a fresh :class:`~fastapi.FastAPI` application."""
    settings = get_settings()
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(name)s: %(message)s")

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
    application.include_router(ws_router, prefix=settings.api_prefix)

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

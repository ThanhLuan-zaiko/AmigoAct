"""Oracle connection pool lifecycle and the FastAPI dependency that serves it.

python-oracledb runs in thin mode, so no Oracle Instant Client is required —
the driver speaks to the listener at ``db_host:db_port`` directly. The pool
is created during the application lifespan when ``Settings.db_enabled`` is
true and exposed as ``app.state.db_pool``; routers receive a connection per
request through :func:`get_db_connection`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import oracledb
from fastapi import Request

from backend.config import Settings


def build_dsn(settings: Settings) -> str:
    """Return the Easy Connect ``host:port/service`` string for a settings object."""
    return f"{settings.db_host}:{settings.db_port}/{settings.db_service}"


def create_pool(settings: Settings) -> oracledb.AsyncConnectionPool:
    """Build the async connection pool.

    Pool creation itself performs no network I/O in thin mode; connections
    are opened lazily on :meth:`~oracledb.AsyncConnectionPool.acquire`.
    """
    return oracledb.create_pool_async(
        user=settings.db_user,
        password=settings.db_password,
        dsn=build_dsn(settings),
        min=settings.db_pool_min,
        max=settings.db_pool_max,
        increment=settings.db_pool_increment,
    )


async def verify_pool(pool: oracledb.AsyncConnectionPool) -> None:
    """Acquire a connection and ping the database, surfacing failures loudly.

    Called once at startup so a missing or misconfigured database aborts the
    boot instead of surprising the first request that needs a connection.
    """
    async with pool.acquire() as connection:
        await connection.ping()


async def get_db_connection(request: Request) -> AsyncIterator[oracledb.AsyncConnection]:
    """Yield a pooled connection for the duration of a request.

    Raises:
        RuntimeError: If no pool exists — either ``AMIGOACT_DB_ENABLED`` is
            false or startup pool verification failed.
    """
    pool: oracledb.AsyncConnectionPool | None = request.app.state.db_pool
    if pool is None:
        raise RuntimeError(
            "Database pool is unavailable: AMIGOACT_DB_ENABLED is false "
            "or pool creation failed at startup."
        )
    async with pool.acquire() as connection:
        yield connection

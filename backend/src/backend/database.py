"""Oracle pool + SQLAlchemy async engine lifecycle and session dependency.

python-oracledb runs in thin mode, so no Oracle Instant Client is required —
the driver speaks to the listener at ``db_host:db_port`` directly. The pool
is created during the application lifespan when ``Settings.db_enabled`` is
true and exposed as ``app.state.db_pool``.

A SQLAlchemy :class:`~sqlalchemy.ext.asyncio.AsyncEngine` is layered on top
of the *same* pool via ``async_creator=pool.acquire`` (the documented
python-oracledb/SA integration): SQLAlchemy's own pooling is disabled with
:class:`~sqlalchemy.pool.NullPool`, so ``session.close()`` hands the
connection straight back to the oracledb pool.

Timezone discipline: the thin driver fetches ``TIMESTAMP WITH TIME ZONE``
as *naive* wall-clock values and interprets naive binds in the session
timezone. Every pooled session is therefore pinned to UTC by
:func:`_pin_utc_session`, and :class:`~backend.db.types.UtcDateTime` binds
aware values as naive UTC and re-attaches ``tzinfo=utc`` on reads. All
application timestamps are aware UTC end to end.

Routers receive an :class:`~sqlalchemy.ext.asyncio.AsyncSession` per
request through :func:`get_session`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import oracledb
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from backend.config import Settings


def build_dsn(settings: Settings) -> str:
    """Return the Easy Connect ``host:port/service`` string for a settings object."""
    return f"{settings.db_host}:{settings.db_port}/{settings.db_service}"


async def _pin_utc_session(connection: oracledb.AsyncConnection, requested_tag: str | None) -> None:
    """Pin one freshly created pooled session's timezone to UTC.

    Passed to :func:`oracledb.create_pool_async` as ``session_callback`` —
    it runs once per *new* physical session, not per checkout, so the cost
    is paid ``min``/``increment`` times rather than per request.
    """
    del requested_tag  # tagging is unused; the pin applies to every session
    cursor = connection.cursor()
    try:
        await cursor.execute("ALTER SESSION SET TIME_ZONE = '+00:00'")
    finally:
        cursor.close()


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
        session_callback=_pin_utc_session,
    )


async def verify_pool(pool: oracledb.AsyncConnectionPool) -> None:
    """Acquire a connection and ping the database, surfacing failures loudly.

    Called once at startup so a missing or misconfigured database aborts the
    boot instead of surprising the first request that needs a connection.
    """
    async with pool.acquire() as connection:
        await connection.ping()


def create_engine_for_pool(pool: oracledb.AsyncConnectionPool) -> AsyncEngine:
    """Layer a SQLAlchemy async engine on top of the oracledb pool.

    ``pool.acquire()`` returns an ``AsyncConnection`` directly; with
    :class:`~sqlalchemy.pool.NullPool` the engine performs no pooling of its
    own and each checked-out session releases the connection back to the
    oracledb pool on close.
    """
    return create_async_engine(
        "oracle+oracledb://",
        async_creator=pool.acquire,
        poolclass=NullPool,
    )


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a request-scoped ORM session from the app's session factory.

    Raises:
        RuntimeError: If no sessionmaker exists — either
            ``AMIGOACT_DB_ENABLED`` is false or startup pool verification
            failed.
    """
    maker = request.app.state.db_sessionmaker
    if maker is None:
        raise RuntimeError(
            "Database session factory is unavailable: AMIGOACT_DB_ENABLED is "
            "false or pool creation failed at startup."
        )
    async with maker() as session:
        yield session

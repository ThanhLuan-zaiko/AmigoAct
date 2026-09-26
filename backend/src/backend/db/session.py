"""Async session factory built on a SQLAlchemy async engine."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Return the request-scoped session factory for ``engine``.

    ``expire_on_commit=False`` keeps attributes readable after commit —
    every column value is supplied Python-side, so no post-commit refresh
    (which would need an awkward async RETURNING round-trip) is required.
    """
    return async_sessionmaker(engine, expire_on_commit=False)

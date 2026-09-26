"""Account operations: registration and authentication.

Field rules (email shape, password bounds, name normalization) live in
:mod:`backend.domain.accounts`; this module owns the persistence side —
uniqueness checks, hashing, and row creation — against an
:class:`~sqlalchemy.ext.asyncio.AsyncSession`.

Timing discipline: argon2id is deliberately CPU-heavy, so hashing and
verifying always run in a worker thread (``asyncio.to_thread``) and never
on the event loop. :func:`authenticate` verifies against a real argon2id
hash even when the account does not exist, so an attacker cannot tell
"unknown email" from "wrong password" by response time.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import utcnow
from backend.db.models import User
from backend.domain.accounts import (
    normalize_email,
    normalize_full_name,
    validate_password,
)
from backend.domain.errors import AuthenticationError, ConflictError
from backend.domain.ids import new_id
from backend.security import hash_password, verify_password

# Real argon2id hash of a throwaway password, generated once at authoring
# time. ``authenticate`` verifies against it when the email is unknown so
# the failure path costs the same argon2 pass as a real account.
_DUMMY_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$CyBCjW7xnH5BBCqBiLqHBA$"
    "/0Qb5XP1XWrZp6dg5UAcRAL4sXbdn3T7PH+D3pkIMtc"
)


async def register(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
) -> User:
    """Create a user account and return the persisted row.

    Args:
        session: Request-scoped ORM session; the commit happens here.
        email: Raw email — normalized (stripped, lowercased) before use.
        password: Raw password — hashed with argon2id before storage.
        full_name: Raw display name — whitespace-normalized.

    Raises:
        RuleViolationError: On invalid email, password, or name.
        ConflictError: With ``code="email_taken"`` when the email is already
            registered — checked up front, and again via the unique
            constraint as a race backstop.
    """
    normalized_email = normalize_email(email)
    validate_password(password)
    normalized_name = normalize_full_name(full_name)

    existing = await session.scalar(select(User.id).where(User.email == normalized_email))
    if existing is not None:
        raise ConflictError("email already registered", code="email_taken")

    # argon2id is CPU-bound by design; never hash on the event loop.
    password_hash = await asyncio.to_thread(hash_password, password)
    user = User(
        id=new_id(),
        email=normalized_email,
        password_hash=password_hash,
        full_name=normalized_name,
        is_active=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("email already registered", code="email_taken") from exc
    return user


async def authenticate(session: AsyncSession, *, email: str, password: str) -> User:
    """Return the user for ``email``/``password`` or raise.

    Args:
        session: Request-scoped ORM session (read-only here).
        email: Raw email — normalized before lookup.
        password: Raw password — verified against the stored argon2id hash.

    Raises:
        AuthenticationError: ``invalid_credentials`` for unknown email or
            wrong password (one code for both — no user enumeration);
            ``account_disabled`` when ``is_active`` is false.
    """
    normalized_email = normalize_email(email)
    user = await session.scalar(select(User).where(User.email == normalized_email))

    # Verify against a real argon2id hash either way: the dummy keeps the
    # "unknown email" path's timing indistinguishable from "wrong password".
    ok = await asyncio.to_thread(
        verify_password,
        user.password_hash if user is not None else _DUMMY_HASH,
        password,
    )
    if user is None or not ok:
        raise AuthenticationError("invalid credentials", code="invalid_credentials")
    if not user.is_active:
        raise AuthenticationError("account is disabled", code="account_disabled")
    return user

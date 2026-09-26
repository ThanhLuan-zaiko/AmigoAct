"""Shared FastAPI dependencies — bearer-token authentication.

``get_current_user`` is the dependency every authenticated route takes:
it validates the ``Authorization: Bearer <jwt>`` header, resolves the
token subject to a live :class:`~backend.db.models.User` row, and raises
:class:`~backend.domain.errors.AuthenticationError` for every failure so
the error handler can emit a consistent 401.
"""

from __future__ import annotations

import uuid

import jwt.exceptions
from fastapi import Depends
from fastapi.security import HTTPBearer
from fastapi.security.http import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from backend.config import get_settings
from backend.database import get_session
from backend.db.models import User
from backend.domain.errors import AuthenticationError
from backend.security import decode_access_token

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Resolve the bearer token to the current user row.

    Args:
        request: The incoming request (provides app state).
        credentials: Parsed ``Authorization`` header, or ``None``.
        session: Request-scoped ORM session.

    Returns:
        The authenticated, still-active :class:`User`.

    Raises:
        AuthenticationError: ``missing_token`` without a header,
            ``token_invalid`` for any verification/lookup failure, and
            ``account_disabled`` when the account is deactivated.
    """
    if credentials is None:
        raise AuthenticationError("missing bearer token", code="missing_token")

    try:
        claims = decode_access_token(credentials.credentials, get_settings())
    except jwt.exceptions.InvalidTokenError as exc:
        raise AuthenticationError("invalid token", code="token_invalid") from exc

    try:
        user_id = uuid.UUID(str(claims.get("sub", "")))
    except ValueError as exc:
        raise AuthenticationError("invalid token", code="token_invalid") from exc

    user = await session.get(User, user_id)
    if user is None:
        raise AuthenticationError("invalid token", code="token_invalid")
    if not user.is_active:
        raise AuthenticationError("account is disabled", code="account_disabled")
    return user

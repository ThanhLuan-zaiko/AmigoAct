"""Backend-owned authentication core: argon2id hashing and JWT tokens.

Two responsibilities live here and nowhere else:

* Password hashing via **argon2id** (argon2-cffi, RFC 9106 recommended
  profile). Stored hashes are self-describing (``$argon2id$v=19$...``), so
  parameter upgrades later are handled by :func:`password_needs_rehash`.
* JWT bearer tokens via PyJWT. Tokens carry ``sub``, ``iat``, ``exp`` and
  ``iss``; the secret comes only from ``AMIGOACT_JWT_SECRET`` — both helpers
  fail loudly when it is unset rather than signing with an empty key.
"""

from __future__ import annotations

import time
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

from backend.config import Settings

# RFC 9106's second recommended argon2id profile (t=3, m=64 MiB, p=4) is the
# argon2-cffi default; Type.ID is pinned explicitly so the algorithm is never
# left to a library default changing underneath us.
_HASHER = PasswordHasher(type=Type.ID)


def hash_password(password: str) -> str:
    """Hash ``password`` with argon2id and return the encoded hash string."""
    return _HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Check ``password`` against an argon2id hash; ``False`` on any mismatch.

    A malformed or foreign-format hash is also ``False`` — never an
    exception — so login paths have one decision to make.
    """
    try:
        return _HASHER.verify(password_hash, password)
    except VerifyMismatchError, VerificationError, InvalidHashError:
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """Return ``True`` when a stored hash uses older argon2 parameters."""
    return _HASHER.check_needs_rehash(password_hash)


def create_access_token(
    subject: str,
    settings: Settings,
    *,
    claims: dict[str, Any] | None = None,
) -> str:
    """Sign a JWT for ``subject`` with ``iat``/``exp``/``iss`` claims.

    Args:
        subject: Identity the token represents (a UUIDv7 string).
        settings: Source of the signing secret, algorithm, ttl, issuer.
        claims: Optional extra claims. Reserved claims (``sub``, ``iat``,
            ``exp``, ``iss``) are always overwritten by the authoritative
            values, so callers cannot forge them.

    Raises:
        RuntimeError: If ``AMIGOACT_JWT_SECRET`` is not configured.
    """
    if not settings.jwt_secret:
        raise RuntimeError("AMIGOACT_JWT_SECRET is not configured")
    now = int(time.time())
    payload = {
        **(claims or {}),
        "sub": subject,
        "iat": now,
        "exp": now + settings.jwt_ttl_seconds,
        "iss": settings.jwt_issuer,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    """Verify and decode a JWT, returning its claims.

    Raises:
        RuntimeError: If ``AMIGOACT_JWT_SECRET`` is not configured.
        jwt.exceptions.InvalidTokenError: On any verification failure —
            bad signature, expired, wrong issuer. Callers translate this to
            401/403; it is never swallowed here.
    """
    if not settings.jwt_secret:
        raise RuntimeError("AMIGOACT_JWT_SECRET is not configured")
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        issuer=settings.jwt_issuer,
    )

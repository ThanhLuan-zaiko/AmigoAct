"""Account field rules — pure validation, no I/O.

Normalizers here are the single source of truth for what a usable email,
password, or display name looks like. They raise
:class:`~backend.domain.errors.RuleViolationError` with a stable ``code`` so
the API layer can return a structured 422.
"""

from __future__ import annotations

import re

from backend.domain.errors import RuleViolationError

EMAIL_MAX_LENGTH = 320
EMAIL_LOCAL_MAX_LENGTH = 64
EMAIL_DOMAIN_MAX_LENGTH = 255
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
FULL_NAME_MAX_LENGTH = 120

# One @, no whitespace, local part and domain bounded. Deliberately laxer
# than RFC 5321 — deliverability checks are out of scope; shape is not.
_EMAIL_PATTERN = re.compile(
    rf"^[^@\s]{{1,{EMAIL_LOCAL_MAX_LENGTH}}}@[^@\s]{{1,{EMAIL_DOMAIN_MAX_LENGTH}}}$"
)


def normalize_email(raw: str) -> str:
    """Trim and lowercase ``raw``, then check it is a plausible address.

    Args:
        raw: Email exactly as submitted.

    Returns:
        The normalized address: stripped and fully lowercased (the schema's
        ``ck_users_email`` CHECK requires lowercase storage).

    Raises:
        RuleViolationError: With ``code="invalid_email"`` when the shape is
            unusable or the total length exceeds :data:`EMAIL_MAX_LENGTH`.
    """
    candidate = raw.strip().lower()
    if len(candidate) > EMAIL_MAX_LENGTH or _EMAIL_PATTERN.fullmatch(candidate) is None:
        raise RuleViolationError("invalid email address", code="invalid_email")
    return candidate


def validate_password(raw: str) -> str:
    """Check ``raw`` is an acceptable password and return it unchanged.

    Args:
        raw: Password exactly as submitted (never normalized — case and
            internal whitespace are significant).

    Returns:
        ``raw``, so callers can write ``password = validate_password(raw)``.

    Raises:
        RuleViolationError: ``password_too_short`` or ``password_too_long``.
    """
    if len(raw) < PASSWORD_MIN_LENGTH:
        raise RuleViolationError(
            f"password must be at least {PASSWORD_MIN_LENGTH} characters",
            code="password_too_short",
        )
    if len(raw) > PASSWORD_MAX_LENGTH:
        raise RuleViolationError(
            f"password must be at most {PASSWORD_MAX_LENGTH} characters",
            code="password_too_long",
        )
    return raw


def normalize_full_name(raw: str) -> str:
    """Collapse whitespace in a display name and bound its length.

    Args:
        raw: Display name exactly as submitted.

    Returns:
        The name with runs of whitespace reduced to one space and no
        leading/trailing whitespace.

    Raises:
        RuleViolationError: With ``code="invalid_name"`` when empty or longer
            than :data:`FULL_NAME_MAX_LENGTH` after normalization.
    """
    collapsed = " ".join(raw.split())
    if not collapsed or len(collapsed) > FULL_NAME_MAX_LENGTH:
        raise RuleViolationError(
            "full name must be 1.."
            f"{FULL_NAME_MAX_LENGTH} characters after whitespace normalization",
            code="invalid_name",
        )
    return collapsed

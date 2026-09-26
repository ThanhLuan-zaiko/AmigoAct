"""Organization and roster field rules — pure validation, no I/O.

Single source of truth for what a usable org code, org name, or roster
field looks like. Every normalizer that can produce ``None`` exists because
Oracle stores ``''`` as ``NULL`` — a blank optional input is normalized to
``None`` once, here, instead of being spread across the codebase.

Role ordering is expressed as :data:`ROLE_RANK` so "is at least a manager"
checks are integer comparisons rather than string comparisons.
"""

from __future__ import annotations

import re

from backend.domain.accounts import normalize_email, normalize_full_name
from backend.domain.errors import RuleViolationError

ORG_CODE_PATTERN = re.compile(r"^[A-Z0-9]{3,32}$")
ORG_NAME_MAX_LENGTH = 200
ORG_DESCRIPTION_MAX_LENGTH = 2000
STUDENT_CODE_MAX_LENGTH = 32
CLASS_NAME_MAX_LENGTH = 64
FACULTY_MAX_LENGTH = 120

# Ordered from least to most privileged. Comparing ranks answers "is at
# least a manager" without enumerating roles.
ROLE_RANK = {"member": 0, "manager": 1, "admin": 2}
MEMBER_ROLES = frozenset(ROLE_RANK)
MEMBER_STATUSES = frozenset({"active", "inactive"})


def normalize_org_code(raw: str) -> str:
    """Trim and uppercase ``raw``, then check it is a usable org handle.

    Args:
        raw: Org code exactly as submitted.

    Returns:
        The normalized code: stripped and uppercased (the schema's
        ``ck_organizations_code`` CHECK requires uppercase storage).

    Raises:
        RuleViolationError: With ``code="invalid_org_code"`` when the value
            is not 3-32 uppercase ASCII letters/digits after normalization.
    """
    candidate = raw.strip().upper()
    if ORG_CODE_PATTERN.fullmatch(candidate) is None:
        raise RuleViolationError(
            "org code must be 3-32 uppercase letters or digits",
            code="invalid_org_code",
        )
    return candidate


def normalize_org_name(raw: str) -> str:
    """Collapse whitespace in an org's display name and bound its length.

    Raises:
        RuleViolationError: With ``code="invalid_org_name"`` when empty or
            longer than :data:`ORG_NAME_MAX_LENGTH` after normalization.
    """
    collapsed = " ".join(raw.split())
    if not collapsed or len(collapsed) > ORG_NAME_MAX_LENGTH:
        raise RuleViolationError(
            f"org name must be 1..{ORG_NAME_MAX_LENGTH} characters after whitespace normalization",
            code="invalid_org_name",
        )
    return collapsed


def normalize_optional(raw: str | None, max_length: int, *, field: str = "value") -> str | None:
    """Collapse whitespace in an optional field; blank becomes ``None``.

    Oracle stores ``''`` as ``NULL``, so "empty" and "absent" are the same
    state — normalizing once here keeps every writer consistent.

    Args:
        raw: Value as submitted, or ``None``.
        max_length: Maximum allowed length after normalization.
        field: Field name used in the error message.

    Returns:
        ``None`` when ``raw`` is absent or blank, else the collapsed string.

    Raises:
        RuleViolationError: With ``code="value_too_long"`` when the
            normalized value exceeds ``max_length``.
    """
    if raw is None:
        return None
    collapsed = " ".join(raw.split())
    if not collapsed:
        return None
    if len(collapsed) > max_length:
        raise RuleViolationError(
            f"{field} must be at most {max_length} characters",
            code="value_too_long",
        )
    return collapsed


def normalize_org_description(raw: str | None) -> str | None:
    """Normalize the optional org description (≤2000 chars)."""
    return normalize_optional(raw, ORG_DESCRIPTION_MAX_LENGTH, field="description")


def normalize_contact_email(raw: str | None) -> str | None:
    """Normalize an optional contact email: blank → ``None``, else email rules.

    Raises:
        RuleViolationError: With ``code="invalid_email"`` when non-blank but
            not a plausible address.
    """
    if raw is None or not raw.strip():
        return None
    return normalize_email(raw)


def rank(role: str) -> int:
    """Return the privilege rank of ``role``.

    Raises:
        KeyError: On a role outside :data:`ROLE_RANK` — stored roles are
            bound by a CHECK constraint, so an unknown role is a bug, not
            input to be coerced.
    """
    return ROLE_RANK[role]


def is_manager(role: str) -> bool:
    """Return ``True`` when ``role`` is manager or admin."""
    return rank(role) >= ROLE_RANK["manager"]


def normalize_student_code(raw: str | None) -> str | None:
    """Normalize an optional student/member code (≤32, case preserved)."""
    return normalize_optional(raw, STUDENT_CODE_MAX_LENGTH, field="student_code")


def normalize_class_name(raw: str | None) -> str | None:
    """Normalize an optional class/chi đoàn name (≤64)."""
    return normalize_optional(raw, CLASS_NAME_MAX_LENGTH, field="class_name")


def normalize_faculty(raw: str | None) -> str | None:
    """Normalize an optional faculty/khoa name (≤120)."""
    return normalize_optional(raw, FACULTY_MAX_LENGTH, field="faculty")


def normalize_member_name(raw: str) -> str:
    """Normalize a required roster display name (same rule as user names).

    Raises:
        RuleViolationError: With ``code="invalid_name"`` when unusable.
    """
    return normalize_full_name(raw)

"""Volunteer-record field rules — pure validation, no I/O.

A :class:`~backend.db.models.VolunteerRecord` is the official achievement
record (ghi nhận thành tích). Most rows are minted when an activity
completes, but staff may also record external service standalone — these
rules govern what a record's editable fields may look like in both paths.

Bounds mirror ``schema.sql``: ``title`` VARCHAR2(200), ``note``
VARCHAR2(1000), ``evidence_url`` VARCHAR2(500), ``hours``/``points``
NUMBER(6,2).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from typing import Protocol

from backend.domain.errors import RuleViolationError

RECORD_TITLE_MAX_LENGTH = 200
RECORD_NOTE_MAX_LENGTH = 1000
EVIDENCE_URL_MAX_LENGTH = 500
AWARD_MAX = Decimal("9999.99")  # NUMBER(6,2) in schema.sql

_EVIDENCE_URL_PATTERN = re.compile(r"^https?://")


def normalize_record_title(raw: str) -> str:
    """Collapse whitespace in a record title and bound it to 1..200 chars.

    Unlike activity titles (3..200), a standalone record may carry a single
    short word — the floor is one visible character.

    Raises:
        RuleViolationError: With ``code="invalid_title"`` when empty or
            longer than :data:`RECORD_TITLE_MAX_LENGTH` after normalization.
    """
    collapsed = " ".join(raw.split())
    if not collapsed or len(collapsed) > RECORD_TITLE_MAX_LENGTH:
        raise RuleViolationError(
            f"title must be 1..{RECORD_TITLE_MAX_LENGTH} characters after whitespace normalization",
            code="invalid_title",
        )
    return collapsed


def normalize_record_note(raw: str | None) -> str | None:
    """Normalize an optional record note (≤1000 chars); blank → ``None``."""
    if raw is None:
        return None
    collapsed = " ".join(raw.split())
    if not collapsed:
        return None
    if len(collapsed) > RECORD_NOTE_MAX_LENGTH:
        raise RuleViolationError(
            f"note must be at most {RECORD_NOTE_MAX_LENGTH} characters",
            code="value_too_long",
        )
    return collapsed


def normalize_evidence_url(raw: str | None) -> str | None:
    """Normalize an optional evidence link; blank → ``None``.

    Only ``http``/``https`` URLs are accepted — a certificate reader should
    never be sent to a ``javascript:`` or ``file:`` scheme.

    Raises:
        RuleViolationError: ``value_too_long`` past 500 chars after
            trimming; ``invalid_evidence_url`` when non-blank but not an
            http(s) URL.
    """
    if raw is None:
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None
    if len(trimmed) > EVIDENCE_URL_MAX_LENGTH:
        raise RuleViolationError(
            f"evidence_url must be at most {EVIDENCE_URL_MAX_LENGTH} characters",
            code="value_too_long",
        )
    if _EVIDENCE_URL_PATTERN.match(trimmed) is None:
        raise RuleViolationError(
            "evidence_url must start with http:// or https://",
            code="invalid_evidence_url",
        )
    return trimmed


def validate_record_award(hours: Decimal | None, points: Decimal) -> None:
    """Check a recorded award's bounds.

    ``hours`` is nullable — participation may be recorded without credited
    hours — while ``points`` is always present (0 allowed).

    Raises:
        RuleViolationError: ``invalid_hours`` / ``invalid_points`` when a
            present value falls outside ``0..AWARD_MAX``.
    """
    if hours is not None and (hours < 0 or hours > AWARD_MAX):
        raise RuleViolationError(
            f"hours must be 0..{AWARD_MAX} or null",
            code="invalid_hours",
        )
    if points < 0 or points > AWARD_MAX:
        raise RuleViolationError(
            f"points must be 0..{AWARD_MAX}",
            code="invalid_points",
        )


def parse_awarded_on(raw: str | date | None, today: date) -> date:
    """Resolve the award date: ISO string, ``date``, or ``today``.

    A record can only certify the past — backdating is allowed (a manager
    may record last term's service) but future-dating is not.

    Args:
        raw: The submitted value: ISO ``YYYY-MM-DD`` string, a ``date``,
            or ``None``.
        today: The current business date, supplied by the caller so the
            rule stays clock-free.

    Returns:
        The resolved award date.

    Raises:
        RuleViolationError: ``invalid_awarded_on`` for an unparseable
            string, a datetime, an explicit ``None``-as-date misuse is
            impossible — ``None`` means "today"; ``future_awarded_on``
            when the resolved date is after ``today``.
    """
    if raw is None:
        return today
    if isinstance(raw, datetime):
        raise RuleViolationError(
            "awarded_on must be a date, not a datetime",
            code="invalid_awarded_on",
        )
    if isinstance(raw, str):
        try:
            parsed = date.fromisoformat(raw)
        except ValueError as exc:
            raise RuleViolationError(
                f"awarded_on must be an ISO date, got {raw!r}",
                code="invalid_awarded_on",
            ) from exc
    else:
        parsed = raw
    if parsed > today:
        raise RuleViolationError(
            "awarded_on cannot be in the future",
            code="future_awarded_on",
        )
    return parsed


class HasHours(Protocol):
    """Anything exposing a nullable ``hours`` award field."""

    @property
    def hours(self) -> Decimal | None:
        """Credited hours; ``None`` counts as zero."""


def sum_hours(records: Iterable[HasHours]) -> Decimal:
    """Total credited hours across ``records``.

    ``None`` means "no hours credited" (a participation-only record) and
    counts as zero — the sum stays a real ``Decimal``, never ``NaN``.
    """
    total = Decimal("0")
    for record in records:
        if record.hours is not None:
            total += record.hours
    return total

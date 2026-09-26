"""Activity lifecycle and scheduling rules — pure validation, no I/O.

An activity moves ``draft -> published -> completed`` (or ``cancelled``
from either live state); ``cancelled`` and ``completed`` are terminal.
All rules are expressed over :class:`ActivitySchedule`, a structural
protocol the ORM :class:`~backend.db.models.Activity` satisfies — the
domain stays free of SQLAlchemy while services pass entities straight in.

Every timestamp that reaches these functions must be timezone-aware: the
``UtcDateTime`` column type rejects naive datetimes at bind time, and the
domain rejects them earlier with ``code="naive_datetime"`` so the API can
return a structured 422 rather than a bind-time ``ValueError``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Protocol

from backend.domain.errors import ConflictError, RuleViolationError

ACTIVITY_STATUSES = frozenset({"draft", "published", "cancelled", "completed"})

# Allowed status transitions; absent keys are terminal states.
TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"published", "cancelled"}),
    "published": frozenset({"cancelled", "completed"}),
}

# Check-in opens this many minutes before the activity starts.
CHECKIN_EARLY_MINUTES = 60

TITLE_MIN_LENGTH = 3
TITLE_MAX_LENGTH = 200
LOCATION_MAX_LENGTH = 300
DESCRIPTION_MAX_LENGTH = 20000
CAPACITY_MAX = 99_999_999  # NUMBER(8) in schema.sql
AWARD_MAX = Decimal("9999.99")  # NUMBER(6,2) in schema.sql


class ActivitySchedule(Protocol):
    """The schedule fields the rules below read off an activity-like object."""

    status: str
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    starts_at: datetime
    ends_at: datetime


def _require_aware(value: datetime, field: str) -> None:
    """Reject naive datetimes loudly — they have no defined instant."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise RuleViolationError(
            f"{field} must be a timezone-aware datetime",
            code="naive_datetime",
        )


def require_transition(current: str, target: str) -> None:
    """Assert ``current -> target`` is an allowed status transition.

    Raises:
        ConflictError: With ``code="invalid_transition"`` when the pair is
            not in :data:`TRANSITIONS` (including from a terminal state).
    """
    if target not in TRANSITIONS.get(current, frozenset()):
        raise ConflictError(
            f"cannot transition activity from {current!r} to {target!r}",
            code="invalid_transition",
        )


def normalize_activity_title(raw: str) -> str:
    """Collapse whitespace in an activity title and bound its length.

    Raises:
        RuleViolationError: With ``code="invalid_title"`` when not 3-200
            characters after normalization.
    """
    collapsed = " ".join(raw.split())
    if len(collapsed) < TITLE_MIN_LENGTH or len(collapsed) > TITLE_MAX_LENGTH:
        raise RuleViolationError(
            f"title must be {TITLE_MIN_LENGTH}..{TITLE_MAX_LENGTH} "
            "characters after whitespace normalization",
            code="invalid_title",
        )
    return collapsed


def normalize_location(raw: str | None) -> str | None:
    """Normalize an optional location (≤300 chars); blank → ``None``."""
    if raw is None:
        return None
    collapsed = " ".join(raw.split())
    if not collapsed:
        return None
    if len(collapsed) > LOCATION_MAX_LENGTH:
        raise RuleViolationError(
            f"location must be at most {LOCATION_MAX_LENGTH} characters",
            code="value_too_long",
        )
    return collapsed


def normalize_description(raw: str | None) -> str | None:
    """Normalize an optional description (≤20000 chars); blank → ``None``.

    Internal whitespace (including newlines) is preserved — only the
    surrounding edges are trimmed, so multi-paragraph text survives.
    """
    if raw is None:
        return None
    stripped = raw.strip()
    if not stripped:
        return None
    if len(stripped) > DESCRIPTION_MAX_LENGTH:
        raise RuleViolationError(
            f"description must be at most {DESCRIPTION_MAX_LENGTH} characters",
            code="value_too_long",
        )
    return stripped


def validate_capacity(capacity: int | None) -> int | None:
    """Check ``capacity`` is ``None`` (unlimited) or within ``1..CAPACITY_MAX``.

    Raises:
        RuleViolationError: With ``code="invalid_capacity"`` otherwise.
    """
    if capacity is None:
        return None
    if capacity < 1 or capacity > CAPACITY_MAX:
        raise RuleViolationError(
            f"capacity must be 1..{CAPACITY_MAX} or null",
            code="invalid_capacity",
        )
    return capacity


def validate_awards(hours: Decimal, points: Decimal) -> None:
    """Check the default awards are within ``0..AWARD_MAX``.

    Raises:
        RuleViolationError: ``invalid_hours`` or ``invalid_points``.
    """
    if hours < 0 or hours > AWARD_MAX:
        raise RuleViolationError(
            f"hours must be 0..{AWARD_MAX}",
            code="invalid_hours",
        )
    if points < 0 or points > AWARD_MAX:
        raise RuleViolationError(
            f"points must be 0..{AWARD_MAX}",
            code="invalid_points",
        )


def validate_schedule(
    title: str,
    starts_at: datetime,
    ends_at: datetime,
    registration_opens_at: datetime | None,
    registration_closes_at: datetime | None,
) -> str:
    """Validate title plus the activity/registration windows.

    Args:
        title: Activity title — normalized and returned.
        starts_at: Activity start (must be aware).
        ends_at: Activity end (must be aware, after ``starts_at``).
        registration_opens_at: Optional registration open.
        registration_closes_at: Optional registration close; never later
            than ``starts_at``, and ≥ opens when both are set.

    Returns:
        The normalized title.

    Raises:
        RuleViolationError: ``invalid_title``, ``naive_datetime``, or
            ``invalid_window`` (end not after start; close before open;
            close after start).
    """
    normalized_title = normalize_activity_title(title)
    _require_aware(starts_at, "starts_at")
    _require_aware(ends_at, "ends_at")
    if registration_opens_at is not None:
        _require_aware(registration_opens_at, "registration_opens_at")
    if registration_closes_at is not None:
        _require_aware(registration_closes_at, "registration_closes_at")

    if ends_at <= starts_at:
        raise RuleViolationError(
            "ends_at must be after starts_at",
            code="invalid_window",
        )
    if (
        registration_opens_at is not None
        and registration_closes_at is not None
        and registration_closes_at < registration_opens_at
    ):
        raise RuleViolationError(
            "registration_closes_at must not precede registration_opens_at",
            code="invalid_window",
        )
    # Registration must close before the activity starts — a member cannot
    # sign up for something already underway. Applies whenever a close is set.
    if registration_closes_at is not None and registration_closes_at > starts_at:
        raise RuleViolationError(
            "registration_closes_at must not be after starts_at",
            code="invalid_window",
        )
    return normalized_title


def checkin_window(activity: ActivitySchedule) -> tuple[datetime, datetime]:
    """Return ``(opens_at, closes_at)`` for check-in to ``activity``.

    Check-in opens :data:`CHECKIN_EARLY_MINUTES` before the start and runs
    until the activity ends.
    """
    opens_at = activity.starts_at - timedelta(minutes=CHECKIN_EARLY_MINUTES)
    return opens_at, activity.ends_at


def checkin_allowed_at(now: datetime, activity: ActivitySchedule) -> None:
    """Assert ``now`` falls inside the check-in window.

    Raises:
        ConflictError: ``checkin_not_started`` before the window opens,
            ``checkin_ended`` after it closes.
    """
    opens_at, closes_at = checkin_window(activity)
    if now < opens_at:
        raise ConflictError(
            f"check-in opens {CHECKIN_EARLY_MINUTES} minutes before the activity starts",
            code="checkin_not_started",
        )
    if now > closes_at:
        raise ConflictError("check-in has ended", code="checkin_ended")


def registration_window_open(activity: ActivitySchedule, now: datetime) -> None:
    """Assert registration is currently open for ``activity``.

    The window runs from ``registration_opens_at`` (default: always open)
    to ``registration_closes_at`` (default: ``starts_at``), close inclusive.

    Raises:
        ConflictError: With ``code="registration_closed"`` when the activity
            is not published or ``now`` lies outside the window.
    """
    if activity.status != "published":
        raise ConflictError(
            "registration is only open on published activities",
            code="registration_closed",
        )
    opens_at = activity.registration_opens_at
    if opens_at is not None and now < opens_at:
        raise ConflictError("registration has not opened yet", code="registration_closed")
    closes_at = activity.registration_closes_at or activity.starts_at
    if now > closes_at:
        raise ConflictError("registration has closed", code="registration_closed")


def can_publish(activity: ActivitySchedule, now: datetime) -> None:
    """Assert ``activity`` may transition draft → published at ``now``.

    Raises:
        ConflictError: ``invalid_transition`` from any non-draft state,
            ``activity_over`` when the activity already ended.
    """
    require_transition(activity.status, "published")
    if activity.ends_at <= now:
        raise ConflictError("cannot publish an activity that has ended", code="activity_over")


def can_complete(activity: ActivitySchedule, now: datetime) -> None:
    """Assert ``activity`` may transition published → completed at ``now``.

    Raises:
        ConflictError: ``invalid_transition`` from any non-published state,
            ``not_started`` before ``starts_at``.
    """
    require_transition(activity.status, "completed")
    if now < activity.starts_at:
        raise ConflictError(
            "cannot complete an activity before it starts",
            code="not_started",
        )


def can_edit(activity: ActivitySchedule) -> None:
    """Assert ``activity`` is still editable (not in a terminal state).

    Raises:
        ConflictError: With ``code="terminal_state"`` when cancelled or
            completed.
    """
    if activity.status in {"cancelled", "completed"}:
        raise ConflictError(
            f"cannot edit a {activity.status} activity",
            code="terminal_state",
        )

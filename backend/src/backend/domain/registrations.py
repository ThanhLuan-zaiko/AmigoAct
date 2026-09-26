"""Registration lifecycle rules — pure decisions, no I/O.

``activity_registrations`` is the association object between members and
activities; its ``status`` carries the review lifecycle
(``pending -> approved/rejected``, or ``cancelled`` by the member). Both
``pending`` and ``approved`` count toward capacity — registrations are a
first-come queue, so a pending seat is a seat taken.

The functions here either return a decision (``decide_*``) or raise a
:class:`~backend.domain.errors.ConflictError` with a stable ``code``
(``may_*``, ``*_eligible``, ``capacity_available``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from backend.domain.errors import ConflictError, RuleViolationError

REGISTRATION_STATUSES = frozenset({"pending", "approved", "rejected", "cancelled"})

# Both pending and approved registrations hold a seat: the roster is a
# first-come queue, not a lottery — a pending sign-up blocks the slot
# until it is rejected or cancelled.
ACTIVE_STATUSES = frozenset({"pending", "approved"})

_REVIEW_ACTIONS = {"approve": "approved", "reject": "rejected"}


class RegistrationState(Protocol):
    """The fields the rules below read off a registration-like object."""

    status: str
    checked_in_at: datetime | None


def decide_register(existing_status: str | None) -> str:
    """Decide what a register attempt means given any prior registration.

    Args:
        existing_status: Status of the member's existing row, or ``None``.

    Returns:
        ``"new"`` (no prior row) or ``"reactivate"`` (prior row was
        cancelled — it returns to ``pending``).

    Raises:
        ConflictError: ``already_registered`` when pending or approved;
            ``registration_rejected`` when the row was rejected — a
            rejection is final, not a queue position.
    """
    if existing_status is None:
        return "new"
    if existing_status == "cancelled":
        return "reactivate"
    if existing_status == "rejected":
        raise ConflictError(
            "a rejected registration cannot be resubmitted",
            code="registration_rejected",
        )
    raise ConflictError("already registered for this activity", code="already_registered")


def may_cancel(
    reg_status: str,
    checked_in_at: datetime | None,
    activity_status: str,
) -> None:
    """Assert a member may cancel their registration.

    Only ``pending``/``approved`` registrations without a check-in can be
    cancelled, and only while the activity itself is live (a completed or
    cancelled activity freezes the record).

    Raises:
        ConflictError: With ``code="cannot_cancel"`` otherwise.
    """
    if (
        reg_status in {"pending", "approved"}
        and checked_in_at is None
        and activity_status not in {"completed", "cancelled"}
    ):
        return
    raise ConflictError("this registration can no longer be cancelled", code="cannot_cancel")


def decide_review(reg: RegistrationState, action: str) -> str:
    """Decide the target status of a manager review.

    A ``pending`` registration may be approved or rejected; an ``approved``
    one may still be rejected (revoking approval) — unless the member
    already checked in, at which point the record is frozen.

    Args:
        reg: Registration-like object (status + checked_in_at).
        action: ``"approve"`` or ``"reject"``.

    Returns:
        The target status — ``"approved"`` or ``"rejected"``.

    Raises:
        RuleViolationError: With ``code="invalid_review_action"`` for any
            other action.
        ConflictError: ``cannot_review_checked_in`` when the member already
            checked in; ``cannot_review`` for a state that cannot move.
    """
    if action not in _REVIEW_ACTIONS:
        raise RuleViolationError(
            f"review action must be one of {sorted(_REVIEW_ACTIONS)}",
            code="invalid_review_action",
        )
    if reg.checked_in_at is not None:
        raise ConflictError(
            "a checked-in registration cannot be reviewed",
            code="cannot_review_checked_in",
        )
    if reg.status == "pending" or (reg.status == "approved" and action == "reject"):
        return _REVIEW_ACTIONS[action]
    raise ConflictError(
        f"cannot {action} a {reg.status} registration",
        code="cannot_review",
    )


def checkin_eligible(reg: RegistrationState) -> None:
    """Assert ``reg`` is approved and therefore allowed to check in.

    Raises:
        ConflictError: With ``code="registration_not_approved"`` otherwise —
            one code covers missing, pending, rejected, and cancelled rows
            so the check-in flow does not distinguish them.
    """
    if reg.status != "approved":
        raise ConflictError(
            "registration is not approved for this activity",
            code="registration_not_approved",
        )


def capacity_available(capacity: int | None, active_count: int) -> None:
    """Assert the activity has a seat left for a new active registration.

    Args:
        capacity: Activity capacity; ``None`` means unlimited.
        active_count: Current count of pending + approved registrations.

    Raises:
        ConflictError: With ``code="activity_full"`` when full.
    """
    if capacity is not None and active_count >= capacity:
        raise ConflictError("activity has reached its capacity", code="activity_full")


def normalize_note(raw: str | None) -> str | None:
    """Normalize an optional member note (≤500 chars); blank → ``None``."""
    if raw is None:
        return None
    collapsed = " ".join(raw.split())
    if not collapsed:
        return None
    if len(collapsed) > 500:
        raise RuleViolationError("note must be at most 500 characters", code="value_too_long")
    return collapsed

"""Check-in operations: the QR/code path plus code lifecycle management.

Two ways in exist by design:

* :func:`checkin_by_code` — the member-facing path: correct code, inside
  the check-in window, on a published activity, with an approved
  registration.
* ``services.registrations.manager_checkin`` — the manager-facing manual
  path for people at the door; it skips code and window but still needs a
  published activity and an approved registration.

Both emit one ``checkin.recorded`` event built by
:func:`build_checkin_recorded_event`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import utcnow
from backend.db.models import Activity, ActivityRegistration, OrgMember, User
from backend.domain import checkin as rules
from backend.domain.activities import can_edit, checkin_allowed_at
from backend.domain.errors import ConflictError, NotFoundError
from backend.domain.registrations import checkin_eligible
from backend.services.events import (
    EVENT_CHECKIN_RECORDED,
    DomainEvent,
    activity_changed_event,
    event_targets,
    org_staff_user_ids,
)
from backend.services.memberships import require_membership, require_org_role

_CHECKIN_CODE_ATTEMPTS = 5


@dataclass(frozen=True)
class CheckinCodeResult:
    """Outcome of asking for an activity's check-in code."""

    code: str
    rotated: bool


async def build_checkin_recorded_event(
    session: AsyncSession,
    activity: Activity,
    registration: ActivityRegistration,
    member: OrgMember | None,
    checked_in_count: int,
) -> DomainEvent:
    """Build ``checkin.recorded`` aimed at org staff + the member's user."""
    staff = await org_staff_user_ids(session, activity.org_id)
    return DomainEvent(
        type=EVENT_CHECKIN_RECORDED,
        data={
            "org_id": str(activity.org_id),
            "activity_id": str(activity.id),
            "registration_id": str(registration.id),
            "member_user_id": str(member.user_id) if member and member.user_id else None,
            "member_full_name": member.full_name if member else None,
            "checked_in_at": (
                registration.checked_in_at.isoformat() if registration.checked_in_at else None
            ),
            "checked_in_count": checked_in_count,
        },
        user_ids=event_targets(staff, member.user_id if member else None),
    )


async def checkin_by_code(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    code: str,
    *,
    now: datetime | None = None,
) -> tuple[tuple[ActivityRegistration, bool, int], list[DomainEvent]]:
    """Check the caller in by code; idempotent on repeat check-ins.

    Guard order is deliberate: code and window are checked before the
    registration, so a wrong code answers ``wrong_checkin_code`` regardless
    of the caller's registration state.

    Raises:
        RuleViolationError: ``invalid_code``.
        NotFoundError: ``activity_not_found``.
        PermissionDeniedError: ``not_a_member``.
        ConflictError: ``activity_not_published``, ``wrong_checkin_code``,
            ``checkin_not_started``/``checkin_ended``,
            ``registration_not_approved``.
    """
    normalized = rules.normalize_checkin_code(code)
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    member = await require_membership(session, activity.org_id, user.id)
    if activity.status != "published":
        raise ConflictError("check-in requires a published activity", code="activity_not_published")
    if not rules.codes_match(activity.checkin_code, normalized):
        raise ConflictError("wrong check-in code", code="wrong_checkin_code")
    checkin_allowed_at(now or utcnow(), activity)

    registration = await session.scalar(
        select(ActivityRegistration)
        .where(
            ActivityRegistration.activity_id == activity.id,
            ActivityRegistration.member_id == member.id,
        )
        .with_for_update()
    )
    if registration is None:
        # Same code as a non-approved row: a pending/rejected member learns
        # nothing extra from the check-in path.
        raise ConflictError(
            "registration is not approved for this activity",
            code="registration_not_approved",
        )
    checkin_eligible(registration)
    already = registration.checked_in_at is not None
    if not already:
        registration.checked_in_at = utcnow()
        await session.flush()
    checked_in_count = (
        await session.scalar(
            select(func.count(ActivityRegistration.id)).where(
                ActivityRegistration.activity_id == activity.id,
                ActivityRegistration.checked_in_at.is_not(None),
            )
        )
    ) or 0
    await session.commit()

    events: list[DomainEvent] = []
    if not already:
        events.append(
            await build_checkin_recorded_event(
                session, activity, registration, member, checked_in_count
            )
        )
    return (registration, already, checked_in_count), events


async def set_checkin_code(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    *,
    rotate: bool,
) -> tuple[CheckinCodeResult, list[DomainEvent]]:
    """Return the activity's check-in code, generating one when needed.

    Codes may be prepared while the activity is still a draft (printing
    signage ahead of publishing); ``rotate=True`` forces a fresh code.
    Uniqueness is per-org — pre-checked, then raced against the unique
    index a handful of times before giving up.

    Raises:
        NotFoundError: ``activity_not_found``.
        PermissionDeniedError: ``not_a_member`` / ``insufficient_role``.
        ConflictError: ``terminal_state`` when the activity is cancelled or
            completed; ``checkin_code_unavailable`` after retry exhaustion.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    await require_org_role(session, activity.org_id, user.id, "manager")
    can_edit(activity)
    if activity.checkin_code is not None and not rotate:
        return CheckinCodeResult(code=activity.checkin_code, rotated=False), []

    staff = await org_staff_user_ids(session, activity.org_id)
    for _attempt in range(_CHECKIN_CODE_ATTEMPTS):
        candidate = rules.generate_checkin_code()
        taken = await session.scalar(
            select(Activity.id).where(
                Activity.org_id == activity.org_id,
                Activity.checkin_code == candidate,
                Activity.id != activity.id,
            )
        )
        if taken is not None:
            continue
        activity.checkin_code = candidate
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            activity = await session.get(Activity, activity_id, with_for_update=True)
            if activity is None:
                raise NotFoundError("activity not found", code="activity_not_found") from None
            continue
        event = activity_changed_event(activity, staff)
        return CheckinCodeResult(code=candidate, rotated=True), [event]
    raise ConflictError(
        "could not allocate a unique check-in code", code="checkin_code_unavailable"
    )


async def revoke_checkin_code(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
) -> tuple[None, list[DomainEvent]]:
    """Clear an activity's check-in code; managers only.

    Raises:
        NotFoundError: ``activity_not_found``.
        PermissionDeniedError: ``not_a_member`` / ``insufficient_role``.
        ConflictError: ``terminal_state``.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    await require_org_role(session, activity.org_id, user.id, "manager")
    can_edit(activity)
    activity.checkin_code = None
    await session.commit()
    staff = await org_staff_user_ids(session, activity.org_id)
    return None, [activity_changed_event(activity, staff)]

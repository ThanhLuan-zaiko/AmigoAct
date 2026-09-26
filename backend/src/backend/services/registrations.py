"""Registration operations: register, cancel, review, list, manual check-in.

The register path locks the activity row (``with_for_update``) so capacity
checks and inserts serialize — on Oracle this is a real row lock; on the
SQLite test database it is a no-op but exercises the same code path.

Every function commits its own writes and returns ``(result, events)``;
routers publish the events after the service returns.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import utcnow
from backend.db.models import (
    Activity,
    ActivityRegistration,
    Organization,
    OrgMember,
    User,
)
from backend.domain import registrations as rules
from backend.domain.activities import registration_window_open
from backend.domain.errors import ConflictError, NotFoundError, RuleViolationError
from backend.domain.ids import new_id
from backend.services.checkin import build_checkin_recorded_event
from backend.services.events import (
    EVENT_REGISTRATION_CHANGED,
    DomainEvent,
    event_targets,
    org_staff_user_ids,
)
from backend.services.memberships import get_membership, require_membership, require_org_role


@dataclass(frozen=True)
class RegistrationRow:
    """A registration joined to its member row and the member's email."""

    registration: ActivityRegistration
    member: OrgMember
    email: str | None


@dataclass(frozen=True)
class MyRegistration:
    """One of the caller's registrations, joined to activity and org."""

    registration: ActivityRegistration
    activity: Activity
    org: Organization


@dataclass(frozen=True)
class CheckinResult:
    """Outcome of a check-in: the registration plus idempotency info."""

    registration: ActivityRegistration
    already_checked_in: bool
    checked_in_count: int


async def _registration_changed_event(
    session: AsyncSession,
    org_id: uuid.UUID,
    registration: ActivityRegistration,
    member_user_id: uuid.UUID | None,
) -> DomainEvent:
    """Build ``registration.changed`` aimed at org staff + the member."""
    staff = await org_staff_user_ids(session, org_id)
    return DomainEvent(
        type=EVENT_REGISTRATION_CHANGED,
        data={
            "org_id": str(org_id),
            "activity_id": str(registration.activity_id),
            "registration_id": str(registration.id),
            "member_id": str(registration.member_id),
            "status": registration.status,
        },
        user_ids=event_targets(staff, member_user_id),
    )


async def register(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    note: str | None,
    *,
    now: datetime | None = None,
) -> tuple[ActivityRegistration, list[DomainEvent]]:
    """Register the caller (as an org member) for ``activity_id``.

    Re-registering after a cancellation reactivates the existing row back
    to ``pending``; pending/approved rows raise ``already_registered`` and
    rejected rows ``registration_rejected``.

    Raises:
        NotFoundError: ``activity_not_found``.
        PermissionDeniedError: ``not_a_member``.
        ConflictError: ``registration_closed``, ``already_registered``,
            ``registration_rejected``, ``activity_full``.
        RuleViolationError: ``value_too_long`` for an over-length note.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    member = await require_membership(session, activity.org_id, user.id)
    norm_note = rules.normalize_note(note)

    registration_window_open(activity, now or utcnow())

    existing = await session.scalar(
        select(ActivityRegistration)
        .where(
            ActivityRegistration.activity_id == activity.id,
            ActivityRegistration.member_id == member.id,
        )
        .with_for_update()
    )
    decision = rules.decide_register(existing.status if existing else None)

    active_count = await session.scalar(
        select(func.count(ActivityRegistration.id)).where(
            ActivityRegistration.activity_id == activity.id,
            ActivityRegistration.status.in_(rules.ACTIVE_STATUSES),
        )
    )
    rules.capacity_available(activity.capacity, active_count or 0)

    if decision == "new":
        registration = ActivityRegistration(
            id=new_id(),
            activity_id=activity.id,
            member_id=member.id,
            status="pending",
            note=norm_note,
        )
        session.add(registration)
    elif existing is not None:  # "reactivate" — a cancelled row rejoins the queue
        existing.status = "pending"
        existing.note = norm_note
        existing.reviewed_by = None
        existing.reviewed_at = None
        existing.checked_in_at = None
        registration = existing
    else:  # unreachable: decide_register maps every other case to an error
        raise ConflictError("cannot register", code="already_registered")

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            "already registered for this activity", code="already_registered"
        ) from exc
    event = await _registration_changed_event(
        session, activity.org_id, registration, member.user_id
    )
    return registration, [event]


async def _activity_of_registration(
    session: AsyncSession, registration_id: uuid.UUID
) -> tuple[ActivityRegistration, Activity]:
    """Fetch a registration and its activity, or raise uniformly.

    Both missing rows answer ``registration_not_found`` — a registration
    without an activity cannot exist (FK cascade), so one error suffices.
    """
    registration = await session.get(ActivityRegistration, registration_id, with_for_update=True)
    if registration is None:
        raise NotFoundError("registration not found", code="registration_not_found")
    activity = await session.get(Activity, registration.activity_id)
    if activity is None:
        raise NotFoundError("registration not found", code="registration_not_found")
    return registration, activity


async def cancel_registration(
    session: AsyncSession,
    user: User,
    registration_id: uuid.UUID,
) -> tuple[ActivityRegistration, list[DomainEvent]]:
    """Cancel the caller's own pending/approved registration.

    Raises:
        NotFoundError: ``registration_not_found`` — also used when the row
            belongs to someone else, so registration ids don't leak.
        ConflictError: ``cannot_cancel``.
    """
    registration, activity = await _activity_of_registration(session, registration_id)
    member = await get_membership(session, activity.org_id, user.id)
    if member is None or registration.member_id != member.id:
        raise NotFoundError("registration not found", code="registration_not_found")

    rules.may_cancel(registration.status, registration.checked_in_at, activity.status)
    registration.status = "cancelled"
    await session.commit()
    event = await _registration_changed_event(
        session, activity.org_id, registration, member.user_id
    )
    return registration, [event]


async def review_registration(
    session: AsyncSession,
    user: User,
    registration_id: uuid.UUID,
    action: str,
) -> tuple[ActivityRegistration, list[DomainEvent]]:
    """Approve or reject a registration; managers of the org only.

    Raises:
        NotFoundError: ``registration_not_found``.
        PermissionDeniedError: ``not_a_member`` / ``insufficient_role``.
        RuleViolationError: ``invalid_review_action``.
        ConflictError: ``cannot_review``, ``cannot_review_checked_in``.
    """
    registration, activity = await _activity_of_registration(session, registration_id)
    reviewer = await require_org_role(session, activity.org_id, user.id, "manager")

    registration.status = rules.decide_review(registration, action)
    registration.reviewed_by = reviewer.id
    registration.reviewed_at = utcnow()
    await session.commit()

    target_member = await session.get(OrgMember, registration.member_id)
    member_user_id = target_member.user_id if target_member is not None else None
    event = await _registration_changed_event(
        session, activity.org_id, registration, member_user_id
    )
    return registration, [event]


async def list_registrations(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    status_filter: str | None = None,
) -> tuple[list[RegistrationRow], list[DomainEvent]]:
    """List an activity's registrations with member details; managers only.

    Raises:
        NotFoundError: ``activity_not_found``.
        PermissionDeniedError: ``not_a_member`` / ``insufficient_role``.
        RuleViolationError: ``invalid_status`` for a bad filter value.
    """
    if status_filter is not None and status_filter not in rules.REGISTRATION_STATUSES:
        raise RuleViolationError(
            f"unknown registration status: {status_filter}", code="invalid_status"
        )
    activity = await session.get(Activity, activity_id)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    await require_org_role(session, activity.org_id, user.id, "manager")

    conditions = [ActivityRegistration.activity_id == activity_id]
    if status_filter is not None:
        conditions.append(ActivityRegistration.status == status_filter)
    rows = (
        await session.execute(
            select(ActivityRegistration, OrgMember, User.email)
            .join(OrgMember, ActivityRegistration.member_id == OrgMember.id)
            .outerjoin(User, OrgMember.user_id == User.id)
            .where(*conditions)
            .order_by(ActivityRegistration.created_at, ActivityRegistration.id)
        )
    ).all()
    return [
        RegistrationRow(registration=reg, member=member, email=email) for reg, member, email in rows
    ], []


async def my_registrations(
    session: AsyncSession, user: User
) -> tuple[list[MyRegistration], list[DomainEvent]]:
    """Return every registration the caller holds, newest first."""
    rows = (
        await session.execute(
            select(ActivityRegistration, Activity, Organization)
            .join(Activity, ActivityRegistration.activity_id == Activity.id)
            .join(Organization, Activity.org_id == Organization.id)
            .join(OrgMember, ActivityRegistration.member_id == OrgMember.id)
            .where(OrgMember.user_id == user.id)
            .order_by(ActivityRegistration.created_at.desc(), ActivityRegistration.id)
        )
    ).all()
    return [
        MyRegistration(registration=reg, activity=activity, org=org) for reg, activity, org in rows
    ], []


async def manager_checkin(
    session: AsyncSession,
    user: User,
    registration_id: uuid.UUID,
) -> tuple[CheckinResult, list[DomainEvent]]:
    """Check in a registration manually at the door; managers only.

    Bypasses the code and the early window (the manager is physically
    present) but still requires an approved registration on a *published*
    activity. Idempotent: re-checking returns ``already_checked_in=True``
    without touching ``checked_in_at`` and emits no second event.

    Raises:
        NotFoundError: ``registration_not_found``.
        PermissionDeniedError: ``not_a_member`` / ``insufficient_role``.
        ConflictError: ``registration_not_approved``,
            ``activity_not_published``.
    """
    registration, activity = await _activity_of_registration(session, registration_id)
    await require_org_role(session, activity.org_id, user.id, "manager")

    already = registration.checked_in_at is not None
    if not already:
        rules.checkin_eligible(registration)
        if activity.status != "published":
            raise ConflictError(
                "check-in requires a published activity",
                code="activity_not_published",
            )
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
        member = await session.get(OrgMember, registration.member_id)
        events.append(
            await build_checkin_recorded_event(
                session, activity, registration, member, checked_in_count
            )
        )
    result = CheckinResult(
        registration=registration,
        already_checked_in=already,
        checked_in_count=checked_in_count,
    )
    return result, events

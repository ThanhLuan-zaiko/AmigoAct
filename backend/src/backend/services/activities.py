"""Activity operations: CRUD, the publish/cancel/complete lifecycle, feed.

Each function takes an :class:`~sqlalchemy.ext.asyncio.AsyncSession`,
commits its own writes, and returns ``(result, events)``. Routers publish
the events after the service returns.

Authorization lives inside the service (it needs the session anyway):
mutating operations require the ``manager`` rank in the activity's org;
reads only require membership — except drafts, which are manager-only
and invisible (404) to everyone else.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import utcnow
from backend.db.models import Activity, ActivityRegistration, OrgMember, User
from backend.domain import activities as rules
from backend.domain.errors import ConflictError, NotFoundError, RuleViolationError
from backend.domain.ids import new_id
from backend.domain.organizations import is_manager
from backend.domain.registrations import ACTIVE_STATUSES
from backend.services.events import (
    EVENT_RECORD_CHANGED,
    DomainEvent,
    activity_changed_event,
    event_targets,
    org_staff_user_ids,
)
from backend.services.memberships import require_membership, require_org_role
from backend.services.records import create_records_for_checked_in


@dataclass(frozen=True)
class ActivityFields:
    """The editable fields of an activity — a full upsert, not a patch."""

    title: str
    description: str | None
    location: str | None
    capacity: int | None
    points: Decimal
    hours: Decimal
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    starts_at: datetime
    ends_at: datetime


@dataclass(frozen=True)
class ActivityListItem:
    """One activity plus its live registration counters."""

    activity: Activity
    registered: int
    checked_in: int


@dataclass(frozen=True)
class ActivityDetail:
    """An activity plus counters and the caller-specific extras."""

    activity: Activity
    registered: int
    checked_in: int
    my_registration: ActivityRegistration | None
    checkin_code: str | None


@dataclass(frozen=True)
class CompleteResult:
    """Result of completing an activity."""

    activity: Activity
    records_created: int


async def _registration_counts(
    session: AsyncSession, activity_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """Return ``{activity_id: (registered, checked_in)}`` for the ids given."""
    if not activity_ids:
        return {}
    rows = (
        await session.execute(
            select(
                ActivityRegistration.activity_id,
                ActivityRegistration.status,
                ActivityRegistration.checked_in_at,
            ).where(ActivityRegistration.activity_id.in_(activity_ids))
        )
    ).all()
    counts: dict[uuid.UUID, list[int]] = {}
    for activity_id, status, checked_in_at in rows:
        bucket = counts.setdefault(activity_id, [0, 0])
        if status in ACTIVE_STATUSES:
            bucket[0] += 1
        if checked_in_at is not None:
            bucket[1] += 1
    return {key: (value[0], value[1]) for key, value in counts.items()}


async def _get_activity(session: AsyncSession, activity_id: uuid.UUID) -> Activity:
    """Fetch an activity row or raise ``activity_not_found``."""
    activity = await session.get(Activity, activity_id)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    return activity


async def create_activity(
    session: AsyncSession,
    member: OrgMember,
    fields: ActivityFields,
) -> tuple[Activity, list[DomainEvent]]:
    """Create a draft activity in ``member``'s org.

    Raises:
        RuleViolationError: On invalid title/window/awards/capacity.
    """
    title = rules.validate_schedule(
        fields.title,
        fields.starts_at,
        fields.ends_at,
        fields.registration_opens_at,
        fields.registration_closes_at,
    )
    rules.validate_awards(fields.hours, fields.points)
    activity = Activity(
        id=new_id(),
        org_id=member.org_id,
        title=title,
        description=rules.normalize_description(fields.description),
        location=rules.normalize_location(fields.location),
        status="draft",
        capacity=rules.validate_capacity(fields.capacity),
        points=fields.points,
        hours=fields.hours,
        registration_opens_at=fields.registration_opens_at,
        registration_closes_at=fields.registration_closes_at,
        starts_at=fields.starts_at,
        ends_at=fields.ends_at,
        created_by=member.id,
    )
    session.add(activity)
    await session.commit()
    staff = await org_staff_user_ids(session, member.org_id)
    return activity, [activity_changed_event(activity, staff)]


async def list_org_activities(
    session: AsyncSession,
    org_id: uuid.UUID,
    member: OrgMember,
    status_filter: str | None = None,
) -> tuple[list[ActivityListItem], list[DomainEvent]]:
    """List an org's activities with live counters, oldest start first.

    Non-managers never see drafts. ``status_filter`` narrows by status and
    must be one of :data:`rules.ACTIVITY_STATUSES` when given.
    """
    if status_filter is not None and status_filter not in rules.ACTIVITY_STATUSES:
        raise RuleViolationError(f"unknown activity status: {status_filter}", code="invalid_status")
    conditions = [Activity.org_id == org_id]
    if status_filter is not None:
        conditions.append(Activity.status == status_filter)
    if not is_manager(member.role):
        conditions.append(Activity.status != "draft")
    activities = (
        await session.scalars(
            select(Activity).where(*conditions).order_by(Activity.starts_at, Activity.id)
        )
    ).all()
    counts = await _registration_counts(session, [a.id for a in activities])
    items = [
        ActivityListItem(
            activity=activity,
            registered=counts.get(activity.id, (0, 0))[0],
            checked_in=counts.get(activity.id, (0, 0))[1],
        )
        for activity in activities
    ]
    return items, []


async def get_activity_detail(
    session: AsyncSession,
    activity_id: uuid.UUID,
    user: User,
) -> tuple[ActivityDetail, list[DomainEvent]]:
    """Return one activity with counters plus the caller's own registration.

    ``checkin_code`` is exposed to managers only. Drafts answer 404 to
    non-managers — the same as a missing row, so drafts are not enumerable.

    Raises:
        NotFoundError: ``activity_not_found``.
        PermissionDeniedError: ``not_a_member`` / org inactive → 404 via
            ``org_not_found``.
    """
    activity = await _get_activity(session, activity_id)
    member = await require_membership(session, activity.org_id, user.id)
    if activity.status == "draft" and not is_manager(member.role):
        raise NotFoundError("activity not found", code="activity_not_found")

    counts = await _registration_counts(session, [activity.id])
    registered, checked_in = counts.get(activity.id, (0, 0))
    my_registration = await session.scalar(
        select(ActivityRegistration).where(
            ActivityRegistration.activity_id == activity.id,
            ActivityRegistration.member_id == member.id,
        )
    )
    detail = ActivityDetail(
        activity=activity,
        registered=registered,
        checked_in=checked_in,
        my_registration=my_registration,
        checkin_code=activity.checkin_code if is_manager(member.role) else None,
    )
    return detail, []


async def update_activity(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    fields: ActivityFields,
) -> tuple[Activity, list[DomainEvent]]:
    """Replace an activity's editable fields; managers only.

    A published activity may not shrink its capacity below the number of
    active registrations already holding seats.

    Raises:
        NotFoundError: ``activity_not_found``.
        ConflictError: ``terminal_state``, ``capacity_below_registrations``.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    await require_org_role(session, activity.org_id, user.id, "manager")
    rules.can_edit(activity)

    title = rules.validate_schedule(
        fields.title,
        fields.starts_at,
        fields.ends_at,
        fields.registration_opens_at,
        fields.registration_closes_at,
    )
    rules.validate_awards(fields.hours, fields.points)
    capacity = rules.validate_capacity(fields.capacity)

    if activity.status == "published" and capacity is not None:
        counts = await _registration_counts(session, [activity.id])
        registered = counts.get(activity.id, (0, 0))[0]
        if capacity < registered:
            raise ConflictError(
                "capacity cannot drop below current registrations",
                code="capacity_below_registrations",
            )

    activity.title = title
    activity.description = rules.normalize_description(fields.description)
    activity.location = rules.normalize_location(fields.location)
    activity.capacity = capacity
    activity.points = fields.points
    activity.hours = fields.hours
    activity.registration_opens_at = fields.registration_opens_at
    activity.registration_closes_at = fields.registration_closes_at
    activity.starts_at = fields.starts_at
    activity.ends_at = fields.ends_at
    await session.commit()
    staff = await org_staff_user_ids(session, activity.org_id)
    return activity, [activity_changed_event(activity, staff)]


async def publish_activity(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> tuple[Activity, list[DomainEvent]]:
    """Transition a draft to published; managers only.

    Raises:
        ConflictError: ``invalid_transition`` or ``activity_over``.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    await require_org_role(session, activity.org_id, user.id, "manager")
    rules.can_publish(activity, now or utcnow())
    activity.status = "published"
    await session.commit()
    staff = await org_staff_user_ids(session, activity.org_id)
    return activity, [activity_changed_event(activity, staff)]


async def cancel_activity(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
) -> tuple[Activity, list[DomainEvent]]:
    """Transition a draft or published activity to cancelled.

    Raises:
        ConflictError: ``invalid_transition`` from a terminal state.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    await require_org_role(session, activity.org_id, user.id, "manager")
    rules.require_transition(activity.status, "cancelled")
    activity.status = "cancelled"
    await session.commit()
    staff = await org_staff_user_ids(session, activity.org_id)
    return activity, [activity_changed_event(activity, staff)]


async def complete_activity(
    session: AsyncSession,
    user: User,
    activity_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> tuple[CompleteResult, list[DomainEvent]]:
    """Transition published → completed and mint volunteer records.

    Every checked-in approved registration earns a record carrying the
    activity's award defaults; one ``record.changed`` event per recipient
    goes to that member's account plus org staff.

    Raises:
        ConflictError: ``invalid_transition``, ``not_started``.
    """
    activity = await session.get(Activity, activity_id, with_for_update=True)
    if activity is None:
        raise NotFoundError("activity not found", code="activity_not_found")
    member = await require_org_role(session, activity.org_id, user.id, "manager")
    rules.can_complete(activity, now or utcnow())

    activity.status = "completed"
    created = await create_records_for_checked_in(session, activity, recorded_by=member.id)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            "a volunteer record already exists for this activity",
            code="record_conflict",
        ) from exc

    staff = await org_staff_user_ids(session, activity.org_id)
    events = [activity_changed_event(activity, staff)]
    events.extend(
        DomainEvent(
            type=EVENT_RECORD_CHANGED,
            data={
                "org_id": str(activity.org_id),
                "activity_id": str(activity.id),
                "record_id": str(item.record.id),
                "member_id": str(item.member.id),
                "title": item.record.title,
                "hours": str(item.record.hours),
                "points": str(item.record.points),
                "awarded_on": item.record.awarded_on.isoformat(),
            },
            user_ids=event_targets(staff, item.member.user_id),
        )
        for item in created
    )
    return CompleteResult(activity=activity, records_created=len(created)), events

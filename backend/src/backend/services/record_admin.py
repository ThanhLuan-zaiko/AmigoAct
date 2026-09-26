"""Staff-managed volunteer-record lifecycle: create, update, delete.

The completion flow creates records automatically (see
:mod:`backend.services.records`); this module owns everything staff do to
a record by hand: standalone/manual creation (``activity_id`` and
``registration_id`` NULL by design), edits to wording/award/date/note/
evidence, and deletion. Every mutation commits and returns a
``record.changed`` event for the API layer to publish post-commit.

Partial updates use the :data:`UNSET` convention from
:mod:`backend.services.members`: ``UNSET`` leaves a field untouched,
``None`` clears a nullable one.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import business_today
from backend.db.models import Activity, OrgMember, User, VolunteerRecord
from backend.domain import records as rules
from backend.domain.errors import ConflictError, NotFoundError, RuleViolationError
from backend.domain.ids import new_id
from backend.services.events import (
    EVENT_RECORD_CHANGED,
    DomainEvent,
    event_targets,
    org_staff_user_ids,
)
from backend.services.members import UNSET, _Unset
from backend.services.memberships import require_org_role


@dataclass(frozen=True)
class RecordPatch:
    """Editable fields of a record — ``UNSET`` fields are left alone.

    Linkage (``member_id``/``activity_id``/``registration_id``) is
    immutable and absent here by design: what a record certifies never
    changes, only its wording, award, date, note, and evidence.
    """

    title: str | _Unset | None = UNSET
    hours: Decimal | _Unset | None = UNSET
    points: Decimal | _Unset | None = UNSET
    awarded_on: date | str | _Unset | None = UNSET
    note: str | _Unset | None = UNSET
    evidence_url: str | _Unset | None = UNSET


async def _record_changed_event(
    session: AsyncSession, record: VolunteerRecord, member: OrgMember
) -> DomainEvent:
    """Build ``record.changed`` aimed at org staff + the member's account.

    ``activity_id``/``hours`` may be ``None`` on standalone and
    participation-only records — they serialize as JSON ``null``, never
    the string ``"None"``.
    """
    staff = await org_staff_user_ids(session, member.org_id)
    return DomainEvent(
        type=EVENT_RECORD_CHANGED,
        data={
            "org_id": str(member.org_id),
            "activity_id": str(record.activity_id) if record.activity_id else None,
            "record_id": str(record.id),
            "member_id": str(record.member_id),
            "title": record.title,
            "hours": str(record.hours) if record.hours is not None else None,
            "points": str(record.points),
            "awarded_on": record.awarded_on.isoformat(),
        },
        user_ids=event_targets(staff, member.user_id),
    )


async def _record_for_staff(
    session: AsyncSession, record_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[VolunteerRecord, OrgMember]:
    """Fetch a record plus its member, asserting caller is that org's staff.

    Raises:
        NotFoundError: ``record_not_found`` when the record or its member
            is missing.
        PermissionDeniedError: ``not_a_member`` / ``insufficient_role``.
    """
    record = await session.get(VolunteerRecord, record_id, with_for_update=True)
    if record is None:
        raise NotFoundError("record not found", code="record_not_found")
    member = await session.get(OrgMember, record.member_id)
    if member is None:
        raise NotFoundError("record not found", code="record_not_found")
    await require_org_role(session, member.org_id, user_id, "manager")
    return record, member


async def create_manual_record(
    session: AsyncSession,
    staff_member: OrgMember,
    member_id: uuid.UUID,
    *,
    title: str,
    hours: Decimal | None,
    points: Decimal,
    awarded_on: date | str | None = None,
    note: str | None = None,
    evidence_url: str | None = None,
    activity_id: uuid.UUID | None = None,
) -> tuple[VolunteerRecord, list[DomainEvent]]:
    """Record external/standalone service for a member of the staff's org.

    The row is unlinked by default (``activity_id``/``registration_id``
    NULL): it certifies service outside a catalogued activity. Passing
    ``activity_id`` instead links it to an org activity — e.g. a member
    attended but was never registered; ``uq_volrec_member_activity`` then
    backstops double-recording as ``record_exists``.

    Raises:
        NotFoundError: ``member_not_found`` for missing/cross-org members;
            ``activity_not_found`` for a missing/cross-org ``activity_id``.
        RuleViolationError: ``invalid_title``, ``invalid_hours``,
            ``invalid_points``, ``invalid_awarded_on``,
            ``future_awarded_on``, ``invalid_evidence_url``,
            ``value_too_long``.
        ConflictError: ``record_exists`` on a unique-constraint race.
    """
    member = await session.get(OrgMember, member_id)
    if member is None or member.org_id != staff_member.org_id:
        raise NotFoundError("member not found", code="member_not_found")
    if activity_id is not None:
        activity = await session.get(Activity, activity_id)
        if activity is None or activity.org_id != staff_member.org_id:
            raise NotFoundError("activity not found", code="activity_not_found")
    rules.validate_record_award(hours, points)
    record = VolunteerRecord(
        id=new_id(),
        member_id=member.id,
        activity_id=activity_id,
        registration_id=None,
        title=rules.normalize_record_title(title),
        hours=hours,
        points=points,
        awarded_on=rules.parse_awarded_on(awarded_on, business_today()),
        note=rules.normalize_record_note(note),
        evidence_url=rules.normalize_evidence_url(evidence_url),
        recorded_by=staff_member.id,
    )
    session.add(record)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            "a volunteer record already exists for this member",
            code="record_exists",
        ) from exc
    return record, [await _record_changed_event(session, record, member)]


async def update_record(
    session: AsyncSession,
    user: User,
    record_id: uuid.UUID,
    patch: RecordPatch,
) -> tuple[VolunteerRecord, list[DomainEvent]]:
    """Apply ``patch`` to a record; staff of the owning org only.

    ``points`` is NOT NULL — an explicit ``null`` there is ``invalid_points``
    rather than silently clearing; ``title``/``awarded_on`` likewise reject
    explicit ``null`` (they cannot be cleared).
    """
    record, member = await _record_for_staff(session, record_id, user.id)
    if not isinstance(patch.title, _Unset):
        if patch.title is None:
            raise RuleViolationError("title cannot be null", code="invalid_title")
        record.title = rules.normalize_record_title(patch.title)
    if not isinstance(patch.hours, _Unset):
        record.hours = patch.hours
    if not isinstance(patch.points, _Unset):
        if patch.points is None:
            raise RuleViolationError("points cannot be null", code="invalid_points")
        record.points = patch.points
    if not isinstance(patch.awarded_on, _Unset):
        if patch.awarded_on is None:
            raise RuleViolationError("awarded_on cannot be null", code="invalid_awarded_on")
        record.awarded_on = rules.parse_awarded_on(patch.awarded_on, business_today())
    if not isinstance(patch.note, _Unset):
        record.note = rules.normalize_record_note(patch.note)
    if not isinstance(patch.evidence_url, _Unset):
        record.evidence_url = rules.normalize_evidence_url(patch.evidence_url)
    rules.validate_record_award(record.hours, record.points)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError(
            "a volunteer record already exists for this member",
            code="record_exists",
        ) from exc
    return record, [await _record_changed_event(session, record, member)]


async def delete_record(
    session: AsyncSession, user: User, record_id: uuid.UUID
) -> tuple[None, list[DomainEvent]]:
    """Delete a record; staff of the owning org only.

    The event carries the deleted row's ``activity_id``/``member_id`` so
    subscribers can drop it without another fetch.
    """
    record, member = await _record_for_staff(session, record_id, user.id)
    event = await _record_changed_event(session, record, member)
    await session.delete(record)
    await session.commit()
    return None, [event]

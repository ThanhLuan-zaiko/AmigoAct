"""Volunteer-record reads and the activity-completion creation flow.

Records are created when an activity completes: every checked-in approved
registration earns one :class:`~backend.db.models.VolunteerRecord` carrying
the activity's award defaults. The ``uq_volrec_reg`` /
``uq_volrec_member_activity`` constraints are the backstop; the pre-check
here keeps a re-run (or a manually recorded row) from failing the batch.

This module also owns the record read paths: the member-facing
``my_records`` and the staff-scoped ``member_records``. The staff-managed
write lifecycle (manual create, patch, delete) lives in
:mod:`backend.services.record_admin`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.config import get_settings
from backend.db.models import (
    Activity,
    ActivityRegistration,
    Organization,
    OrgMember,
    User,
    VolunteerRecord,
)
from backend.domain import records as rules
from backend.domain.errors import NotFoundError
from backend.domain.ids import new_id
from backend.services.events import DomainEvent


@dataclass(frozen=True)
class CreatedRecord:
    """A newly inserted record plus the member it belongs to."""

    record: VolunteerRecord
    member: OrgMember


@dataclass(frozen=True)
class RecordRow:
    """A record joined to its member, org, and optional activity."""

    record: VolunteerRecord
    member: OrgMember
    activity: Activity | None
    org: Organization


@dataclass(frozen=True)
class OrgAwardTotal:
    """One org's contribution to the caller's award totals."""

    org: Organization
    hours: Decimal
    points: Decimal


@dataclass(frozen=True)
class MyRecords:
    """The caller's records plus totals and the per-org breakdown."""

    rows: list[RecordRow]
    total_hours: Decimal
    total_points: Decimal
    by_org: list[OrgAwardTotal]


@dataclass(frozen=True)
class MemberRecords:
    """A staff view: the member, their account email, and their records."""

    member: OrgMember
    email: str | None
    records: list[VolunteerRecord]


async def my_records(session: AsyncSession, user: User) -> tuple[MyRecords, list[DomainEvent]]:
    """Return every record held by the caller's member rows, newest first.

    A user may hold member rows in several orgs; each row joins the record
    to its activity (when linked) and the owning org, and ``by_org`` folds
    awards per organization in first-seen (most recent record first) order.
    """
    rows = (
        await session.execute(
            select(VolunteerRecord, OrgMember, Activity, Organization)
            .join(OrgMember, VolunteerRecord.member_id == OrgMember.id)
            .join(Organization, OrgMember.org_id == Organization.id)
            .outerjoin(Activity, VolunteerRecord.activity_id == Activity.id)
            .where(OrgMember.user_id == user.id)
            .order_by(VolunteerRecord.awarded_on.desc(), VolunteerRecord.id)
        )
    ).all()

    total_hours = rules.sum_hours(record for record, _m, _a, _o in rows)
    total_points = Decimal("0")
    by_org: dict[uuid.UUID, OrgAwardTotal] = {}
    for record, _member, _activity, org in rows:
        total_points += record.points
        acc = by_org.get(org.id)
        if acc is None:
            by_org[org.id] = OrgAwardTotal(
                org=org,
                hours=record.hours if record.hours is not None else Decimal("0"),
                points=record.points,
            )
        else:
            by_org[org.id] = OrgAwardTotal(
                org=org,
                hours=acc.hours + (record.hours if record.hours is not None else Decimal("0")),
                points=acc.points + record.points,
            )
    result = MyRecords(
        rows=[
            RecordRow(record=record, member=member, activity=activity, org=org)
            for record, member, activity, org in rows
        ],
        total_hours=total_hours,
        total_points=total_points,
        by_org=list(by_org.values()),
    )
    return result, []


async def member_records(
    session: AsyncSession, staff_member: OrgMember, member_id: uuid.UUID
) -> tuple[MemberRecords, list[DomainEvent]]:
    """Return one member's records; the member must share the staff's org.

    Raises:
        NotFoundError: ``member_not_found`` — also for a member of another
            org, so ids don't leak across organizations.
    """
    member = await session.get(OrgMember, member_id)
    if member is None or member.org_id != staff_member.org_id:
        raise NotFoundError("member not found", code="member_not_found")
    email: str | None = None
    if member.user_id is not None:
        account = await session.get(User, member.user_id)
        email = account.email if account is not None else None
    records = (
        await session.scalars(
            select(VolunteerRecord)
            .where(VolunteerRecord.member_id == member.id)
            .order_by(VolunteerRecord.awarded_on.desc(), VolunteerRecord.id)
        )
    ).all()
    return MemberRecords(member=member, email=email, records=list(records)), []


async def create_records_for_checked_in(
    session: AsyncSession,
    activity: Activity,
    *,
    recorded_by: uuid.UUID | None,
) -> list[CreatedRecord]:
    """Create one volunteer record per checked-in approved registration.

    Rows that already have a record are skipped, so completing again (or a
    pre-existing manual record) never duplicates. The award date is the
    activity's end *calendar date* in the configured business timezone —
    ``awarded_on`` answers "on which local day was this earned".

    Does not commit: the caller owns the transaction.
    """
    registrations = (
        await session.scalars(
            select(ActivityRegistration)
            .where(
                ActivityRegistration.activity_id == activity.id,
                ActivityRegistration.status == "approved",
                ActivityRegistration.checked_in_at.is_not(None),
            )
            .options(selectinload(ActivityRegistration.member))
        )
    ).all()
    if not registrations:
        return []

    existing = set(
        (
            await session.scalars(
                select(VolunteerRecord.registration_id).where(
                    VolunteerRecord.registration_id.in_([r.id for r in registrations])
                )
            )
        ).all()
    )

    awarded_on = activity.ends_at.astimezone(ZoneInfo(get_settings().timezone)).date()
    created: list[CreatedRecord] = []
    for registration in registrations:
        if registration.id in existing:
            continue
        record = VolunteerRecord(
            id=new_id(),
            member_id=registration.member_id,
            activity_id=activity.id,
            registration_id=registration.id,
            title=activity.title,
            hours=activity.hours,
            points=activity.points,
            awarded_on=awarded_on,
            recorded_by=recorded_by,
        )
        session.add(record)
        created.append(CreatedRecord(record=record, member=registration.member))
    return created

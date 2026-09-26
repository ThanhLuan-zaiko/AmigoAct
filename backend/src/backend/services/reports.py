"""Org reporting — manager-facing aggregates over real rows.

Two reports, both staff-scoped and honest by construction: every number
is folded from fetched rows, empty orgs report zeros, and a NULL faculty
stays ``None`` for the frontend to render.

Date-range semantics (both bounds inclusive, business-tz aligned):

* activities are filtered on ``starts_at``;
* registrations are scoped to the filtered activities;
* records are filtered on ``awarded_on``.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import get_settings
from backend.db.models import (
    Activity,
    ActivityRegistration,
    OrgMember,
    VolunteerRecord,
)
from backend.domain import stats
from backend.domain.errors import PermissionDeniedError
from backend.domain.registrations import ACTIVE_STATUSES
from backend.services.events import DomainEvent


@dataclass(frozen=True)
class OverviewTotals:
    """Headline counters for the org overview report."""

    activities: int
    published: int
    completed: int
    cancelled: int
    registrations: int
    approved: int
    checked_in: int
    checkin_rate: float
    total_hours: Decimal
    total_points: Decimal


@dataclass(frozen=True)
class FacultyBucket:
    """Award rollup for one declared faculty (``None`` = undeclared)."""

    faculty: str | None
    members: int
    hours: Decimal
    points: Decimal


@dataclass(frozen=True)
class VolunteerSum:
    """One member's summed awards — the unit behind top_volunteers."""

    member_id: uuid.UUID
    full_name: str
    student_code: str | None
    faculty: str | None
    hours: Decimal
    points: Decimal
    record_count: int


@dataclass(frozen=True)
class OverviewReport:
    """The full overview: totals, monthly series, and member rollups."""

    totals: OverviewTotals
    monthly: list[stats.MonthlyBucket]
    by_faculty: list[FacultyBucket]
    top_volunteers: list[VolunteerSum]


@dataclass(frozen=True)
class ActivityReportRow:
    """One activity plus its registration funnel and awarded sums."""

    activity: Activity
    registered: int
    approved: int
    checked_in: int
    hours_awarded: Decimal
    points_awarded: Decimal


@dataclass
class _VolunteerAcc:
    """Mutable per-member award accumulator used while folding."""

    full_name: str
    student_code: str | None
    faculty: str | None
    hours: Decimal = Decimal("0")
    points: Decimal = Decimal("0")
    record_count: int = 0


# Light row shapes fetched as plain tuples: unpacking keeps the fold code
# typed without paying for entity hydration.
_ActivityRow = tuple[uuid.UUID, str, datetime]  # id, status, starts_at
_RegistrationRow = tuple[str, datetime | None, datetime]  # status, checked_in_at, created_at
_RecordRow = tuple[
    Decimal | None,  # hours
    Decimal,  # points
    date,  # awarded_on
    uuid.UUID,  # member_id
    str,  # full_name
    str | None,  # student_code
    str | None,  # faculty
]


def _require_same_org(staff_member: OrgMember, org_id: uuid.UUID) -> None:
    """Refuse when the resolved staff row belongs to another org.

    The router resolves ``staff_member`` for the same ``org_id``, so a
    mismatch means a programming error — fail loudly rather than leak
    another org's numbers.
    """
    if staff_member.org_id != org_id:
        raise PermissionDeniedError(
            "staff member does not belong to this organization",
            code="insufficient_role",
        )


def _activity_window(
    org_id: uuid.UUID, date_from: date | None, date_to: date | None
) -> list[ColumnElement[bool]]:
    """Build the activity ``WHERE`` clause for an org + optional range."""
    tz = ZoneInfo(get_settings().timezone)
    conditions = [Activity.org_id == org_id]
    if date_from is not None:
        conditions.append(Activity.starts_at >= datetime.combine(date_from, time.min, tz))
    if date_to is not None:
        end = datetime.combine(date_to + timedelta(days=1), time.min, tz)
        conditions.append(Activity.starts_at < end)
    return conditions


async def overview(
    session: AsyncSession,
    staff_member: OrgMember,
    org_id: uuid.UUID,
    date_from: date | None,
    date_to: date | None,
) -> tuple[OverviewReport, list[DomainEvent]]:
    """Build the org overview report; managers only (router-checked).

    ``checkin_rate`` divides checked-in registrations by approved ones;
    totals come from records of the org's members, so manual standalone
    records count toward awards but not toward the registration funnel.
    """
    _require_same_org(staff_member, org_id)
    tz = ZoneInfo(get_settings().timezone)

    activity_rows: list[_ActivityRow] = [
        (row.id, row.status, row.starts_at)
        for row in (
            await session.execute(
                select(Activity.id, Activity.status, Activity.starts_at).where(
                    *_activity_window(org_id, date_from, date_to)
                )
            )
        ).all()
    ]
    activity_ids = [row[0] for row in activity_rows]

    registration_rows: list[_RegistrationRow] = []
    if activity_ids:
        registration_rows = [
            (row.status, row.checked_in_at, row.created_at)
            for row in (
                await session.execute(
                    select(
                        ActivityRegistration.status,
                        ActivityRegistration.checked_in_at,
                        ActivityRegistration.created_at,
                    ).where(ActivityRegistration.activity_id.in_(activity_ids))
                )
            ).all()
        ]

    record_conditions: list[ColumnElement[bool]] = [OrgMember.org_id == org_id]
    if date_from is not None:
        record_conditions.append(VolunteerRecord.awarded_on >= date_from)
    if date_to is not None:
        record_conditions.append(VolunteerRecord.awarded_on <= date_to)
    record_rows: list[_RecordRow] = [
        (
            row.hours,
            row.points,
            row.awarded_on,
            row.id,
            row.full_name,
            row.student_code,
            row.faculty,
        )
        for row in (
            await session.execute(
                select(
                    VolunteerRecord.hours,
                    VolunteerRecord.points,
                    VolunteerRecord.awarded_on,
                    OrgMember.id,
                    OrgMember.full_name,
                    OrgMember.student_code,
                    OrgMember.faculty,
                )
                .join(OrgMember, VolunteerRecord.member_id == OrgMember.id)
                .where(*record_conditions)
            )
        ).all()
    ]

    totals = _fold_totals(activity_rows, registration_rows, record_rows)
    member_sums = _fold_volunteers(record_rows)
    monthly = stats.monthly_buckets(
        [
            *(
                stats.MonthlyRow(month=stats.month_key(starts_at, tz), activities=1)
                for _id, _status, starts_at in activity_rows
            ),
            *(
                stats.MonthlyRow(month=stats.month_key(created_at, tz), registrations=1)
                for _status, _checked, created_at in registration_rows
            ),
            *(
                stats.MonthlyRow(
                    month=stats.date_month_key(awarded_on),
                    hours=hours if hours is not None else Decimal("0"),
                )
                for hours, _points, awarded_on, *_rest in record_rows
            ),
        ]
    )
    by_faculty = [
        FacultyBucket(
            faculty=group.key, members=group.count, hours=group.hours, points=group.points
        )
        for group in stats.group_sum(member_sums, key_fn=lambda volunteer: volunteer.faculty)
    ]
    report = OverviewReport(
        totals=totals,
        monthly=monthly,
        by_faculty=by_faculty,
        top_volunteers=member_sums[:10],
    )
    return report, []


def _fold_totals(
    activity_rows: list[_ActivityRow],
    registration_rows: list[_RegistrationRow],
    record_rows: list[_RecordRow],
) -> OverviewTotals:
    """Fold the three fetched row sets into headline counters."""
    status_counts: dict[str, int] = {}
    for _id, status, _starts_at in activity_rows:
        status_counts[status] = status_counts.get(status, 0) + 1
    approved = sum(1 for status, _c, _t in registration_rows if status == "approved")
    checked_in = sum(1 for _s, checked, _t in registration_rows if checked is not None)
    total_hours = sum(
        (hours for hours, _p, _a, *_r in record_rows if hours is not None), Decimal("0")
    )
    total_points = sum((points for _h, points, _a, *_r in record_rows), Decimal("0"))
    return OverviewTotals(
        activities=len(activity_rows),
        published=status_counts.get("published", 0),
        completed=status_counts.get("completed", 0),
        cancelled=status_counts.get("cancelled", 0),
        registrations=len(registration_rows),
        approved=approved,
        checked_in=checked_in,
        checkin_rate=stats.checkin_rate(approved, checked_in),
        total_hours=total_hours,
        total_points=total_points,
    )


def _fold_volunteers(record_rows: list[_RecordRow]) -> list[VolunteerSum]:
    """Fold record rows into per-member sums ordered by hours/points desc."""
    members: dict[uuid.UUID, _VolunteerAcc] = {}
    for hours, points, _awarded, member_id, full_name, student_code, faculty in record_rows:
        acc = members.get(member_id)
        if acc is None:
            acc = _VolunteerAcc(full_name=full_name, student_code=student_code, faculty=faculty)
            members[member_id] = acc
        acc.hours += hours if hours is not None else Decimal("0")
        acc.points += points
        acc.record_count += 1
    volunteers = [
        VolunteerSum(
            member_id=member_id,
            full_name=acc.full_name,
            student_code=acc.student_code,
            faculty=acc.faculty,
            hours=acc.hours,
            points=acc.points,
            record_count=acc.record_count,
        )
        for member_id, acc in members.items()
    ]
    return sorted(
        volunteers,
        key=lambda volunteer: (-volunteer.hours, -volunteer.points, volunteer.member_id.hex),
    )


async def activities_report(
    session: AsyncSession,
    staff_member: OrgMember,
    org_id: uuid.UUID,
    date_from: date | None,
    date_to: date | None,
) -> tuple[list[ActivityReportRow], list[DomainEvent]]:
    """Per-activity funnel: registrations, check-ins, awarded sums.

    ``registered`` counts the seat-holding statuses (pending + approved);
    ``hours_awarded``/``points_awarded`` sum the records linked to that
    activity (standalone records have no activity and appear nowhere here).
    Rows are ordered by ``starts_at`` descending.
    """
    _require_same_org(staff_member, org_id)
    activities = (
        await session.scalars(
            select(Activity)
            .where(*_activity_window(org_id, date_from, date_to))
            .order_by(Activity.starts_at.desc(), Activity.id)
        )
    ).all()
    activity_ids = [activity.id for activity in activities]
    if not activity_ids:
        return [], []

    registration_rows = (
        await session.execute(
            select(
                ActivityRegistration.activity_id,
                ActivityRegistration.status,
                ActivityRegistration.checked_in_at,
            ).where(ActivityRegistration.activity_id.in_(activity_ids))
        )
    ).all()
    record_rows = (
        await session.execute(
            select(
                VolunteerRecord.activity_id,
                VolunteerRecord.hours,
                VolunteerRecord.points,
            ).where(VolunteerRecord.activity_id.in_(activity_ids))
        )
    ).all()

    funnels: dict[uuid.UUID, list[int]] = {}
    for activity_id, status, checked_in_at in registration_rows:
        funnel = funnels.setdefault(activity_id, [0, 0, 0])
        if status in ACTIVE_STATUSES:
            funnel[0] += 1
        if status == "approved":
            funnel[1] += 1
        if checked_in_at is not None:
            funnel[2] += 1
    awards: dict[uuid.UUID, list[Decimal]] = {}
    for activity_id, hours, points in record_rows:
        award = awards.setdefault(activity_id, [Decimal("0"), Decimal("0")])
        award[0] += hours if hours is not None else Decimal("0")
        award[1] += points

    rows = [
        ActivityReportRow(
            activity=activity,
            registered=funnels.get(activity.id, [0, 0, 0])[0],
            approved=funnels.get(activity.id, [0, 0, 0])[1],
            checked_in=funnels.get(activity.id, [0, 0, 0])[2],
            hours_awarded=awards.get(activity.id, [Decimal("0"), Decimal("0")])[0],
            points_awarded=awards.get(activity.id, [Decimal("0"), Decimal("0")])[1],
        )
        for activity in activities
    ]
    return rows, []

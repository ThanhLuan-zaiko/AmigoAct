"""Roster management: member listing, admin role changes, self-edits.

Split from :mod:`backend.services.organizations` along the cohesion seam —
org lifecycle lives there; everything that operates on *member rows* lives
here.

Partial-update convention: mutable-field parameters default to
:data:`UNSET`. Callers pass ``UNSET`` for "not provided" and ``None`` for
"clear this nullable field", which a plain ``None`` default could not
distinguish.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Final

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import OrgMember, User, VolunteerRecord
from backend.domain import organizations as rules
from backend.domain.errors import ConflictError, NotFoundError, RuleViolationError
from backend.services.events import DomainEvent
from backend.services.memberships import require_org_role


class _Unset:
    """Sentinel marking "field was not provided" in partial updates."""


UNSET: Final = _Unset()


@dataclass(frozen=True)
class MemberRow:
    """One roster row plus the linked account's email and award totals."""

    member: OrgMember
    user_id: uuid.UUID | None
    email: str | None
    total_hours: Decimal
    total_points: Decimal


def member_integrity_error(exc: IntegrityError) -> ConflictError:
    """Map a roster unique-index violation to its specific conflict code."""
    message = str(exc).lower()
    if "student" in message:
        return ConflictError(
            "that student code already exists in this organization",
            code="student_code_taken",
        )
    return ConflictError("already a member of this organization", code="already_member")


async def list_members(
    session: AsyncSession, org_id: uuid.UUID
) -> tuple[list[MemberRow], list[DomainEvent]]:
    """Return every roster row with account email and award totals.

    Totals are summed in Python — ``DecimalAmount`` stores hundredths on
    SQLite, so a SQL-side ``SUM`` would come back scaled differently per
    dialect.
    """
    rows = (
        await session.execute(
            select(OrgMember, User.email)
            .outerjoin(User, OrgMember.user_id == User.id)
            .where(OrgMember.org_id == org_id)
            .order_by(OrgMember.joined_at, OrgMember.id)
        )
    ).all()

    member_ids = [member.id for member, _email in rows]
    totals: dict[uuid.UUID, list[Decimal]] = {}
    if member_ids:
        record_rows = (
            await session.execute(
                select(
                    VolunteerRecord.member_id,
                    VolunteerRecord.hours,
                    VolunteerRecord.points,
                ).where(VolunteerRecord.member_id.in_(member_ids))
            )
        ).all()
        for member_id, hours, points in record_rows:
            bucket = totals.setdefault(member_id, [Decimal("0"), Decimal("0")])
            bucket[0] += hours if hours is not None else Decimal("0")
            bucket[1] += points

    members = [
        MemberRow(
            member=member,
            user_id=member.user_id,
            email=email,
            total_hours=totals.get(member.id, [Decimal("0"), Decimal("0")])[0],
            total_points=totals.get(member.id, [Decimal("0"), Decimal("0")])[1],
        )
        for member, email in rows
    ]
    return members, []


async def update_member(
    session: AsyncSession,
    org_id: uuid.UUID,
    member_id: uuid.UUID,
    actor_user: User,
    *,
    role: str | _Unset | None = UNSET,
    status: str | _Unset | None = UNSET,
) -> tuple[OrgMember, list[DomainEvent]]:
    """Change a member's role/status; admin only, with a last-admin guard.

    The guard refuses to demote or deactivate the org's last active admin,
    which also covers an admin demoting themselves when no other admin
    exists (self-demotion with another admin present is allowed).

    Raises:
        NotFoundError: ``org_not_found``, ``member_not_found``.
        PermissionDeniedError: ``not_a_member``, ``insufficient_role``.
        RuleViolationError: ``invalid_role`` / ``invalid_status``.
        ConflictError: ``last_admin``.
    """
    await require_org_role(session, org_id, actor_user.id, "admin")

    target = await session.get(OrgMember, member_id)
    if target is None or target.org_id != org_id:
        raise NotFoundError("member not found", code="member_not_found")

    was_active_admin = target.role == "admin" and target.status == "active"

    # Validate then assign; the guard below reads the new attribute values.
    # isinstance (not ``is``) is what mypy narrows a Final sentinel on.
    if not isinstance(role, _Unset):
        if role is None or role not in rules.MEMBER_ROLES:
            raise RuleViolationError(f"unknown role: {role}", code="invalid_role")
        target.role = role
    if not isinstance(status, _Unset):
        if status is None or status not in rules.MEMBER_STATUSES:
            raise RuleViolationError(f"unknown status: {status}", code="invalid_status")
        target.status = status

    losing_admin = was_active_admin and (target.role != "admin" or target.status != "active")
    if losing_admin:
        other_admins = await session.scalar(
            select(func.count(OrgMember.id)).where(
                OrgMember.org_id == org_id,
                OrgMember.role == "admin",
                OrgMember.status == "active",
                OrgMember.id != target.id,
            )
        )
        if not other_admins:
            raise ConflictError(
                "cannot demote or deactivate the last active admin",
                code="last_admin",
            )

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise member_integrity_error(exc) from exc
    return target, []


async def update_own_membership(
    session: AsyncSession,
    member: OrgMember,
    *,
    full_name: str | _Unset | None = UNSET,
    student_code: str | _Unset | None = UNSET,
    class_name: str | _Unset | None = UNSET,
    faculty: str | _Unset | None = UNSET,
) -> tuple[OrgMember, list[DomainEvent]]:
    """Edit the caller's own roster profile fields.

    ``UNSET`` leaves a field untouched; ``None`` clears a nullable field;
    a value is normalized then stored. ``full_name`` is NOT NULL, so an
    explicit ``None`` is rejected rather than stored. A ``student_code``
    change must stay unique inside the org.

    Raises:
        RuleViolationError: On invalid field values (``invalid_name``,
            ``value_too_long``).
        ConflictError: ``student_code_taken``.
    """
    if not isinstance(full_name, _Unset):
        if full_name is None:
            raise RuleViolationError("full_name cannot be null", code="invalid_name")
        member.full_name = rules.normalize_member_name(full_name)
    if not isinstance(student_code, _Unset):
        norm_student = rules.normalize_student_code(student_code)
        if norm_student is not None:
            holder = await session.scalar(
                select(OrgMember.id).where(
                    OrgMember.org_id == member.org_id,
                    OrgMember.student_code == norm_student,
                    OrgMember.id != member.id,
                )
            )
            if holder is not None:
                raise ConflictError(
                    "that student code already exists in this organization",
                    code="student_code_taken",
                )
        member.student_code = norm_student
    if not isinstance(class_name, _Unset):
        member.class_name = rules.normalize_class_name(class_name)
    if not isinstance(faculty, _Unset):
        member.faculty = rules.normalize_faculty(faculty)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise member_integrity_error(exc) from exc
    return member, []

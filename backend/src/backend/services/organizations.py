"""Organization lifecycle: create, join (with roster claim), detail.

Each function takes an :class:`~sqlalchemy.ext.asyncio.AsyncSession`,
performs its own commit, and returns ``(result, events)`` — events are
:class:`~backend.services.events.DomainEvent` objects the router publishes
over the WebSocket channel.

Roster linking: ``org_members.user_id`` may be NULL (a roster imported
before accounts exist). Joining with a matching ``student_code`` *claims*
that unlinked row instead of creating a second one — that is the intended
roster-linking behaviour.

Operations on existing member rows (list/update/self-edit) live in
:mod:`backend.services.members`.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import utcnow
from backend.db.models import Activity, Organization, OrgMember, User
from backend.domain import organizations as rules
from backend.domain.errors import ConflictError, NotFoundError
from backend.domain.ids import new_id
from backend.services.events import DomainEvent
from backend.services.members import member_integrity_error


@dataclass(frozen=True)
class OrgDetail:
    """An org, the caller's member row, and roster/activity stats."""

    org: Organization
    member: OrgMember
    member_count: int
    activity_count: int
    upcoming_count: int


async def create_org(
    session: AsyncSession,
    user: User,
    *,
    code: str,
    name: str,
    description: str | None,
    contact_email: str | None,
) -> tuple[tuple[Organization, OrgMember], list[DomainEvent]]:
    """Create an org and seat ``user`` as its first admin member.

    Raises:
        RuleViolationError: On invalid code/name/email fields.
        ConflictError: ``org_code_taken`` — checked up front, and again via
            the unique constraint as a race backstop.
    """
    norm_code = rules.normalize_org_code(code)
    org = Organization(
        id=new_id(),
        code=norm_code,
        name=rules.normalize_org_name(name),
        description=rules.normalize_org_description(description),
        contact_email=rules.normalize_contact_email(contact_email),
        is_active=True,
    )
    member = OrgMember(
        id=new_id(),
        org_id=org.id,
        user_id=user.id,
        role="admin",
        status="active",
        full_name=user.full_name,
    )
    if await session.scalar(select(Organization.id).where(Organization.code == norm_code)):
        raise ConflictError("organization code already taken", code="org_code_taken")
    session.add_all([org, member])
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("organization code already taken", code="org_code_taken") from exc
    return (org, member), []


async def join_org(
    session: AsyncSession,
    user: User,
    *,
    code: str,
    student_code: str | None,
    class_name: str | None,
    faculty: str | None,
    full_name: str | None,
) -> tuple[tuple[Organization, OrgMember], list[DomainEvent]]:
    """Join ``user`` to the org named by ``code``, claiming roster rows.

    When an *unlinked* member row (``user_id IS NULL``) already carries the
    same ``student_code``, the join claims it: ``user_id`` is set and
    provided fields are merged onto it — this is how a pre-imported roster
    entry becomes a live account.

    Raises:
        NotFoundError: ``org_not_found`` for a missing/inactive org.
        RuleViolationError: On invalid member fields.
        ConflictError: ``already_member``, or ``student_code_taken`` when
            the code belongs to a different *linked* member.
    """
    norm_code = rules.normalize_org_code(code)
    org = await session.scalar(select(Organization).where(Organization.code == norm_code))
    if org is None or not org.is_active:
        raise NotFoundError("organization not found", code="org_not_found")

    existing = await session.scalar(
        select(OrgMember).where(
            OrgMember.org_id == org.id,
            OrgMember.user_id == user.id,
        )
    )
    if existing is not None:
        raise ConflictError("already a member of this organization", code="already_member")

    norm_student = rules.normalize_student_code(student_code)
    norm_class = rules.normalize_class_name(class_name)
    norm_faculty = rules.normalize_faculty(faculty)
    norm_name = rules.normalize_member_name(full_name) if full_name else None

    if norm_student is not None:
        holder = await session.scalar(
            select(OrgMember).where(
                OrgMember.org_id == org.id,
                OrgMember.student_code == norm_student,
            )
        )
        if holder is not None:
            if holder.user_id is not None:
                raise ConflictError(
                    "that student code already exists in this organization",
                    code="student_code_taken",
                )
            # Roster claim: link the row; provided fields win, absent fields
            # keep the imported roster values.
            holder.user_id = user.id
            if norm_name is not None:
                holder.full_name = norm_name
            if norm_class is not None:
                holder.class_name = norm_class
            if norm_faculty is not None:
                holder.faculty = norm_faculty
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise member_integrity_error(exc) from exc
            return (org, holder), []

    member = OrgMember(
        id=new_id(),
        org_id=org.id,
        user_id=user.id,
        role="member",
        status="active",
        full_name=norm_name or user.full_name,
        student_code=norm_student,
        class_name=norm_class,
        faculty=norm_faculty,
    )
    session.add(member)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise member_integrity_error(exc) from exc
    return (org, member), []


async def get_org_detail(
    session: AsyncSession, member: OrgMember
) -> tuple[OrgDetail, list[DomainEvent]]:
    """Return the org, the caller's member row, and count-based stats.

    ``member_count`` counts *active* roster rows; ``activity_count`` is
    every activity the org owns; ``upcoming_count`` is published activities
    not yet ended.
    """
    org = await session.get(Organization, member.org_id)
    if org is None:
        raise NotFoundError("organization not found", code="org_not_found")
    member_count = await session.scalar(
        select(func.count(OrgMember.id)).where(
            OrgMember.org_id == org.id, OrgMember.status == "active"
        )
    )
    activity_count = await session.scalar(
        select(func.count(Activity.id)).where(Activity.org_id == org.id)
    )
    now = utcnow()
    upcoming_count = await session.scalar(
        select(func.count(Activity.id)).where(
            Activity.org_id == org.id,
            Activity.status == "published",
            Activity.ends_at >= now,
        )
    )
    detail = OrgDetail(
        org=org,
        member=member,
        member_count=member_count or 0,
        activity_count=activity_count or 0,
        upcoming_count=upcoming_count or 0,
    )
    return detail, []

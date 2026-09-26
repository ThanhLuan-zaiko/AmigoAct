"""Organization endpoints: create, join, detail, and roster management.

Routers stay thin — field rules live in
:mod:`backend.domain.organizations`, persistence in
:mod:`backend.services.organizations`, and membership/role checks in
:mod:`backend.services.memberships`. ORM entities are mapped to response
schemas explicitly.

Route-order note: ``/orgs/{org_id}/members/me`` is declared *before*
``/orgs/{org_id}/members/{member_id}`` — Starlette matches routes in
declaration order, and the ``member_id`` converter would otherwise 422 on
the literal ``me``.
"""

from __future__ import annotations

import uuid
from typing import Literal, cast

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import get_current_user
from backend.api.events import publish_events
from backend.api.schemas.orgs import (
    MemberRow,
    MemberSelfUpdateRequest,
    MembershipDetail,
    MembershipResponse,
    MembersResponse,
    MemberUpdateRequest,
    OrgCreateRequest,
    OrgDetailResponse,
    OrgJoinRequest,
    OrgOut,
    OrgResponse,
    OrgStats,
)
from backend.database import get_session
from backend.db.models import Organization, OrgMember, User
from backend.services import members as member_ops
from backend.services import organizations
from backend.services.members import UNSET
from backend.services.memberships import require_membership, require_org_role

router = APIRouter(tags=["orgs"])

Role = Literal["member", "manager", "admin"]
MemberStatus = Literal["active", "inactive"]


def _org_out(org: Organization) -> OrgOut:
    """Map an ``Organization`` row to its response schema."""
    return OrgOut.model_validate(org)


def _membership_detail(member: OrgMember) -> MembershipDetail:
    """Map an ``OrgMember`` row to the caller-facing membership detail."""
    return MembershipDetail(
        member_id=member.id,
        role=cast(Role, member.role),
        status=cast(MemberStatus, member.status),
        full_name=member.full_name,
        student_code=member.student_code,
        class_name=member.class_name,
        faculty=member.faculty,
        joined_at=member.joined_at,
    )


def _org_response(org: Organization, member: OrgMember) -> OrgResponse:
    """Build the create/join response body."""
    return OrgResponse(org=_org_out(org), membership=_membership_detail(member))


@router.post("/orgs", status_code=201)
async def create_org(
    body: OrgCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> OrgResponse:
    """Create an organization; the creator becomes its first admin."""
    (org, member), events = await organizations.create_org(
        session,
        user,
        code=body.code,
        name=body.name,
        description=body.description,
        contact_email=body.contact_email,
    )
    await publish_events(request, events)
    return _org_response(org, member)


@router.post("/orgs/join", status_code=201)
async def join_org(
    body: OrgJoinRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> OrgResponse:
    """Join an org by code; claims an unlinked roster row on student_code."""
    (org, member), events = await organizations.join_org(
        session,
        user,
        code=body.code,
        student_code=body.student_code,
        class_name=body.class_name,
        faculty=body.faculty,
        full_name=body.full_name,
    )
    await publish_events(request, events)
    return _org_response(org, member)


@router.get("/orgs/{org_id}")
async def get_org(
    org_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> OrgDetailResponse:
    """Return the org detail; members only."""
    member = await require_membership(session, org_id, user.id)
    detail, events = await organizations.get_org_detail(session, member)
    await publish_events(request, events)
    return OrgDetailResponse(
        org=_org_out(detail.org),
        membership=_membership_detail(detail.member),
        stats=OrgStats(
            member_count=detail.member_count,
            activity_count=detail.activity_count,
            upcoming_count=detail.upcoming_count,
        ),
    )


@router.get("/orgs/{org_id}/members")
async def get_members(
    org_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MembersResponse:
    """List the org roster with award totals; managers and admins only."""
    await require_org_role(session, org_id, user.id, "manager")
    members, events = await member_ops.list_members(session, org_id)
    await publish_events(request, events)
    return MembersResponse(
        members=[
            MemberRow(
                member_id=row.member.id,
                user_id=row.user_id,
                email=row.email,
                full_name=row.member.full_name,
                role=cast(Role, row.member.role),
                status=cast(MemberStatus, row.member.status),
                student_code=row.member.student_code,
                class_name=row.member.class_name,
                faculty=row.member.faculty,
                joined_at=row.member.joined_at,
                total_hours=row.total_hours,
                total_points=row.total_points,
            )
            for row in members
        ]
    )


# Declared BEFORE /members/{member_id} — Starlette matches in order, and
# the uuid converter would 422 on the literal "me".
@router.patch("/orgs/{org_id}/members/me")
async def update_my_membership(
    org_id: uuid.UUID,
    body: MemberSelfUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MembershipResponse:
    """Edit the caller's own roster profile fields."""
    member = await require_membership(session, org_id, user.id)
    provided = body.model_fields_set
    member, events = await member_ops.update_own_membership(
        session,
        member,
        full_name=body.full_name if "full_name" in provided else UNSET,
        student_code=body.student_code if "student_code" in provided else UNSET,
        class_name=body.class_name if "class_name" in provided else UNSET,
        faculty=body.faculty if "faculty" in provided else UNSET,
    )
    await publish_events(request, events)
    return MembershipResponse(membership=_membership_detail(member))


@router.patch("/orgs/{org_id}/members/{member_id}")
async def update_member(
    org_id: uuid.UUID,
    member_id: uuid.UUID,
    body: MemberUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MembershipResponse:
    """Change a member's role or status; admins only (last-admin guard)."""
    provided = body.model_fields_set
    member, events = await member_ops.update_member(
        session,
        org_id,
        member_id,
        user,
        role=body.role if "role" in provided else UNSET,
        status=body.status if "status" in provided else UNSET,
    )
    await publish_events(request, events)
    return MembershipResponse(membership=_membership_detail(member))

"""Request/response schemas for the ``/orgs`` endpoints.

Thin transport shapes only — every rule (code pattern, name bounds, roster
field normalization, role/status domains) is enforced in
:mod:`backend.domain.organizations` and the services, and ORM entities are
mapped to these models explicitly by the router.

``OrgRef`` lives here rather than in ``schemas.auth`` because every
feature embeds an org reference, not just the auth ``/me`` payload.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OrgCreateRequest(BaseModel):
    """Body of ``POST /orgs``."""

    code: str
    name: str
    description: str | None = None
    contact_email: str | None = None


class OrgJoinRequest(BaseModel):
    """Body of ``POST /orgs/join`` — join by org code, roster fields optional."""

    code: str
    student_code: str | None = None
    class_name: str | None = None
    faculty: str | None = None
    full_name: str | None = None


class OrgRef(BaseModel):
    """A minimal org reference inlined in other payloads."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str


class OrgOut(BaseModel):
    """The public view of an organization."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    description: str | None
    contact_email: str | None
    is_active: bool
    created_at: datetime


class MembershipDetail(BaseModel):
    """The caller's own roster row inside an org."""

    member_id: UUID
    role: Literal["member", "manager", "admin"]
    status: Literal["active", "inactive"]
    full_name: str
    student_code: str | None
    class_name: str | None
    faculty: str | None
    joined_at: datetime


class OrgResponse(BaseModel):
    """Returned by create and join: the org plus the caller's membership."""

    org: OrgOut
    membership: MembershipDetail


class OrgStats(BaseModel):
    """Count-based stats on the org detail payload."""

    member_count: int
    activity_count: int
    upcoming_count: int


class OrgDetailResponse(BaseModel):
    """``GET /orgs/{org_id}`` — org, caller's membership, and stats."""

    org: OrgOut
    membership: MembershipDetail
    stats: OrgStats


class MemberRow(BaseModel):
    """One roster row in the member list, with award totals.

    ``user_id`` and ``email`` are ``None`` for roster entries not yet
    claimed by an account (pre-imported rosters).
    """

    member_id: UUID
    user_id: UUID | None
    email: str | None
    full_name: str
    role: Literal["member", "manager", "admin"]
    status: Literal["active", "inactive"]
    student_code: str | None
    class_name: str | None
    faculty: str | None
    joined_at: datetime
    total_hours: Decimal
    total_points: Decimal


class MembersResponse(BaseModel):
    """``GET /orgs/{org_id}/members`` — the full roster."""

    members: list[MemberRow]


class MemberUpdateRequest(BaseModel):
    """Body of ``PATCH /orgs/{org_id}/members/{member_id}`` (admin action).

    Plain ``str`` fields rather than Literals: invalid values surface as a
    structured domain error (``invalid_role``/``invalid_status``) instead
    of a bare FastAPI 422, keeping error bodies uniform for clients.
    """

    role: str | None = None
    status: str | None = None


class MemberSelfUpdateRequest(BaseModel):
    """Body of ``PATCH /orgs/{org_id}/members/me`` — the member's own row."""

    full_name: str | None = None
    student_code: str | None = None
    class_name: str | None = None
    faculty: str | None = None


class MembershipResponse(BaseModel):
    """Returned by both member-update endpoints."""

    membership: MembershipDetail

"""Request/response schemas for the ``/auth`` endpoints.

Thin transport shapes only — every rule (email shape, password bounds,
name normalization) is enforced in :mod:`backend.domain.accounts`, and ORM
entities are mapped to these models explicitly by the router.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Re-exported: OrgRef moved to schemas.orgs (every feature embeds it).
from backend.api.schemas.orgs import OrgRef


class RegisterRequest(BaseModel):
    """Body of ``POST /auth/register``."""

    email: str
    password: str
    full_name: str


class LoginRequest(BaseModel):
    """Body of ``POST /auth/login``."""

    email: str
    password: str


class UserOut(BaseModel):
    """The public view of a user account."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    full_name: str
    phone: str | None
    is_active: bool
    created_at: datetime


class AuthResponse(BaseModel):
    """Token + user payload returned by register and login."""

    access_token: str
    token_type: Literal["bearer"] = Field(default="bearer")
    user: UserOut


class MembershipOut(BaseModel):
    """One roster entry the current user holds in an organization."""

    member_id: UUID
    org_id: UUID
    role: Literal["member", "manager", "admin"]
    status: Literal["active", "inactive"]
    student_code: str | None
    class_name: str | None
    faculty: str | None
    joined_at: datetime
    org: OrgRef


class MeResponse(BaseModel):
    """``GET /auth/me`` — the account plus every org membership it holds."""

    user: UserOut
    memberships: list[MembershipOut]

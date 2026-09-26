"""Request/response schemas for registration endpoints.

Thin transport shapes — lifecycle decisions live in
:mod:`backend.domain.registrations` and persistence in
:mod:`backend.services.registrations`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from backend.api.schemas.orgs import OrgRef

RegistrationStatus = Literal["pending", "approved", "rejected", "cancelled"]
ActivityStatusRef = Literal["draft", "published", "cancelled", "completed"]


class RegistrationOut(BaseModel):
    """The public view of one activity_registrations row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    activity_id: UUID
    member_id: UUID
    status: RegistrationStatus
    note: str | None
    checked_in_at: datetime | None
    reviewed_by: UUID | None
    reviewed_at: datetime | None
    created_at: datetime


class RegisterRequest(BaseModel):
    """Body of ``POST /activities/{id}/register``."""

    note: str | None = None


class RegistrationResponse(BaseModel):
    """Returned by register/cancel/review."""

    registration: RegistrationOut


class ReviewRequest(BaseModel):
    """Body of ``POST /registrations/{id}/review``."""

    action: Literal["approve", "reject"]


class RegistrationMember(BaseModel):
    """The member identity attached to a registration row."""

    member_id: UUID
    full_name: str
    student_code: str | None
    class_name: str | None
    faculty: str | None
    email: str | None


class RegistrationRowOut(BaseModel):
    """A registration plus its member, in the manager's list."""

    registration: RegistrationOut
    member: RegistrationMember


class RegistrationListResponse(BaseModel):
    """``GET /activities/{id}/registrations``."""

    registrations: list[RegistrationRowOut]


class CheckinResponse(BaseModel):
    """Returned by both check-in paths (code and manager-manual)."""

    registration: RegistrationOut
    already_checked_in: bool
    checked_in_count: int


class RegistrationActivityRef(BaseModel):
    """The activity a registration belongs to, inlined for display."""

    id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    status: ActivityStatusRef


class MyRegistrationRow(BaseModel):
    """One of the caller's registrations, with activity and org inlined."""

    registration: RegistrationOut
    activity: RegistrationActivityRef
    org: OrgRef


class MyRegistrationsResponse(BaseModel):
    """``GET /me/registrations``."""

    registrations: list[MyRegistrationRow]

"""Request/response schemas for volunteer-record endpoints.

Thin transport shapes — validation lives in
:mod:`backend.domain.records`, persistence in
:mod:`backend.services.records`. ``hours`` is nullable on output because a
participation-only record credits no hours; ``points`` is always present.
Decimals serialize as JSON strings (``"12.5"``), matching the activity
schemas — clients parse them, never compute on floats.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from backend.api.schemas.orgs import OrgRef
from backend.api.schemas.registrations import RegistrationActivityRef


class RecordOut(BaseModel):
    """The public view of one ``volunteer_records`` row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    member_id: UUID
    activity_id: UUID | None
    registration_id: UUID | None
    title: str
    hours: Decimal | None
    points: Decimal
    awarded_on: date
    note: str | None
    evidence_url: str | None
    recorded_by: UUID | None
    created_at: datetime


class RecordTotals(BaseModel):
    """The caller's summed awards across every org they belong to."""

    hours: Decimal
    points: Decimal


class OrgAwardTotalOut(BaseModel):
    """One org's contribution inside ``MyRecordsResponse.by_org``."""

    org: OrgRef
    hours: Decimal
    points: Decimal


class MyRecordRow(BaseModel):
    """One of the caller's records with its activity and org inlined."""

    record: RecordOut
    activity: RegistrationActivityRef | None
    org: OrgRef


class MyRecordsResponse(BaseModel):
    """``GET /me/records`` — totals, per-org breakdown, and the rows."""

    totals: RecordTotals
    by_org: list[OrgAwardTotalOut]
    records: list[MyRecordRow]


class ManualRecordRequest(BaseModel):
    """Body of ``POST /orgs/{org_id}/members/{member_id}/records``.

    A standalone record by default (``activity_id`` NULL); pass
    ``activity_id`` to link the record to an org activity — e.g. a member
    who attended but was never registered. ``registration_id`` is always
    NULL: registration linkage belongs to the activity-completion flow.
    """

    title: str
    hours: Decimal | None = None
    points: Decimal = Decimal("0")
    awarded_on: date | None = None
    note: str | None = None
    evidence_url: str | None = None
    activity_id: UUID | None = None


class RecordUpdateRequest(BaseModel):
    """Body of ``PATCH /records/{record_id}`` — all fields optional.

    Explicit ``null`` clears the nullable fields (``hours``, ``note``,
    ``evidence_url``) and is rejected for the non-nullable ones
    (``title``, ``points``, ``awarded_on``) by the service.
    """

    title: str | None = None
    hours: Decimal | None = None
    points: Decimal | None = None
    awarded_on: date | None = None
    note: str | None = None
    evidence_url: str | None = None


class RecordResponse(BaseModel):
    """Returned by the manual create and the update."""

    record: RecordOut


class RecordMemberRef(BaseModel):
    """The member identity attached to a staff-scoped record list."""

    member_id: UUID
    full_name: str
    student_code: str | None
    class_name: str | None
    faculty: str | None
    email: str | None


class MemberRecordsResponse(BaseModel):
    """``GET /orgs/{org_id}/members/{member_id}/records``."""

    member: RecordMemberRef
    records: list[RecordOut]

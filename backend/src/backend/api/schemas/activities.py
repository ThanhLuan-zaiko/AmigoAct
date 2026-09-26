"""Request/response schemas for activity endpoints.

Thin transport shapes — schedule/lifecycle rules live in
:mod:`backend.domain.activities`. ``ActivityUpsertRequest`` is a *full
upsert*: ``PATCH /activities/{id}`` replaces all editable fields with the
values given (absent nullable fields become ``None``).

``points``/``hours`` are :class:`decimal.Decimal`, which serialize as JSON
strings (``"12.50"``) — clients parse them, never compute on floats.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from backend.api.schemas.orgs import OrgRef
from backend.api.schemas.registrations import RegistrationOut

ActivityStatus = Literal["draft", "published", "cancelled", "completed"]


class ActivityUpsertRequest(BaseModel):
    """Body of ``POST /orgs/{org_id}/activities`` and ``PATCH /activities/{id}``."""

    title: str
    description: str | None = None
    location: str | None = None
    capacity: int | None = None
    points: Decimal = Decimal("0")
    hours: Decimal = Decimal("0")
    registration_opens_at: datetime | None = None
    registration_closes_at: datetime | None = None
    starts_at: datetime
    ends_at: datetime


class ActivityOut(BaseModel):
    """The public view of an activity."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    org_id: UUID
    title: str
    description: str | None
    location: str | None
    status: ActivityStatus
    capacity: int | None
    points: Decimal
    hours: Decimal
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    starts_at: datetime
    ends_at: datetime
    created_at: datetime


class ActivityListItem(BaseModel):
    """One row of the org activity list, with live counters."""

    activity: ActivityOut
    registered: int
    checked_in: int


class ActivityListResponse(BaseModel):
    """``GET /orgs/{org_id}/activities``."""

    activities: list[ActivityListItem]


class ActivityDetailResponse(BaseModel):
    """``GET /activities/{id}`` — detail plus the caller's own state."""

    activity: ActivityOut
    registered: int
    checked_in: int
    my_registration: RegistrationOut | None
    checkin_code: str | None


class CheckinCodeSetRequest(BaseModel):
    """Body of ``POST /activities/{id}/checkin-code`` — rotate forces new."""

    rotate: bool = False


class CheckinCodeResponse(BaseModel):
    """The activity's check-in code; ``rotated`` is True when regenerated."""

    code: str
    rotated: bool


class ActivityTransitionResponse(BaseModel):
    """Returned by create/publish/cancel: the activity in its new state."""

    activity: ActivityOut


class ActivityCompleteResponse(BaseModel):
    """``POST /activities/{id}/complete`` — plus the records minted."""

    activity: ActivityOut
    records_created: int


class FeedItem(BaseModel):
    """One feed row: activity, its org, the caller's registration status."""

    activity: ActivityOut
    org: OrgRef
    my_registration_status: str | None
    registered: int


class FeedResponse(BaseModel):
    """``GET /me/feed`` — upcoming/ongoing activities across my orgs."""

    activities: list[FeedItem]

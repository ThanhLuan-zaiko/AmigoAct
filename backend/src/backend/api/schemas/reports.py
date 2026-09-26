"""Response schemas for the manager reporting endpoints.

Thin transport shapes mirroring :mod:`backend.services.reports` exactly —
all aggregation happens in the service over real rows. ``faculty`` and
``student_code`` stay ``None`` when undeclared; the frontend renders the
placeholder.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class OverviewTotalsOut(BaseModel):
    """Headline counters for the org overview."""

    model_config = ConfigDict(from_attributes=True)

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


class MonthlyBucketOut(BaseModel):
    """One ``YYYY-MM`` bucket of the overview monthly series."""

    model_config = ConfigDict(from_attributes=True)

    month: str
    activities: int
    registrations: int
    hours: Decimal


class FacultySumOut(BaseModel):
    """Award rollup per declared faculty (``None`` = undeclared)."""

    model_config = ConfigDict(from_attributes=True)

    faculty: str | None
    members: int
    hours: Decimal
    points: Decimal


class TopVolunteerOut(BaseModel):
    """One member's award sum in the top-volunteers board."""

    model_config = ConfigDict(from_attributes=True)

    member_id: UUID
    full_name: str
    student_code: str | None
    faculty: str | None
    hours: Decimal
    points: Decimal
    record_count: int


class ReportsOverviewResponse(BaseModel):
    """``GET /orgs/{org_id}/reports/overview``."""

    totals: OverviewTotalsOut
    monthly: list[MonthlyBucketOut]
    by_faculty: list[FacultySumOut]
    top_volunteers: list[TopVolunteerOut]


class ActivityReportRowOut(BaseModel):
    """One activity's registration funnel plus awarded sums."""

    id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    status: Literal["draft", "published", "cancelled", "completed"]
    capacity: int | None
    registered: int
    approved: int
    checked_in: int
    hours_awarded: Decimal
    points_awarded: Decimal


class ActivitiesReportResponse(BaseModel):
    """``GET /orgs/{org_id}/reports/activities``."""

    activities: list[ActivityReportRowOut]

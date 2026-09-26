"""Org reporting endpoints — manager-facing aggregates.

Both reports are read-only: no events are emitted because nothing is
committed. ``from``/``to`` are calendar-date filters applied by the
service (``activities.starts_at`` / ``records.awarded_on``).
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import get_current_user
from backend.api.events import publish_events
from backend.api.schemas.reports import (
    ActivitiesReportResponse,
    ActivityReportRowOut,
    FacultySumOut,
    MonthlyBucketOut,
    OverviewTotalsOut,
    ReportsOverviewResponse,
    TopVolunteerOut,
)
from backend.database import get_session
from backend.db.models import User
from backend.services import reports
from backend.services.memberships import require_org_role

router = APIRouter(tags=["reports"])

ActivityStatus = Literal["draft", "published", "cancelled", "completed"]


@router.get("/orgs/{org_id}/reports/overview")
async def reports_overview(
    org_id: uuid.UUID,
    request: Request,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: Annotated[date | None, Query()] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ReportsOverviewResponse:
    """Org totals, monthly series, faculty rollups, top volunteers."""
    staff = await require_org_role(session, org_id, user.id, "manager")
    report, events = await reports.overview(session, staff, org_id, date_from=from_, date_to=to)
    await publish_events(request, events)
    return ReportsOverviewResponse(
        totals=OverviewTotalsOut.model_validate(report.totals),
        monthly=[MonthlyBucketOut.model_validate(bucket) for bucket in report.monthly],
        by_faculty=[FacultySumOut.model_validate(bucket) for bucket in report.by_faculty],
        top_volunteers=[
            TopVolunteerOut.model_validate(volunteer) for volunteer in report.top_volunteers
        ],
    )


@router.get("/orgs/{org_id}/reports/activities")
async def reports_activities(
    org_id: uuid.UUID,
    request: Request,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: Annotated[date | None, Query()] = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivitiesReportResponse:
    """Per-activity registration funnel plus awarded sums."""
    staff = await require_org_role(session, org_id, user.id, "manager")
    rows, events = await reports.activities_report(
        session, staff, org_id, date_from=from_, date_to=to
    )
    await publish_events(request, events)
    return ActivitiesReportResponse(
        activities=[
            ActivityReportRowOut(
                id=row.activity.id,
                title=row.activity.title,
                starts_at=row.activity.starts_at,
                ends_at=row.activity.ends_at,
                status=cast(ActivityStatus, row.activity.status),
                capacity=row.activity.capacity,
                registered=row.registered,
                approved=row.approved,
                checked_in=row.checked_in,
                hours_awarded=row.hours_awarded,
                points_awarded=row.points_awarded,
            )
            for row in rows
        ]
    )

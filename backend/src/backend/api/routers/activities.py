"""Activity endpoints: CRUD, lifecycle transitions, check-in, and feeds.

Routers stay thin — they parse input, call the service (which owns
authorization, validation, and the commit), publish returned domain
events, and map ORM rows onto response schemas explicitly.

``/me/*`` routes are declared on this router because they read the same
resources from the caller's perspective; they share no path prefix with
``/orgs/...`` or ``/activities/...`` so ordering is not load-bearing here,
but the static ``/me`` segments are still registered first for clarity.
"""

from __future__ import annotations

import uuid
from typing import Literal, cast

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import get_current_user
from backend.api.events import publish_events
from backend.api.schemas.activities import (
    ActivityCompleteResponse,
    ActivityDetailResponse,
    ActivityListItem,
    ActivityListResponse,
    ActivityOut,
    ActivityTransitionResponse,
    ActivityUpsertRequest,
    CheckinCodeResponse,
    CheckinCodeSetRequest,
    FeedItem,
    FeedResponse,
)
from backend.api.schemas.checkin import CheckinRequest
from backend.api.schemas.orgs import OrgRef
from backend.api.schemas.registrations import (
    CheckinResponse,
    MyRegistrationRow,
    MyRegistrationsResponse,
    RegisterRequest,
    RegistrationActivityRef,
    RegistrationListResponse,
    RegistrationMember,
    RegistrationOut,
    RegistrationResponse,
    RegistrationRowOut,
)
from backend.database import get_session
from backend.db.models import Activity, ActivityRegistration, User
from backend.services import activities, checkin, feed, registrations
from backend.services.memberships import require_membership, require_org_role

router = APIRouter(tags=["activities"])

ActivityStatus = Literal["draft", "published", "cancelled", "completed"]
RegistrationStatus = Literal["pending", "approved", "rejected", "cancelled"]


def _fields(body: ActivityUpsertRequest) -> activities.ActivityFields:
    """Map the upsert body onto the service-level field bundle."""
    return activities.ActivityFields(
        title=body.title,
        description=body.description,
        location=body.location,
        capacity=body.capacity,
        points=body.points,
        hours=body.hours,
        registration_opens_at=body.registration_opens_at,
        registration_closes_at=body.registration_closes_at,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
    )


def _activity_out(activity: Activity) -> ActivityOut:
    """Map an ``Activity`` row to its response schema."""
    return ActivityOut.model_validate(activity)


def _registration_out(registration: ActivityRegistration) -> RegistrationOut:
    """Map an ``ActivityRegistration`` row to its response schema."""
    return RegistrationOut.model_validate(registration)


def _checkin_response(
    registration: ActivityRegistration, already: bool, checked_in_count: int
) -> CheckinResponse:
    """Build the shared check-in response body."""
    return CheckinResponse(
        registration=_registration_out(registration),
        already_checked_in=already,
        checked_in_count=checked_in_count,
    )


@router.get("/me/feed")
async def my_feed(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FeedResponse:
    """Upcoming and ongoing published activities across the caller's orgs."""
    items, events = await feed.get_feed(session, user)
    await publish_events(request, events)
    return FeedResponse(
        activities=[
            FeedItem(
                activity=_activity_out(item.activity),
                org=OrgRef.model_validate(item.org),
                my_registration_status=cast(RegistrationStatus | None, item.my_registration_status),
                registered=item.registered,
            )
            for item in items
        ]
    )


@router.get("/me/registrations")
async def my_registrations(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MyRegistrationsResponse:
    """Every registration the caller holds, newest first."""
    rows, events = await registrations.my_registrations(session, user)
    await publish_events(request, events)
    return MyRegistrationsResponse(
        registrations=[
            MyRegistrationRow(
                registration=_registration_out(row.registration),
                activity=RegistrationActivityRef(
                    id=row.activity.id,
                    title=row.activity.title,
                    starts_at=row.activity.starts_at,
                    ends_at=row.activity.ends_at,
                    status=cast(ActivityStatus, row.activity.status),
                ),
                org=OrgRef.model_validate(row.org),
            )
            for row in rows
        ]
    )


@router.post("/orgs/{org_id}/activities", status_code=201)
async def create_activity(
    org_id: uuid.UUID,
    body: ActivityUpsertRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityTransitionResponse:
    """Create a draft activity; managers and admins only."""
    member = await require_org_role(session, org_id, user.id, "manager")
    activity, events = await activities.create_activity(session, member, _fields(body))
    await publish_events(request, events)
    return ActivityTransitionResponse(activity=_activity_out(activity))


@router.get("/orgs/{org_id}/activities")
async def list_activities(
    org_id: uuid.UUID,
    request: Request,
    status: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityListResponse:
    """List the org's activities; drafts are hidden from plain members."""
    member = await require_membership(session, org_id, user.id)
    items, events = await activities.list_org_activities(
        session, org_id, member, status_filter=status
    )
    await publish_events(request, events)
    return ActivityListResponse(
        activities=[
            ActivityListItem(
                activity=_activity_out(item.activity),
                registered=item.registered,
                checked_in=item.checked_in,
            )
            for item in items
        ]
    )


@router.get("/activities/{activity_id}")
async def get_activity(
    activity_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityDetailResponse:
    """Activity detail plus the caller's own registration state."""
    detail, events = await activities.get_activity_detail(session, activity_id, user)
    await publish_events(request, events)
    return ActivityDetailResponse(
        activity=_activity_out(detail.activity),
        registered=detail.registered,
        checked_in=detail.checked_in,
        my_registration=(
            _registration_out(detail.my_registration)
            if detail.my_registration is not None
            else None
        ),
        checkin_code=detail.checkin_code,
    )


@router.patch("/activities/{activity_id}")
async def update_activity(
    activity_id: uuid.UUID,
    body: ActivityUpsertRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityTransitionResponse:
    """Replace an activity's editable fields; managers only."""
    activity, events = await activities.update_activity(session, user, activity_id, _fields(body))
    await publish_events(request, events)
    return ActivityTransitionResponse(activity=_activity_out(activity))


@router.post("/activities/{activity_id}/publish")
async def publish_activity(
    activity_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityTransitionResponse:
    """Publish a draft activity; managers only."""
    activity, events = await activities.publish_activity(session, user, activity_id)
    await publish_events(request, events)
    return ActivityTransitionResponse(activity=_activity_out(activity))


@router.post("/activities/{activity_id}/cancel")
async def cancel_activity(
    activity_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityTransitionResponse:
    """Cancel a draft or published activity; managers only."""
    activity, events = await activities.cancel_activity(session, user, activity_id)
    await publish_events(request, events)
    return ActivityTransitionResponse(activity=_activity_out(activity))


@router.post("/activities/{activity_id}/complete")
async def complete_activity(
    activity_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ActivityCompleteResponse:
    """Complete a published activity and mint volunteer records."""
    result, events = await activities.complete_activity(session, user, activity_id)
    await publish_events(request, events)
    return ActivityCompleteResponse(
        activity=_activity_out(result.activity),
        records_created=result.records_created,
    )


@router.post("/activities/{activity_id}/checkin-code")
async def set_checkin_code(
    activity_id: uuid.UUID,
    request: Request,
    body: CheckinCodeSetRequest | None = None,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CheckinCodeResponse:
    """Return (or rotate) the activity's check-in code; managers only."""
    result, events = await checkin.set_checkin_code(
        session, user, activity_id, rotate=body.rotate if body else False
    )
    await publish_events(request, events)
    return CheckinCodeResponse(code=result.code, rotated=result.rotated)


@router.delete("/activities/{activity_id}/checkin-code", status_code=204)
async def revoke_checkin_code(
    activity_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    """Clear the activity's check-in code; managers only."""
    _, events = await checkin.revoke_checkin_code(session, user, activity_id)
    await publish_events(request, events)


@router.post("/activities/{activity_id}/checkin")
async def checkin_by_code(
    activity_id: uuid.UUID,
    body: CheckinRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CheckinResponse:
    """Check the caller in with the activity's code; members only."""
    (registration, already, checked_in_count), events = await checkin.checkin_by_code(
        session, user, activity_id, body.code
    )
    await publish_events(request, events)
    return _checkin_response(registration, already, checked_in_count)


@router.get("/activities/{activity_id}/registrations")
async def list_registrations(
    activity_id: uuid.UUID,
    request: Request,
    status: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RegistrationListResponse:
    """List an activity's registrations with member details; managers only."""
    rows, events = await registrations.list_registrations(
        session, user, activity_id, status_filter=status
    )
    await publish_events(request, events)
    return RegistrationListResponse(
        registrations=[
            RegistrationRowOut(
                registration=_registration_out(row.registration),
                member=RegistrationMember(
                    member_id=row.member.id,
                    full_name=row.member.full_name,
                    student_code=row.member.student_code,
                    class_name=row.member.class_name,
                    faculty=row.member.faculty,
                    email=row.email,
                ),
            )
            for row in rows
        ]
    )


@router.post("/activities/{activity_id}/register", status_code=201)
async def register(
    activity_id: uuid.UUID,
    body: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RegistrationResponse:
    """Register the caller for the activity (pending until reviewed)."""
    registration, events = await registrations.register(session, user, activity_id, body.note)
    await publish_events(request, events)
    return RegistrationResponse(registration=_registration_out(registration))

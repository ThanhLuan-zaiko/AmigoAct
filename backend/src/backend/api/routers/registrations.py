"""Registration-keyed endpoints: cancel (member), review + manual check-in (manager).

These act on ``/registrations/{registration_id}`` — the registration id is
the key because the caller arrives holding it, not the activity id.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import get_current_user
from backend.api.events import publish_events
from backend.api.schemas.registrations import (
    CheckinResponse,
    RegistrationOut,
    RegistrationResponse,
    ReviewRequest,
)
from backend.database import get_session
from backend.db.models import ActivityRegistration, User
from backend.services import registrations

router = APIRouter(tags=["registrations"])


def _registration_out(registration: ActivityRegistration) -> RegistrationOut:
    """Map an ``ActivityRegistration`` row to its response schema."""
    return RegistrationOut.model_validate(registration)


@router.post("/registrations/{registration_id}/cancel")
async def cancel_registration(
    registration_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RegistrationResponse:
    """Cancel the caller's own pending/approved registration."""
    registration, events = await registrations.cancel_registration(session, user, registration_id)
    await publish_events(request, events)
    return RegistrationResponse(registration=_registration_out(registration))


@router.post("/registrations/{registration_id}/review")
async def review_registration(
    registration_id: uuid.UUID,
    body: ReviewRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RegistrationResponse:
    """Approve or reject a pending registration; managers only."""
    registration, events = await registrations.review_registration(
        session, user, registration_id, body.action
    )
    await publish_events(request, events)
    return RegistrationResponse(registration=_registration_out(registration))


@router.post("/registrations/{registration_id}/checkin")
async def manager_checkin(
    registration_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CheckinResponse:
    """Manually check in an approved registration at the door."""
    result, events = await registrations.manager_checkin(session, user, registration_id)
    await publish_events(request, events)
    return CheckinResponse(
        registration=_registration_out(result.registration),
        already_checked_in=result.already_checked_in,
        checked_in_count=result.checked_in_count,
    )

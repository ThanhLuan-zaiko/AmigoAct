"""Authentication endpoints: register, login, and the current-user view.

Routers stay thin — validation lives in :mod:`backend.domain.accounts`,
persistence in :mod:`backend.services.accounts`, and error translation in
:mod:`backend.api.errors`. ORM entities are mapped to response schemas
explicitly; an ORM object reaching FastAPI serialization would trip the
``lazy="raise"`` guards the moment a relationship was touched.
"""

from __future__ import annotations

from typing import Literal, cast

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.api.deps import get_current_user
from backend.api.schemas.auth import (
    AuthResponse,
    LoginRequest,
    MembershipOut,
    MeResponse,
    RegisterRequest,
    UserOut,
)
from backend.api.schemas.orgs import OrgRef
from backend.config import get_settings
from backend.database import get_session
from backend.db.models import OrgMember, User
from backend.security import create_access_token
from backend.services import accounts

router = APIRouter(tags=["auth"])


def _auth_response(user: User) -> AuthResponse:
    """Issue a token for ``user`` and shape the register/login body."""
    token = create_access_token(str(user.id), get_settings())
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/auth/register", status_code=201)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    """Create an account and return a bearer token for it."""
    user = await accounts.register(
        session,
        email=body.email,
        password=body.password,
        full_name=body.full_name,
    )
    return _auth_response(user)


@router.post("/auth/login")
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> AuthResponse:
    """Verify credentials and return a bearer token."""
    user = await accounts.authenticate(session, email=body.email, password=body.password)
    return _auth_response(user)


@router.get("/auth/me")
async def me(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeResponse:
    """Return the account plus every org membership it holds.

    Memberships are returned regardless of status (the member should see
    the truth of their roster entries), sorted by organization code for a
    stable client display.
    """
    result = await session.scalars(
        select(OrgMember)
        .where(OrgMember.user_id == user.id)
        .options(selectinload(OrgMember.organization))
    )
    memberships = sorted(result.all(), key=lambda m: (m.organization.code, m.org_id.bytes))
    return MeResponse(
        user=UserOut.model_validate(user),
        memberships=[
            MembershipOut(
                member_id=membership.id,
                org_id=membership.org_id,
                # The DB CHECK constraints already bound these columns to the
                # Literal domains; cast tells mypy what the schema enforces.
                role=cast(Literal["member", "manager", "admin"], membership.role),
                status=cast(Literal["active", "inactive"], membership.status),
                student_code=membership.student_code,
                class_name=membership.class_name,
                faculty=membership.faculty,
                joined_at=membership.joined_at,
                org=OrgRef.model_validate(membership.organization),
            )
            for membership in memberships
        ],
    )

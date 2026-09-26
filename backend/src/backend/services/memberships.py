"""Membership resolution — who may act inside an organization.

Routers hold a :class:`~backend.db.models.User` and an ``org_id`` (from the
path or via the entity being acted on); these helpers resolve that pair to
the member row, or raise the matching :class:`DomainError`. A *membership*
means an **active** member row: inactive rows are former members and do
not grant anything.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Organization, OrgMember
from backend.domain.errors import NotFoundError, PermissionDeniedError
from backend.domain.organizations import rank


async def get_membership(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID
) -> OrgMember | None:
    """Return the user's *active* member row in ``org_id``, or ``None``."""
    member: OrgMember | None = await session.scalar(
        select(OrgMember).where(
            OrgMember.org_id == org_id,
            OrgMember.user_id == user_id,
            OrgMember.status == "active",
        )
    )
    return member


async def require_membership(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID
) -> OrgMember:
    """Return the active member row or raise.

    Raises:
        NotFoundError: ``org_not_found`` when the org is missing or
            inactive — an inactive org hides its roster entirely.
        PermissionDeniedError: ``not_a_member`` when the user has no
            active member row in the org.
    """
    org = await session.get(Organization, org_id)
    if org is None or not org.is_active:
        raise NotFoundError("organization not found", code="org_not_found")
    member = await get_membership(session, org_id, user_id)
    if member is None:
        raise PermissionDeniedError("not a member of this organization", code="not_a_member")
    return member


async def require_org_role(
    session: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, min_role: str
) -> OrgMember:
    """Return the member row when the user's role ranks at least ``min_role``.

    Raises:
        NotFoundError: ``org_not_found`` for a missing/inactive org.
        PermissionDeniedError: ``not_a_member`` or ``insufficient_role``.
    """
    member = await require_membership(session, org_id, user_id)
    if rank(member.role) < rank(min_role):
        raise PermissionDeniedError(
            f"requires the {min_role} role or higher",
            code="insufficient_role",
        )
    return member

"""The member feed — upcoming activities across the caller's orgs.

Split from :mod:`backend.services.activities` along the cohesion seam:
this module owns the cross-org read ("what can I join next"), while
``activities`` owns single-org and single-activity operations.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.base import utcnow
from backend.db.models import Activity, ActivityRegistration, Organization, OrgMember, User
from backend.domain.registrations import ACTIVE_STATUSES
from backend.services.events import DomainEvent


@dataclass(frozen=True)
class FeedItem:
    """One feed row: activity, its org, and the caller's own state."""

    activity: Activity
    org: Organization
    my_registration_status: str | None
    registered: int


async def get_feed(
    session: AsyncSession,
    user: User,
    *,
    now: datetime | None = None,
) -> tuple[list[FeedItem], list[DomainEvent]]:
    """Return upcoming/ongoing published activities across the user's orgs.

    An activity appears when it is published, has not ended, and belongs to
    an active org where the user holds an active membership. Each row
    carries the user's own registration status for that activity, if any.
    """
    moment = now or utcnow()
    my_orgs = select(OrgMember.org_id).where(
        OrgMember.user_id == user.id, OrgMember.status == "active"
    )
    my_members = select(OrgMember.id).where(
        OrgMember.user_id == user.id, OrgMember.status == "active"
    )
    rows = (
        await session.execute(
            select(Activity, Organization, ActivityRegistration.status)
            .join(Organization, Activity.org_id == Organization.id)
            .outerjoin(
                ActivityRegistration,
                and_(
                    ActivityRegistration.activity_id == Activity.id,
                    ActivityRegistration.member_id.in_(my_members),
                ),
            )
            .where(
                Activity.status == "published",
                Activity.ends_at >= moment,
                Activity.org_id.in_(my_orgs),
                Organization.is_active,
            )
            .order_by(Activity.starts_at, Activity.id)
        )
    ).all()

    activity_ids = [activity.id for activity, _org, _status in rows]
    counts: dict[uuid.UUID, int] = {}
    if activity_ids:
        count_rows = (
            await session.execute(
                select(
                    ActivityRegistration.activity_id,
                    func.count(ActivityRegistration.id),
                )
                .where(
                    ActivityRegistration.activity_id.in_(activity_ids),
                    ActivityRegistration.status.in_(ACTIVE_STATUSES),
                )
                .group_by(ActivityRegistration.activity_id)
            )
        ).all()
        for count_row in count_rows:
            counts[count_row[0]] = count_row[1]

    return [
        FeedItem(
            activity=activity,
            org=org,
            my_registration_status=my_status,
            registered=counts.get(activity.id, 0),
        )
        for activity, org, my_status in rows
    ], []

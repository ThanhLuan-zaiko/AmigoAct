"""Domain events — what services emit and the API layer publishes.

A service returns ``(result, events)``; the router hands ``events`` to
:func:`backend.api.events.publish_events`, which pushes each one over the
WebSocket channel. Services never touch the socket layer themselves.

The event-type strings are a frozen wire contract — the frontend and the
``tests/regression/test_ws_contract.py`` pin depend on them.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Activity, OrgMember

# The four event types on the wire. Changing one is a contract change.
EVENT_ACTIVITY_CHANGED = "activity.changed"
EVENT_REGISTRATION_CHANGED = "registration.changed"
EVENT_CHECKIN_RECORDED = "checkin.recorded"
EVENT_RECORD_CHANGED = "record.changed"


@dataclass(frozen=True)
class DomainEvent:
    """One outbound push: type, JSON-ready data, and the users to reach.

    ``data`` must already be JSON-serializable — UUIDs as ``str``, datetimes
    as ISO strings, Decimals as ``str``.
    """

    type: str
    data: dict[str, Any]
    user_ids: tuple[uuid.UUID, ...]


async def org_staff_user_ids(session: AsyncSession, org_id: uuid.UUID) -> list[uuid.UUID]:
    """Return user ids of the org's active managers and admins."""
    result = await session.scalars(
        select(OrgMember.user_id).where(
            OrgMember.org_id == org_id,
            OrgMember.role.in_(("manager", "admin")),
            OrgMember.status == "active",
            OrgMember.user_id.is_not(None),
        )
    )
    return [user_id for user_id in result.all() if user_id is not None]


def event_targets(
    staff_user_ids: list[uuid.UUID], *extra: uuid.UUID | None
) -> tuple[uuid.UUID, ...]:
    """Union staff ids with extra recipients, deduplicated, order-stable."""
    seen: list[uuid.UUID] = []
    for user_id in (*staff_user_ids, *extra):
        if user_id is not None and user_id not in seen:
            seen.append(user_id)
    return tuple(seen)


def activity_changed_event(activity: Activity, staff: list[uuid.UUID]) -> DomainEvent:
    """Build the ``activity.changed`` event pushed to org staff."""
    return DomainEvent(
        type=EVENT_ACTIVITY_CHANGED,
        data={
            "org_id": str(activity.org_id),
            "activity_id": str(activity.id),
            "activity_status": activity.status,
        },
        user_ids=tuple(staff),
    )

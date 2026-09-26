"""ORM model package — importing it registers every table on ``Base.metadata``.

Always import via this package (or import ``backend.db.models`` before
calling ``Base.metadata.create_all``) so no table is silently missing from
the metadata.
"""

from __future__ import annotations

from backend.db.models.accounts import Organization, OrgMember, User
from backend.db.models.activities import (
    Activity,
    ActivityRegistration,
    VolunteerRecord,
)

__all__ = (
    "Activity",
    "ActivityRegistration",
    "OrgMember",
    "Organization",
    "User",
    "VolunteerRecord",
)

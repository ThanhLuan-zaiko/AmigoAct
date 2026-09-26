"""Regression: pin the WebSocket event wire contract.

The frontend consumes these pushes while being built in parallel — the
four event-type strings and the exact ``data`` key sets must not drift.
The live payload assertions sit in ``tests/integration/test_ws_events.py``;
here we pin the constants, the envelope discipline, and the one event
builder that needs no database.

Layer: **regression**
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import ClassVar

import pytest

from backend.services import events
from backend.services.events import DomainEvent

pytestmark = pytest.mark.regression


class TestEventTypeStrings:
    """The four Phase-2 event names, spelled exactly."""

    def test_type_constants(self) -> None:
        assert events.EVENT_ACTIVITY_CHANGED == "activity.changed"
        assert events.EVENT_REGISTRATION_CHANGED == "registration.changed"
        assert events.EVENT_CHECKIN_RECORDED == "checkin.recorded"
        assert events.EVENT_RECORD_CHANGED == "record.changed"


class TestDomainEventShape:
    """``DomainEvent`` is the unit routers hand to ``publish_events``."""

    def test_fields_and_targeting(self) -> None:
        user_a, user_b = uuid.uuid4(), uuid.uuid4()
        event = DomainEvent(
            type="activity.changed",
            data={"org_id": "x"},
            user_ids=(user_a, user_b),
        )

        assert event.type == "activity.changed"
        assert event.data == {"org_id": "x"}
        assert event.user_ids == (user_a, user_b)


class TestEventDataKeySets:
    """The documented ``data`` shapes the frontend parses."""

    EXPECTED: ClassVar[dict[str, set[str]]] = {
        "activity.changed": {"org_id", "activity_id", "activity_status"},
        "registration.changed": {
            "org_id",
            "activity_id",
            "registration_id",
            "member_id",
            "status",
        },
        "checkin.recorded": {
            "org_id",
            "activity_id",
            "registration_id",
            "member_user_id",
            "member_full_name",
            "checked_in_at",
            "checked_in_count",
        },
        "record.changed": {
            "org_id",
            "activity_id",
            "record_id",
            "member_id",
            "title",
            "hours",
            "points",
            "awarded_on",
        },
    }

    def test_activity_changed_builder_matches_contract(self) -> None:
        """The session-free builder emits exactly the pinned key set."""
        activity = SimpleNamespace(org_id=uuid.uuid4(), id=uuid.uuid4(), status="published")
        staff = [uuid.uuid4()]

        event = events.activity_changed_event(activity, staff)  # type: ignore[arg-type]

        assert event.type == "activity.changed"
        assert set(event.data) == self.EXPECTED["activity.changed"]
        assert event.data["activity_status"] == "published"
        assert event.user_ids == tuple(staff)

    def test_event_targets_dedupes_and_skips_none(self) -> None:
        """Recipients are staff plus extras, deduplicated, order-stable."""
        a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

        targets = events.event_targets([a, b], b, None, c)

        assert targets == (a, b, c)

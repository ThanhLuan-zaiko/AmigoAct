"""Integration test: domain events reach the right WebSocket subscribers.

Three accounts — org admin, org member, outsider — each hold a real
``/api/ws?token=`` connection while the full flow runs over HTTP. A final
``ping`` then drains each socket FIFO-style: everything pushed lands
before the ``pong``, so the collected event list is exact.

Layer: **integration**
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from backend.config import Settings
from backend.security import create_access_token

pytestmark = pytest.mark.integration

# Must equal the secret the ``db_app`` fixture builds the app with.
TEST_JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

WS_URL = "/api/ws"
NOW = datetime.now(UTC)

ACTIVITY_CHANGED_KEYS = {"org_id", "activity_id", "activity_status"}
REGISTRATION_CHANGED_KEYS = {
    "org_id",
    "activity_id",
    "registration_id",
    "member_id",
    "status",
}
CHECKIN_RECORDED_KEYS = {
    "org_id",
    "activity_id",
    "registration_id",
    "member_user_id",
    "member_full_name",
    "checked_in_at",
    "checked_in_count",
}
RECORD_CHANGED_KEYS = {
    "org_id",
    "activity_id",
    "record_id",
    "member_id",
    "title",
    "hours",
    "points",
    "awarded_on",
}


def _token_for(user: dict[str, Any]) -> str:
    """Mint a bearer token for the registered ``user`` payload."""
    return create_access_token(str(user["id"]), Settings(jwt_secret=TEST_JWT_SECRET))


def _drain(socket: WebSocketTestSession) -> list[dict[str, Any]]:
    """Push a ping, then collect every queued event until the pong."""
    socket.send_json({"type": "ping"})
    collected: list[dict[str, Any]] = []
    for _ in range(50):  # bounded — never hang the suite
        message = socket.receive_json()
        if message["type"] == "pong":
            return collected
        collected.append(message)
    pytest.fail("pong never arrived — the socket queue is drifting")


def _types(events: list[dict[str, Any]]) -> list[str]:
    return [event["type"] for event in events]


def test_lifecycle_events_reach_staff_and_member_not_outsiders(
    db_client: TestClient, auth_headers: RegisterFn
) -> None:
    """One org flow; every event lands exactly where it should."""
    admin_headers, admin_user = auth_headers("adm@example.edu", "correct-horse", "Adm")
    member_headers, member_user = auth_headers("sv@example.edu", "correct-horse", "SV")
    _outsider_headers, outsider_user = auth_headers("out@example.edu", "correct-horse", "Out")

    with (
        db_client.websocket_connect(f"{WS_URL}?token={_token_for(admin_user)}") as admin_ws,
        db_client.websocket_connect(f"{WS_URL}?token={_token_for(member_user)}") as member_ws,
        db_client.websocket_connect(f"{WS_URL}?token={_token_for(outsider_user)}") as outsider_ws,
    ):
        admin_ws.receive_json()  # hello
        member_ws.receive_json()
        outsider_ws.receive_json()

        # The full flow: org → join → draft → publish → register → approve
        # → code → check-in → complete.
        org = db_client.post(
            "/api/orgs", headers=admin_headers, json={"code": "WSORG", "name": "WS Org"}
        ).json()["org"]
        db_client.post("/api/orgs/join", headers=member_headers, json={"code": "WSORG"})
        activity = db_client.post(
            f"/api/orgs/{org['id']}/activities",
            headers=admin_headers,
            json={
                "title": "WS Event Test",
                "points": "5",
                "hours": "2",
                "starts_at": (NOW + timedelta(minutes=30)).isoformat(),
                "ends_at": (NOW + timedelta(hours=2)).isoformat(),
            },
        ).json()["activity"]
        db_client.post(f"/api/activities/{activity['id']}/publish", headers=admin_headers)
        registration = db_client.post(
            f"/api/activities/{activity['id']}/register",
            headers=member_headers,
            json={},
        ).json()["registration"]
        db_client.post(
            f"/api/registrations/{registration['id']}/review",
            headers=admin_headers,
            json={"action": "approve"},
        )
        db_client.post(f"/api/activities/{activity['id']}/checkin-code", headers=admin_headers)
        db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=member_headers,
            json={
                "code": db_client.get(
                    f"/api/activities/{activity['id']}", headers=admin_headers
                ).json()["checkin_code"]
            },
        )
        # Move starts_at into the past — complete requires a started activity.
        db_client.patch(
            f"/api/activities/{activity['id']}",
            headers=admin_headers,
            json={
                "title": "WS Event Test",
                "points": "5",
                "hours": "2",
                "starts_at": (NOW - timedelta(minutes=10)).isoformat(),
                "ends_at": (NOW + timedelta(hours=2)).isoformat(),
            },
        )
        db_client.post(f"/api/activities/{activity['id']}/complete", headers=admin_headers)

        admin_events = _drain(admin_ws)
        member_events = _drain(member_ws)
        outsider_events = _drain(outsider_ws)

    # Admin (staff) sees every org-scoped event, in order.
    assert _types(admin_events) == [
        "activity.changed",  # create
        "activity.changed",  # publish
        "registration.changed",  # member registers
        "registration.changed",  # admin approves
        "activity.changed",  # check-in code set
        "checkin.recorded",
        "activity.changed",  # PATCH moved starts_at
        "activity.changed",  # complete
        "record.changed",
    ]

    # The member only sees events where they are a named target.
    assert _types(member_events) == [
        "registration.changed",
        "registration.changed",
        "checkin.recorded",
        "record.changed",
    ]

    # The outsider's socket stays silent the whole time.
    assert outsider_events == []

    # Exact payload shapes — the wire contract.
    activity_changed = next(e for e in admin_events if e["type"] == "activity.changed")
    assert set(activity_changed["data"]) == ACTIVITY_CHANGED_KEYS

    registration_changed = next(e for e in member_events if e["type"] == "registration.changed")
    assert set(registration_changed["data"]) == REGISTRATION_CHANGED_KEYS
    assert registration_changed["data"]["status"] == "pending"
    approved = [e for e in member_events if e["type"] == "registration.changed"][1]
    assert approved["data"]["status"] == "approved"

    for holder in (admin_events, member_events):
        checkin = next(e for e in holder if e["type"] == "checkin.recorded")
        assert set(checkin["data"]) == CHECKIN_RECORDED_KEYS
        assert checkin["data"]["member_user_id"] == member_user["id"]
        assert checkin["data"]["member_full_name"] == "SV"
        assert checkin["data"]["checked_in_count"] == 1

        record = next(e for e in holder if e["type"] == "record.changed")
        assert set(record["data"]) == RECORD_CHANGED_KEYS
        assert record["data"]["title"] == "WS Event Test"
        assert record["data"]["hours"] == "2"  # Decimal → str
        assert record["data"]["points"] == "5"

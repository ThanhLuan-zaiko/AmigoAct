"""Integration tests for activity CRUD, lifecycle, check-in codes, and feed.

The full happy path (register → approve → check-in → complete → record)
is exercised over HTTP against the real app on SQLite; every error code
asserted is part of the client contract.

Layer: **integration**
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.db.models import VolunteerRecord

pytestmark = pytest.mark.integration

SessionFactory = async_sessionmaker[AsyncSession]
RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

NOW = datetime.now(UTC)
IN_30_MIN = NOW + timedelta(minutes=30)
IN_4_HOURS = NOW + timedelta(hours=4)
AN_HOUR_AGO = NOW - timedelta(hours=1)

ACTIVITY_KEYS = {
    "id",
    "org_id",
    "title",
    "description",
    "location",
    "status",
    "capacity",
    "points",
    "hours",
    "registration_opens_at",
    "registration_closes_at",
    "starts_at",
    "ends_at",
    "created_at",
}


def _create_org(client: TestClient, headers: dict[str, str], code: str = "CLB1") -> Any:
    response = client.post("/api/orgs", headers=headers, json={"code": code, "name": "Club"})
    assert response.status_code == 201, response.text
    return response.json()["org"]


def _join(client: TestClient, headers: dict[str, str], code: str) -> Any:
    response = client.post("/api/orgs/join", headers=headers, json={"code": code})
    assert response.status_code == 201, response.text
    return response.json()["membership"]


def _activity_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "title": "Ngày hội tình nguyện",
        "starts_at": IN_30_MIN.isoformat(),
        "ends_at": IN_4_HOURS.isoformat(),
        "points": "10",
        "hours": "4",
        "capacity": 50,
    }
    body.update(overrides)
    return body


def _create_activity(
    client: TestClient, headers: dict[str, str], org_id: str, **overrides: Any
) -> Any:
    response = client.post(
        f"/api/orgs/{org_id}/activities",
        headers=headers,
        json=_activity_body(**overrides),
    )
    assert response.status_code == 201, response.text
    return response.json()["activity"]


def _publish(client: TestClient, headers: dict[str, str], activity_id: str) -> Any:
    response = client.post(f"/api/activities/{activity_id}/publish", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["activity"]


def _register(client: TestClient, headers: dict[str, str], activity_id: str) -> Any:
    response = client.post(f"/api/activities/{activity_id}/register", headers=headers, json={})
    assert response.status_code == 201, response.text
    return response.json()["registration"]


def _approve(client: TestClient, headers: dict[str, str], registration_id: str) -> Any:
    response = client.post(
        f"/api/registrations/{registration_id}/review",
        headers=headers,
        json={"action": "approve"},
    )
    assert response.status_code == 200, response.text
    return response.json()["registration"]


def _checkin_code(client: TestClient, headers: dict[str, str], activity_id: str) -> str:
    response = client.post(f"/api/activities/{activity_id}/checkin-code", headers=headers)
    assert response.status_code == 200, response.text
    code: str = response.json()["code"]
    return code


class TestCreateAndVisibility:
    """Creation rules, draft visibility, and the member/manager split."""

    def test_create_returns_draft(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)

        activity = _create_activity(db_client, headers, org["id"])

        assert activity["status"] == "draft"
        assert set(activity) == ACTIVITY_KEYS
        assert activity["points"] == "10"  # Decimal → string

    def test_member_cannot_create(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        member_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, member_headers, org["code"])

        response = db_client.post(
            f"/api/orgs/{org['id']}/activities",
            headers=member_headers,
            json=_activity_body(),
        )

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_draft_hidden_from_members_in_list_and_detail(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        member_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, member_headers, org["code"])
        draft = _create_activity(db_client, headers, org["id"])

        admin_list = db_client.get(f"/api/orgs/{org['id']}/activities", headers=headers).json()[
            "activities"
        ]
        member_list = db_client.get(
            f"/api/orgs/{org['id']}/activities", headers=member_headers
        ).json()["activities"]
        assert len(admin_list) == 1
        assert member_list == []

        detail = db_client.get(f"/api/activities/{draft['id']}", headers=member_headers)
        assert detail.status_code == 404
        assert detail.json()["code"] == "activity_not_found"

    def test_invalid_schedule_rejected(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)

        response = db_client.post(
            f"/api/orgs/{org['id']}/activities",
            headers=headers,
            json=_activity_body(ends_at=AN_HOUR_AGO.isoformat()),
        )

        assert response.status_code == 422
        assert response.json()["code"] == "invalid_window"


class TestLifecycle:
    """publish / cancel / complete transitions and their rejections."""

    def test_full_lifecycle_creates_records(
        self,
        db_client: TestClient,
        db_sessionmaker: SessionFactory,
        auth_headers: RegisterFn,
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, student_headers, org["code"])
        activity = _create_activity(db_client, headers, org["id"])
        _publish(db_client, headers, activity["id"])
        registration = _register(db_client, student_headers, activity["id"])
        _approve(db_client, headers, registration["id"])
        code = _checkin_code(db_client, headers, activity["id"])
        checked = db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=student_headers,
            json={"code": code},
        )
        assert checked.status_code == 200, checked.text

        # Slide starts_at into the past (published activities are editable)
        # so the completion guard sees a started activity.
        moved = db_client.patch(
            f"/api/activities/{activity['id']}",
            headers=headers,
            json=_activity_body(starts_at=AN_HOUR_AGO.isoformat()),
        )
        assert moved.status_code == 200, moved.text

        response = db_client.post(f"/api/activities/{activity['id']}/complete", headers=headers)

        assert response.status_code == 200
        payload = response.json()
        assert payload["activity"]["status"] == "completed"
        assert payload["records_created"] == 1

        async def _fetch_records() -> list[VolunteerRecord]:
            async with db_sessionmaker() as session:
                result = await session.scalars(select(VolunteerRecord))
                return list(result.all())

        records = asyncio.run(_fetch_records())
        assert len(records) == 1
        assert records[0].points == 10
        assert records[0].registration_id == uuid.UUID(registration["id"])

    def test_complete_skips_pre_existing_record(
        self,
        db_client: TestClient,
        db_sessionmaker: SessionFactory,
        auth_headers: RegisterFn,
    ) -> None:
        """Record creation is idempotent: a seeded record is not duplicated."""
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        membership = _join(db_client, student_headers, org["code"])
        activity = _create_activity(db_client, headers, org["id"])
        _publish(db_client, headers, activity["id"])
        registration = _register(db_client, student_headers, activity["id"])
        _approve(db_client, headers, registration["id"])
        code = _checkin_code(db_client, headers, activity["id"])
        db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=student_headers,
            json={"code": code},
        )
        db_client.patch(
            f"/api/activities/{activity['id']}",
            headers=headers,
            json=_activity_body(starts_at=AN_HOUR_AGO.isoformat()),
        )

        async def _seed() -> None:
            async with db_sessionmaker() as session:
                session.add(
                    VolunteerRecord(
                        member_id=uuid.UUID(membership["member_id"]),
                        activity_id=uuid.UUID(activity["id"]),
                        registration_id=uuid.UUID(registration["id"]),
                        title="Manual entry",
                        points=1,
                        hours=1,
                    )
                )
                await session.commit()

        asyncio.run(_seed())

        response = db_client.post(f"/api/activities/{activity['id']}/complete", headers=headers)

        assert response.status_code == 200
        assert response.json()["records_created"] == 0  # skipped, not duplicated

    def test_cancelled_is_terminal(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        activity = _create_activity(db_client, headers, org["id"])

        cancelled = db_client.post(f"/api/activities/{activity['id']}/cancel", headers=headers)
        assert cancelled.json()["activity"]["status"] == "cancelled"

        for action in ("publish", "cancel", "complete"):
            response = db_client.post(f"/api/activities/{activity['id']}/{action}", headers=headers)
            assert response.status_code == 409, action
            assert response.json()["code"] == "invalid_transition", action

    def test_complete_before_start_is_not_started(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        activity = _create_activity(db_client, headers, org["id"])  # starts +30min
        _publish(db_client, headers, activity["id"])

        response = db_client.post(f"/api/activities/{activity['id']}/complete", headers=headers)

        assert response.status_code == 409
        assert response.json()["code"] == "not_started"

    def test_publish_then_republish_is_conflict(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)
        activity = _create_activity(db_client, headers, org["id"])
        _publish(db_client, headers, activity["id"])

        response = db_client.post(f"/api/activities/{activity['id']}/publish", headers=headers)

        assert response.status_code == 409
        assert response.json()["code"] == "invalid_transition"

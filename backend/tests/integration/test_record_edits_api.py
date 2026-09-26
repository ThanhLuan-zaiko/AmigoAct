"""Integration tests for record edits, deletes, and their events.

Covers ``PATCH /records/{id}`` (UNSET/None semantics, explicit-null
rejections), ``DELETE /records/{id}``, the ``record.changed`` WebSocket
fan-out, and the ORM-level ``uq_volrec_member_activity`` backstop.

Layer: **integration**
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.testclient import WebSocketTestSession

from backend.config import Settings
from backend.db.models import Activity, VolunteerRecord
from backend.security import create_access_token

pytestmark = pytest.mark.integration

RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]
SessionFactory = async_sessionmaker[AsyncSession]

# Must equal the secret the ``db_app`` fixture builds the app with.
TEST_JWT_SECRET = "test-secret-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

NOW = datetime.now(UTC)

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
    for _ in range(50):
        message = socket.receive_json()
        if message["type"] == "pong":
            return collected
        collected.append(message)
    pytest.fail("pong never arrived — the socket queue is drifting")


def _setup(
    client: TestClient, auth_headers: RegisterFn, code: str = "REC1"
) -> tuple[dict[str, str], dict[str, Any], dict[str, str], dict[str, Any], Any, Any]:
    """Org with admin + a joined member. Returns headers, users, org, member."""
    admin, admin_user = auth_headers("adm-rec@example.edu", "correct-horse", "Quản trị")
    student, student_user = auth_headers("sv-rec@example.edu", "correct-horse", "Sinh Viên")
    org = client.post(
        "/api/orgs", headers=admin, json={"code": code, "name": "Đoàn khoa CNTT"}
    ).json()["org"]
    membership = client.post(
        "/api/orgs/join",
        headers=student,
        json={"code": code, "student_code": "SV001", "faculty": "CNTT"},
    ).json()["membership"]
    return admin, admin_user, student, student_user, org, membership


def _create_record(
    client: TestClient, headers: dict[str, str], org_id: str, member_id: str, **body: Any
) -> Any:
    return client.post(
        f"/api/orgs/{org_id}/members/{member_id}/records",
        headers=headers,
        json=body,
    )


def _run(
    maker: SessionFactory,
    scenario: Callable[[AsyncSession], Coroutine[Any, Any, None]],
) -> None:
    """Run ``scenario(session)`` on a fresh loop with a dedicated session."""
    asyncio.run(_run_scenario(maker, scenario))


async def _run_scenario(
    maker: SessionFactory,
    scenario: Callable[[AsyncSession], Coroutine[Any, Any, None]],
) -> None:
    async with maker() as session:
        await scenario(session)


class TestUpdateAndDelete:
    def test_update_applies_patch(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, _au, _s, _su, org, membership = _setup(db_client, auth_headers)
        record_id = _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="Before",
            hours="2",
            note="n",
        ).json()["record"]["id"]

        response = db_client.patch(
            f"/api/records/{record_id}",
            headers=admin,
            json={"title": "  After  edit ", "hours": None, "note": None},
        )

        assert response.status_code == 200
        record = response.json()["record"]
        assert record["title"] == "After edit"
        assert record["hours"] is None  # explicit null clears
        assert record["note"] is None

        # Untouched fields survive: a PATCH that only sets points keeps title.
        response2 = db_client.patch(
            f"/api/records/{record_id}", headers=admin, json={"points": "7"}
        )
        assert response2.json()["record"]["title"] == "After edit"
        assert response2.json()["record"]["points"] == "7"

    def test_update_validation_and_member_denied(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, student, _su, org, membership = _setup(db_client, auth_headers)
        record_id = _create_record(
            db_client, admin, org["id"], membership["member_id"], title="T"
        ).json()["record"]["id"]

        denied = db_client.patch(f"/api/records/{record_id}", headers=student, json={"title": "X"})
        assert denied.status_code == 403
        assert denied.json()["code"] == "insufficient_role"

        invalid = db_client.patch(f"/api/records/{record_id}", headers=admin, json={"points": None})
        assert invalid.status_code == 422
        assert invalid.json()["code"] == "invalid_points"

        future = db_client.patch(
            f"/api/records/{record_id}",
            headers=admin,
            json={"awarded_on": (date.today() + timedelta(days=2)).isoformat()},
        )
        assert future.status_code == 422
        assert future.json()["code"] == "future_awarded_on"

    def test_update_missing_record_is_404(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, _su, _org, _m = _setup(db_client, auth_headers)

        response = db_client.patch(
            "/api/records/00000000-0000-0000-0000-000000000099",
            headers=admin,
            json={"title": "x"},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "record_not_found"

    def test_delete_then_gone(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, _au, student, _su, org, membership = _setup(db_client, auth_headers)
        record_id = _create_record(
            db_client, admin, org["id"], membership["member_id"], title="Doomed"
        ).json()["record"]["id"]

        denied = db_client.delete(f"/api/records/{record_id}", headers=student)
        assert denied.status_code == 403

        deleted = db_client.delete(f"/api/records/{record_id}", headers=admin)
        assert deleted.status_code == 204
        assert deleted.content == b""

        remaining = db_client.get(
            f"/api/orgs/{org['id']}/members/{membership['member_id']}/records",
            headers=admin,
        ).json()["records"]
        assert remaining == []

        again = db_client.delete(f"/api/records/{record_id}", headers=admin)
        assert again.status_code == 404


class TestRecordChangedEvents:
    def test_manual_create_emits_record_changed(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, student_user, org, membership = _setup(db_client, auth_headers)

        with db_client.websocket_connect(f"/api/ws?token={_token_for(student_user)}") as member_ws:
            member_ws.receive_json()  # hello

            created = _create_record(
                db_client,
                admin,
                org["id"],
                membership["member_id"],
                title="Đợt WS",
                points="2",
            )
            assert created.status_code == 201

            events = _drain(member_ws)

        changed = [e for e in events if e["type"] == "record.changed"]
        assert len(changed) == 1
        data = changed[0]["data"]
        assert set(data) == RECORD_CHANGED_KEYS
        assert data["title"] == "Đợt WS"
        assert data["activity_id"] is None
        assert data["member_id"] == membership["member_id"]


class TestUniqueConstraintBackstop:
    """The ``uq_volrec_member_activity`` index holds even at ORM level."""

    def test_second_member_activity_record_raises(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            # Seed via ORM: org + member + activity + first record.
            from backend.db.models import Organization, OrgMember
            from backend.domain.ids import new_id

            org = Organization(id=new_id(), code="BACKSTOP", name="Backstop")
            member = OrgMember(id=new_id(), org_id=org.id, full_name="M")
            activity = Activity(
                id=new_id(),
                org_id=org.id,
                title="Act",
                starts_at=NOW,
                ends_at=NOW + timedelta(hours=2),
            )
            session.add_all([org, member, activity])
            first = VolunteerRecord(
                member_id=member.id,
                activity_id=activity.id,
                title="First",
                points=Decimal("1"),
            )
            session.add(first)
            await session.commit()

            dupe = VolunteerRecord(
                member_id=member.id,
                activity_id=activity.id,
                title="Second",
            )
            session.add(dupe)
            with pytest.raises(IntegrityError):
                await session.commit()

        _run(db_sessionmaker, scenario)

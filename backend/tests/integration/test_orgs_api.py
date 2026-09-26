"""Integration tests for the ``/api/orgs/*`` endpoints.

Real app over ``TestClient`` with the SQLite-backed ``db_client``; error
codes are asserted exactly — they are the client contract.

Layer: **integration**
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.db.models import OrgMember, VolunteerRecord
from backend.domain.ids import new_id

pytestmark = pytest.mark.integration

SessionFactory = async_sessionmaker[AsyncSession]
RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

ORGS = "/api/orgs"
ORG_KEYS = {"id", "code", "name", "description", "contact_email", "is_active", "created_at"}
MEMBERSHIP_KEYS = {
    "member_id",
    "role",
    "status",
    "full_name",
    "student_code",
    "class_name",
    "faculty",
    "joined_at",
}
MEMBER_ROW_KEYS = {
    "member_id",
    "user_id",
    "email",
    "full_name",
    "role",
    "status",
    "student_code",
    "class_name",
    "faculty",
    "joined_at",
    "total_hours",
    "total_points",
}


def _create_org(client: TestClient, headers: dict[str, str], code: str = "CLBALPHA") -> Any:
    response = client.post(f"{ORGS}", headers=headers, json={"code": code, "name": "Club Alpha"})
    assert response.status_code == 201, response.text
    return response.json()


def _join(client: TestClient, headers: dict[str, str], code: str, **fields: str) -> Any:
    return client.post(f"{ORGS}/join", headers=headers, json={"code": code, **fields})


def _seed_unlinked_member(maker: SessionFactory, org_id: str, student_code: str) -> str:
    """Insert a roster row with no user_id (pre-registered roster)."""

    async def _insert() -> uuid.UUID:
        member_id = new_id()
        async with maker() as session:
            session.add(
                OrgMember(
                    id=member_id,
                    org_id=uuid.UUID(org_id),
                    user_id=None,
                    full_name="Pre Imported",
                    student_code=student_code,
                )
            )
            await session.commit()
        return member_id

    return str(asyncio.run(_insert()))


def _seed_record(maker: SessionFactory, member_id: str, hours: str, points: str) -> None:
    async def _insert() -> None:
        async with maker() as session:
            session.add(
                VolunteerRecord(
                    id=new_id(),
                    member_id=uuid.UUID(member_id),
                    title="External service",
                    hours=Decimal(hours),
                    points=Decimal(points),
                )
            )
            await session.commit()

    asyncio.run(_insert())


class TestCreateOrg:
    def test_create_returns_org_and_admin_membership(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _user = auth_headers("admin@example.edu", "correct-horse", "Admin")
        response = db_client.post(
            ORGS,
            headers=headers,
            json={"code": "  clbalpha ", "name": "Club  Alpha", "contact_email": " A@Edu.VN "},
        )

        assert response.status_code == 201
        payload = response.json()
        assert set(payload) == {"org", "membership"}
        assert payload["org"]["code"] == "CLBALPHA"  # normalized
        assert payload["org"]["name"] == "Club Alpha"  # whitespace collapsed
        assert payload["org"]["contact_email"] == "a@edu.vn"
        assert set(payload["org"]) == ORG_KEYS
        assert set(payload["membership"]) == MEMBERSHIP_KEYS
        assert payload["membership"]["role"] == "admin"
        assert payload["membership"]["status"] == "active"

    def test_duplicate_code_is_409(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        _create_org(db_client, headers)

        response = db_client.post(
            ORGS, headers=headers, json={"code": "clbalpha", "name": "Copycat"}
        )

        assert response.status_code == 409
        assert response.json()["code"] == "org_code_taken"

    def test_bad_code_is_422(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")

        response = db_client.post(ORGS, headers=headers, json={"code": "!!", "name": "X"})

        assert response.status_code == 422
        assert response.json()["code"] == "invalid_org_code"


class TestJoinOrg:
    def test_join_creates_member_row(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "Sinh Vien")

        response = _join(
            db_client,
            student_headers,
            org["code"],
            student_code="sv001",
            class_name="CNTT  01",
            faculty=" CNTT ",
        )

        assert response.status_code == 201
        membership = response.json()["membership"]
        assert membership["role"] == "member"
        assert membership["student_code"] == "sv001"  # case preserved
        assert membership["class_name"] == "CNTT 01"  # whitespace collapsed
        assert membership["faculty"] == "CNTT"

    def test_join_twice_is_conflict(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        assert _join(db_client, student_headers, org["code"]).status_code == 201

        response = _join(db_client, student_headers, org["code"])

        assert response.status_code == 409
        assert response.json()["code"] == "already_member"

    def test_join_unknown_org_is_404(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")

        response = _join(db_client, headers, "NOSUCH")

        assert response.status_code == 404
        assert response.json()["code"] == "org_not_found"

    def test_join_claims_unlinked_roster_row(
        self,
        db_client: TestClient,
        db_sessionmaker: SessionFactory,
        auth_headers: RegisterFn,
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        seeded_id = _seed_unlinked_member(db_sessionmaker, org["id"], "SV777")
        student_headers, _user = auth_headers("sv@example.edu", "correct-horse", "SV")

        response = _join(db_client, student_headers, org["code"], student_code="SV777")

        assert response.status_code == 201
        membership = response.json()["membership"]
        assert membership["member_id"] == seeded_id  # claimed, not duplicated

    def test_join_with_taken_student_code_is_409(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        first, _ = auth_headers("a@example.edu", "correct-horse", "A")
        second, _ = auth_headers("b@example.edu", "correct-horse", "B")
        assert _join(db_client, first, org["code"], student_code="SV1").status_code == 201

        response = _join(db_client, second, org["code"], student_code="SV1")

        assert response.status_code == 409
        assert response.json()["code"] == "student_code_taken"


class TestOrgDetail:
    def test_detail_returns_stats(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]

        response = db_client.get(f"{ORGS}/{org['id']}", headers=headers)

        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"org", "membership", "stats"}
        assert payload["stats"] == {
            "member_count": 1,
            "activity_count": 0,
            "upcoming_count": 0,
        }

    def test_detail_requires_membership(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        outsider, _ = auth_headers("out@example.edu", "correct-horse", "Out")

        response = db_client.get(f"{ORGS}/{org['id']}", headers=outsider)

        assert response.status_code == 403
        assert response.json()["code"] == "not_a_member"


class TestMemberListAndUpdates:
    def test_members_list_with_totals(
        self,
        db_client: TestClient,
        db_sessionmaker: SessionFactory,
        auth_headers: RegisterFn,
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        member_id = _join(db_client, student_headers, org["code"]).json()["membership"]["member_id"]
        _seed_record(db_sessionmaker, member_id, "3.5", "10")
        _seed_record(db_sessionmaker, member_id, "1.25", "5")

        response = db_client.get(f"{ORGS}/{org['id']}/members", headers=headers)

        assert response.status_code == 200
        members = response.json()["members"]
        assert len(members) == 2
        assert set(members[0]) == MEMBER_ROW_KEYS
        student = next(m for m in members if m["email"] == "sv@example.edu")
        assert student["total_hours"] == "4.75"  # Decimal → JSON string
        assert student["total_points"] == "15"
        admin = next(m for m in members if m["role"] == "admin")
        assert admin["total_hours"] == "0"

    def test_member_list_requires_manager(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, student_headers, org["code"])

        response = db_client.get(f"{ORGS}/{org['id']}/members", headers=student_headers)

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_admin_promotes_member(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        member_id = _join(db_client, student_headers, org["code"]).json()["membership"]["member_id"]

        response = db_client.patch(
            f"{ORGS}/{org['id']}/members/{member_id}",
            headers=headers,
            json={"role": "manager"},
        )

        assert response.status_code == 200
        assert response.json()["membership"]["role"] == "manager"

    def test_manager_cannot_change_roles(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        mgr_headers, _ = auth_headers("m@example.edu", "correct-horse", "Mgr")
        member_id = _join(db_client, mgr_headers, org["code"]).json()["membership"]["member_id"]
        db_client.patch(
            f"{ORGS}/{org['id']}/members/{member_id}", headers=headers, json={"role": "manager"}
        )
        other_headers, _ = auth_headers("o@example.edu", "correct-horse", "O")
        other_id = _join(db_client, other_headers, org["code"]).json()["membership"]["member_id"]

        response = db_client.patch(
            f"{ORGS}/{org['id']}/members/{other_id}",
            headers=mgr_headers,
            json={"role": "member"},
        )

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_last_admin_cannot_self_demote(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        members = db_client.get(f"{ORGS}/{org['id']}/members", headers=headers).json()["members"]
        admin_id = members[0]["member_id"]

        response = db_client.patch(
            f"{ORGS}/{org['id']}/members/{admin_id}",
            headers=headers,
            json={"role": "member"},
        )

        assert response.status_code == 409
        assert response.json()["code"] == "last_admin"

    def test_self_update_edits_profile_fields(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        student_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, student_headers, org["code"], student_code="SV1")

        response = db_client.patch(
            f"{ORGS}/{org['id']}/members/me",
            headers=student_headers,
            json={"class_name": "CNTT 02", "full_name": "  Tên   Mới "},
        )

        assert response.status_code == 200
        membership = response.json()["membership"]
        assert membership["class_name"] == "CNTT 02"
        assert membership["full_name"] == "Tên Mới"
        assert membership["student_code"] == "SV1"  # untouched

    def test_self_update_student_code_conflict(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]
        a, _ = auth_headers("a@example.edu", "correct-horse", "A")
        b, _ = auth_headers("b@example.edu", "correct-horse", "B")
        _join(db_client, a, org["code"], student_code="TAKEN")
        _join(db_client, b, org["code"], student_code="FREE")

        response = db_client.patch(
            f"{ORGS}/{org['id']}/members/me",
            headers=b,
            json={"student_code": "TAKEN"},
        )

        assert response.status_code == 409
        assert response.json()["code"] == "student_code_taken"

    def test_members_me_route_shadows_uuid_param(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        """GET/PATCH on /members/me must not 422 against the {member_id} route."""
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers)["org"]

        response = db_client.patch(f"{ORGS}/{org['id']}/members/me", headers=headers, json={})

        assert response.status_code == 200

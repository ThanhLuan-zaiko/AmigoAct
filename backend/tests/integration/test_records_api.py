"""Integration tests for the volunteer-record read endpoints.

Covers the member-facing read (``GET /me/records``) and the staff-scoped
member view (``GET /orgs/{org_id}/members/{member_id}/records``). Manual
creation lives in ``test_record_admin_api.py``, edits/deletes and the
``record.changed`` fan-out in ``test_record_edits_api.py``.

Layer: **integration**
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

NOW = datetime.now(UTC)

RECORD_KEYS = {
    "id",
    "member_id",
    "activity_id",
    "registration_id",
    "title",
    "hours",
    "points",
    "awarded_on",
    "note",
    "evidence_url",
    "recorded_by",
    "created_at",
}


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


def _activity(client: TestClient, headers: dict[str, str], org_id: str) -> Any:
    """Create a draft activity (no publish needed for record linkage)."""
    response = client.post(
        f"/api/orgs/{org_id}/activities",
        headers=headers,
        json={
            "title": "Hoạt động liên kết",
            "starts_at": (NOW + timedelta(days=1)).isoformat(),
            "ends_at": (NOW + timedelta(days=1, hours=4)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["activity"]


class TestMyRecords:
    def test_empty_state_is_honest(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        _a, _au, student, _su, _org, _m = _setup(db_client, auth_headers)

        payload = db_client.get("/api/me/records", headers=student).json()

        assert set(payload) == {"totals", "by_org", "records"}
        assert payload["totals"] == {"hours": "0", "points": "0"}
        assert payload["by_org"] == []
        assert payload["records"] == []

    def test_totals_and_by_org_breakdown(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, student, _su, org, membership = _setup(db_client, auth_headers)
        _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="Đợt một",
            hours="4.5",
            points="10",
        )
        _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="Đợt hai",
            points="3",
            awarded_on="2020-01-15",
        )

        payload = db_client.get("/api/me/records", headers=student).json()

        assert payload["totals"] == {"hours": "4.5", "points": "13"}
        assert payload["by_org"] == [
            {
                "org": {"id": org["id"], "code": "REC1", "name": "Đoàn khoa CNTT"},
                "hours": "4.5",
                "points": "13",
            }
        ]
        rows = payload["records"]
        assert len(rows) == 2
        # Newest awarded_on first; the standalone rows carry no activity.
        assert set(rows[0]) == {"record", "activity", "org"}
        assert rows[0]["record"]["title"] == "Đợt một"
        assert rows[0]["activity"] is None
        assert rows[0]["org"]["code"] == "REC1"
        assert rows[1]["record"]["title"] == "Đợt hai"

    def test_linked_record_inlines_activity(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, student, _su, org, membership = _setup(db_client, auth_headers)
        activity = _activity(db_client, admin, org["id"])
        _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="Override title",
            activity_id=activity["id"],
        )

        row = db_client.get("/api/me/records", headers=student).json()["records"][0]

        assert row["activity"]["id"] == activity["id"]
        assert set(row["activity"]) == {"id", "title", "starts_at", "ends_at", "status"}
        assert row["activity"]["title"] == "Hoạt động liên kết"
        assert row["record"]["activity_id"] == activity["id"]


class TestMemberRecords:
    def test_staff_lists_member_records(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, su, org, membership = _setup(db_client, auth_headers)
        _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="One",
            points="1",
        )

        response = db_client.get(
            f"/api/orgs/{org['id']}/members/{membership['member_id']}/records",
            headers=admin,
        )

        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"member", "records"}
        member = payload["member"]
        assert member["member_id"] == membership["member_id"]
        assert member["full_name"] == "Sinh Viên"
        assert member["student_code"] == "SV001"
        assert member["email"] == su["email"]
        assert len(payload["records"]) == 1
        assert set(payload["records"][0]) == RECORD_KEYS

    def test_member_cannot_read_others_records(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _a, _au, student, _su, org, membership = _setup(db_client, auth_headers)
        other, _ou = auth_headers("o2@example.edu", "correct-horse", "O2")
        db_client.post("/api/orgs/join", headers=other, json={"code": "REC1"})

        response = db_client.get(
            f"/api/orgs/{org['id']}/members/{membership['member_id']}/records",
            headers=student,
        )
        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

        outsider = db_client.get(
            f"/api/orgs/{org['id']}/members/{membership['member_id']}/records",
            headers=other,
        )
        assert outsider.status_code == 403

    def test_member_of_foreign_org_is_not_found(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, _su, org, _membership = _setup(db_client, auth_headers)
        foreign_admin, _fa = auth_headers("oa@example.edu", "correct-horse", "OA")
        foreign_membership = db_client.post(
            "/api/orgs", headers=foreign_admin, json={"code": "OTH3", "name": "Other"}
        ).json()["membership"]

        # Staff of this org addressing a member of another org → 404.
        response = db_client.get(
            f"/api/orgs/{org['id']}/members/{foreign_membership['member_id']}/records",
            headers=admin,
        )
        assert response.status_code == 404
        assert response.json()["code"] == "member_not_found"

"""Integration tests for staff-managed record creation.

Covers ``POST /orgs/{org_id}/members/{member_id}/records``: standalone
rows, optional activity linkage with the ``uq_volrec_member_activity``
backstop, domain validation, and role checks. Reads live in
``test_records_api.py``; edits/deletes/events in ``test_record_edits_api.py``.

Layer: **integration**
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
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


class TestManualCreate:
    def test_creates_standalone_record(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, admin_user, _student, _su, org, membership = _setup(db_client, auth_headers)

        response = _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="  Hiến   máu  nhân đạo ",
            hours="4.5",
            points="10",
            note="  giấy xác nhận đầy đủ ",
            evidence_url="https://example.com/proof.pdf",
            awarded_on=date.today().isoformat(),
        )

        assert response.status_code == 201, response.text
        record = response.json()["record"]
        assert set(record) == RECORD_KEYS
        assert record["title"] == "Hiến máu nhân đạo"  # whitespace collapsed
        assert record["note"] == "giấy xác nhận đầy đủ"
        assert record["hours"] == "4.5"  # Decimal → string
        assert record["points"] == "10"
        assert record["activity_id"] is None
        assert record["registration_id"] is None
        assert record["member_id"] == membership["member_id"]
        # recorded_by is the staff member row, not the user id.
        assert record["recorded_by"] != admin_user["id"]
        assert record["awarded_on"] == date.today().isoformat()

    def test_awarded_on_defaults_to_today(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, _su, org, membership = _setup(db_client, auth_headers)

        record = _create_record(
            db_client, admin, org["id"], membership["member_id"], title="Đợt xuân"
        ).json()["record"]

        assert record["awarded_on"] == date.today().isoformat()
        assert record["hours"] is None  # participation without hours is legal

    def test_linked_record_backstops_duplicates(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, _su, org, membership = _setup(db_client, auth_headers)
        activity = _activity(db_client, admin, org["id"])
        body = {"title": "Attendance manual", "activity_id": activity["id"], "points": "2"}

        assert (
            _create_record(db_client, admin, org["id"], membership["member_id"], **body).status_code
            == 201
        )

        duplicate = _create_record(db_client, admin, org["id"], membership["member_id"], **body)
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "record_exists"

    def test_linked_record_rejects_other_orgs_activity(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au, _s, _su, org, membership = _setup(db_client, auth_headers)
        other_admin, _oa = auth_headers("other@example.edu", "correct-horse", "Other")
        other_org = db_client.post(
            "/api/orgs", headers=other_admin, json={"code": "OTH1", "name": "Other Org"}
        ).json()["org"]
        foreign_activity = _activity(db_client, other_admin, other_org["id"])

        response = _create_record(
            db_client,
            admin,
            org["id"],
            membership["member_id"],
            title="Cross-org attempt",
            activity_id=foreign_activity["id"],
        )

        assert response.status_code == 404
        assert response.json()["code"] == "activity_not_found"

    @pytest.mark.parametrize(
        ("body", "code"),
        [
            ({"title": "   "}, "invalid_title"),
            ({"title": "ok", "hours": "-1"}, "invalid_hours"),
            ({"title": "ok", "hours": "10000"}, "invalid_hours"),
            ({"title": "ok", "points": "-1"}, "invalid_points"),
            ({"title": "ok", "evidence_url": "ftp://x"}, "invalid_evidence_url"),
            ({"title": "ok", "evidence_url": "notaurl"}, "invalid_evidence_url"),
            (
                {"title": "ok", "awarded_on": (date.today() + timedelta(days=1)).isoformat()},
                "future_awarded_on",
            ),
            ({"title": "ok", "note": "x" * 1001}, "value_too_long"),
        ],
    )
    def test_validation_errors(
        self,
        db_client: TestClient,
        auth_headers: RegisterFn,
        body: dict[str, Any],
        code: str,
    ) -> None:
        admin, _au, _s, _su, org, membership = _setup(db_client, auth_headers)

        response = _create_record(db_client, admin, org["id"], membership["member_id"], **body)

        assert response.status_code == 422
        assert response.json()["code"] == code

    def test_member_cannot_create(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        _a, _au, student, _su, org, membership = _setup(db_client, auth_headers)

        response = _create_record(
            db_client, student, org["id"], membership["member_id"], title="Self award"
        )

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_outsider_cannot_create(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        _a, _au, _s, _su, org, membership = _setup(db_client, auth_headers)
        outsider, _ou = auth_headers("out@example.edu", "correct-horse", "Out")

        response = _create_record(
            db_client, outsider, org["id"], membership["member_id"], title="Nope"
        )

        assert response.status_code == 403
        assert response.json()["code"] == "not_a_member"

    def test_cross_org_member_is_404(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, _au, _s, _su, org, _membership = _setup(db_client, auth_headers)
        foreign_admin, _fa = auth_headers("fa@example.edu", "correct-horse", "FA")
        foreign_membership = db_client.post(
            "/api/orgs", headers=foreign_admin, json={"code": "OTH2", "name": "Other"}
        ).json()["membership"]

        # Unknown member id → member_not_found.
        missing = _create_record(
            db_client, admin, org["id"], "00000000-0000-0000-0000-000000000001", title="x"
        )
        assert missing.status_code == 404
        assert missing.json()["code"] == "member_not_found"

        # A real member of ANOTHER org is not addressable either — ids
        # don't leak across organizations.
        cross = _create_record(
            db_client, admin, org["id"], foreign_membership["member_id"], title="x"
        )
        assert cross.status_code == 404
        assert cross.json()["code"] == "member_not_found"

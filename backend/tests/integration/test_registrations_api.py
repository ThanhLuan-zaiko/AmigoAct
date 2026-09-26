"""Integration tests for the registration lifecycle: register → review → cancel.

Covers the n-m association object carrying status, note, and review audit.
The check-in paths live in ``test_checkin_api.py``. Error codes asserted
here are part of the client contract.

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
STARTS_SOON = NOW + timedelta(minutes=30)  # inside the 60-min early check-in window
ENDS = NOW + timedelta(hours=6)

REGISTRATION_KEYS = {
    "id",
    "activity_id",
    "member_id",
    "status",
    "note",
    "checked_in_at",
    "reviewed_by",
    "reviewed_at",
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


def _activity(
    client: TestClient,
    headers: dict[str, str],
    org_id: str,
    *,
    capacity: int | None = 50,
    starts: datetime = STARTS_SOON,
) -> Any:
    """Create + publish a published activity; returns the activity payload."""
    created = client.post(
        f"/api/orgs/{org_id}/activities",
        headers=headers,
        json={
            "title": "Hoạt động mùa hè",
            "capacity": capacity,
            "starts_at": starts.isoformat(),
            "ends_at": (starts + timedelta(hours=4)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    activity = created.json()["activity"]
    published = client.post(f"/api/activities/{activity['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return published.json()["activity"]


def _register(client: TestClient, headers: dict[str, str], activity_id: str, **body: Any) -> Any:
    return client.post(f"/api/activities/{activity_id}/register", headers=headers, json=body)


def _review(client: TestClient, headers: dict[str, str], registration_id: str, action: str) -> Any:
    return client.post(
        f"/api/registrations/{registration_id}/review",
        headers=headers,
        json={"action": action},
    )


def _setup(
    client: TestClient, auth_headers: RegisterFn, capacity: int | None = 50
) -> tuple[dict[str, str], dict[str, str], dict[str, str], Any, Any]:
    """Org with admin + joined member + published activity. Returns handles."""
    admin, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
    student, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
    org = _create_org(client, admin)
    _join(client, student, org["code"])
    activity = _activity(client, admin, org["id"], capacity=capacity)
    return admin, student, org, activity, None


class TestRegister:
    def test_register_creates_pending_row(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, _org, activity, _ = _setup(db_client, auth_headers)

        response = _register(db_client, student, activity["id"], note="  can   drive ")

        assert response.status_code == 201
        registration = response.json()["registration"]
        assert set(registration) == REGISTRATION_KEYS
        assert registration["status"] == "pending"
        assert registration["note"] == "can drive"  # whitespace collapsed

    def test_duplicate_registration_conflicts(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        assert _register(db_client, student, activity["id"]).status_code == 201

        response = _register(db_client, student, activity["id"])

        assert response.status_code == 409
        assert response.json()["code"] == "already_registered"

    def test_non_member_cannot_register(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, _student, _org, activity, _ = _setup(db_client, auth_headers)
        outsider, _ = auth_headers("out@example.edu", "correct-horse", "Out")

        response = _register(db_client, outsider, activity["id"])

        assert response.status_code == 403
        assert response.json()["code"] == "not_a_member"

    def test_registration_on_draft_is_closed(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _unused = auth_headers("admin@example.edu", "correct-horse", "Admin")
        student, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        org = _create_org(db_client, admin)
        _join(db_client, student, org["code"])
        draft = db_client.post(
            f"/api/orgs/{org['id']}/activities",
            headers=admin,
            json={
                "title": "Bí mật",
                "starts_at": STARTS_SOON.isoformat(),
                "ends_at": ENDS.isoformat(),
            },
        ).json()["activity"]

        response = _register(db_client, student, draft["id"])

        assert response.status_code == 409
        assert response.json()["code"] == "registration_closed"

    def test_capacity_counts_pending_and_releases_on_reject(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity, _ = _setup(db_client, auth_headers, capacity=1)
        second, _ = auth_headers("sv2@example.edu", "correct-horse", "SV2")
        _join(db_client, second, "CLB1")

        assert _register(db_client, student, activity["id"]).status_code == 201

        full = _register(db_client, second, activity["id"])
        assert full.status_code == 409
        assert full.json()["code"] == "activity_full"

        # Rejecting the pending row frees the seat — pending holds a seat.
        rows = db_client.get(
            f"/api/activities/{activity['id']}/registrations", headers=admin
        ).json()["registrations"]
        _review(db_client, admin, rows[0]["registration"]["id"], "reject")

        retry = _register(db_client, second, activity["id"])
        assert retry.status_code == 201


class TestCancelAndReview:
    def test_cancel_own_then_re_register_reactivates(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]

        cancelled = db_client.post(f"/api/registrations/{reg_id}/cancel", headers=student)
        assert cancelled.status_code == 200
        assert cancelled.json()["registration"]["status"] == "cancelled"

        again = _register(db_client, student, activity["id"])
        assert again.status_code == 201  # reactivates the same queue slot
        assert again.json()["registration"]["status"] == "pending"

        second_cancel = db_client.post(f"/api/registrations/{reg_id}/cancel", headers=student)
        assert second_cancel.status_code == 200  # still cancellable after re-register

        third = db_client.post(f"/api/registrations/{reg_id}/cancel", headers=student)
        assert third.status_code == 409
        assert third.json()["code"] == "cannot_cancel"

    def test_cancel_other_users_registration_is_404(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]
        other, _ = auth_headers("o@example.edu", "correct-horse", "O")
        _join(db_client, other, "CLB1")

        response = db_client.post(f"/api/registrations/{reg_id}/cancel", headers=other)

        assert response.status_code == 404
        assert response.json()["code"] == "registration_not_found"

    def test_review_approve_then_reject_approved(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]

        approved = _review(db_client, admin, reg_id, "approve")
        assert approved.status_code == 200
        registration = approved.json()["registration"]
        assert registration["status"] == "approved"
        assert registration["reviewed_by"] is not None
        assert registration["reviewed_at"] is not None

        # An approved registration can still be rejected (revocation).
        revoked = _review(db_client, admin, reg_id, "reject")
        assert revoked.json()["registration"]["status"] == "rejected"

        # A rejected registration is final — re-registering is refused.
        retry = _register(db_client, student, activity["id"])
        assert retry.status_code == 409
        assert retry.json()["code"] == "registration_rejected"

    def test_member_cannot_review(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        _admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]

        response = _review(db_client, student, reg_id, "approve")

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_review_non_pending_is_conflict(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]
        _review(db_client, admin, reg_id, "approve")

        response = _review(db_client, admin, reg_id, "approve")

        assert response.status_code == 409
        assert response.json()["code"] == "cannot_review"

    def test_bad_review_action_is_422(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]

        response = _review(db_client, admin, reg_id, "hold")

        assert response.status_code == 422  # Literal rejects before the domain

    def test_list_registrations_manager_only(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity, _ = _setup(db_client, auth_headers)
        _register(db_client, student, activity["id"], note="hi")

        as_member = db_client.get(
            f"/api/activities/{activity['id']}/registrations", headers=student
        )
        assert as_member.status_code == 403

        as_admin = db_client.get(f"/api/activities/{activity['id']}/registrations", headers=admin)
        assert as_admin.status_code == 200
        rows = as_admin.json()["registrations"]
        assert len(rows) == 1
        row = rows[0]
        assert row["registration"]["status"] == "pending"
        assert row["member"]["email"] == "sv@example.edu"
        assert row["member"]["full_name"] == "SV"

        filtered = db_client.get(
            f"/api/activities/{activity['id']}/registrations",
            headers=admin,
            params={"status": "approved"},
        )
        assert filtered.json()["registrations"] == []


class TestMyRegistrations:
    def test_lists_with_activity_and_org_refs(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, org, activity, _ = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"]).json()["registration"]["id"]

        response = db_client.get("/api/me/registrations", headers=student)

        assert response.status_code == 200
        rows = response.json()["registrations"]
        assert len(rows) == 1
        row = rows[0]
        assert set(row) == {"registration", "activity", "org"}
        assert row["registration"]["id"] == reg_id
        assert row["activity"]["id"] == activity["id"]
        assert set(row["activity"]) == {"id", "title", "starts_at", "ends_at", "status"}
        assert row["org"]["code"] == org["code"]

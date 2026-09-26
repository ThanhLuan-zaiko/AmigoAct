"""Integration tests for check-in: the QR/code path and the manager's manual path.

Covers check-in code lifecycle (issue / stable / rotate / revoke), the
member-facing ``POST /activities/{id}/checkin`` flow, and the manager's
manual ``POST /registrations/{id}/checkin``. Error codes asserted here are
part of the client contract.

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
STARTS_LATER = NOW + timedelta(hours=3)  # outside it


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
    starts: datetime = STARTS_SOON,
    draft: bool = False,
) -> Any:
    """Create + publish an activity; returns the activity payload."""
    created = client.post(
        f"/api/orgs/{org_id}/activities",
        headers=headers,
        json={
            "title": "Hoạt động mùa hè",
            "starts_at": starts.isoformat(),
            "ends_at": (starts + timedelta(hours=4)).isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    activity = created.json()["activity"]
    if draft:
        return activity
    published = client.post(f"/api/activities/{activity['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return published.json()["activity"]


def _register(client: TestClient, headers: dict[str, str], activity_id: str) -> str:
    response = client.post(f"/api/activities/{activity_id}/register", headers=headers, json={})
    assert response.status_code == 201, response.text
    registration_id: str = response.json()["registration"]["id"]
    return registration_id


def _approve(client: TestClient, headers: dict[str, str], registration_id: str) -> None:
    response = client.post(
        f"/api/registrations/{registration_id}/review",
        headers=headers,
        json={"action": "approve"},
    )
    assert response.status_code == 200, response.text


def _checkin_code(client: TestClient, headers: dict[str, str], activity_id: str) -> str:
    response = client.post(f"/api/activities/{activity_id}/checkin-code", headers=headers)
    assert response.status_code == 200, response.text
    code: str = response.json()["code"]
    return code


def _setup(
    client: TestClient, auth_headers: RegisterFn
) -> tuple[dict[str, str], dict[str, str], Any, Any]:
    """Org with admin + joined member + published activity (starts soon)."""
    admin, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
    student, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
    org = _create_org(client, admin)
    _join(client, student, org["code"])
    activity = _activity(client, admin, org["id"])
    return admin, student, org, activity


class TestCheckinCode:
    """Set / rotate / revoke the QR check-in code."""

    def test_code_is_generated_then_stable_then_rotated(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _student, _org, _act = _setup(db_client, auth_headers)
        draft = _activity(db_client, admin, _org["id"], draft=True)

        first = db_client.post(f"/api/activities/{draft['id']}/checkin-code", headers=admin)
        assert first.status_code == 200
        payload = first.json()
        assert set(payload) == {"code", "rotated"}
        assert payload["rotated"] is True
        assert len(payload["code"]) == 6

        again = db_client.post(f"/api/activities/{draft['id']}/checkin-code", headers=admin)
        assert again.json() == {"code": payload["code"], "rotated": False}

        rotated = db_client.post(
            f"/api/activities/{draft['id']}/checkin-code",
            headers=admin,
            json={"rotate": True},
        )
        assert rotated.json()["rotated"] is True

        revoked = db_client.delete(f"/api/activities/{draft['id']}/checkin-code", headers=admin)
        assert revoked.status_code == 204

        detail = db_client.get(f"/api/activities/{draft['id']}", headers=admin)
        assert detail.json()["checkin_code"] is None

    def test_member_cannot_get_code(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        _admin, student, _org, activity = _setup(db_client, auth_headers)

        response = db_client.post(f"/api/activities/{activity['id']}/checkin-code", headers=student)

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_checkin_code_not_leaked_to_members(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        """Members see the activity but never the code — managers only."""
        admin, student, _org, activity = _setup(db_client, auth_headers)
        _checkin_code(db_client, admin, activity["id"])

        admin_detail = db_client.get(f"/api/activities/{activity['id']}", headers=admin).json()
        member_detail = db_client.get(f"/api/activities/{activity['id']}", headers=student).json()

        assert admin_detail["checkin_code"] is not None
        assert member_detail["checkin_code"] is None


class TestMemberCheckin:
    """``POST /activities/{id}/checkin`` — the member-facing code path."""

    def test_code_checkin_happy_path_and_idempotent_repeat(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"])
        _approve(db_client, admin, reg_id)
        code = _checkin_code(db_client, admin, activity["id"])

        response = db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=student,
            json={"code": code.lower()},  # lowercase input still matches
        )

        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"registration", "already_checked_in", "checked_in_count"}
        assert payload["already_checked_in"] is False
        assert payload["checked_in_count"] == 1
        checked_at = payload["registration"]["checked_in_at"]
        assert checked_at is not None

        again = db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=student,
            json={"code": code},
        )
        assert again.status_code == 200
        assert again.json()["already_checked_in"] is True
        assert again.json()["registration"]["checked_in_at"] == checked_at

    def test_wrong_code_and_early_window(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, org, activity = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"])
        _approve(db_client, admin, reg_id)
        _checkin_code(db_client, admin, activity["id"])

        wrong = db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=student,
            json={"code": "ZZZZZZ"},
        )
        assert wrong.status_code == 409
        assert wrong.json()["code"] == "wrong_checkin_code"

        # A second activity starting >60min out: right code, too early.
        later = _activity(db_client, admin, org["id"], starts=STARTS_LATER)
        reg2 = _register(db_client, student, later["id"])
        _approve(db_client, admin, reg2)
        code2 = _checkin_code(db_client, admin, later["id"])

        early = db_client.post(
            f"/api/activities/{later['id']}/checkin",
            headers=student,
            json={"code": code2},
        )
        assert early.status_code == 409
        assert early.json()["code"] == "checkin_not_started"

    def test_pending_registration_cannot_checkin(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity = _setup(db_client, auth_headers)
        _register(db_client, student, activity["id"])  # stays pending
        code = _checkin_code(db_client, admin, activity["id"])

        response = db_client.post(
            f"/api/activities/{activity['id']}/checkin",
            headers=student,
            json={"code": code},
        )

        assert response.status_code == 409
        assert response.json()["code"] == "registration_not_approved"

    def test_checkin_on_missing_activity_is_404(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, _org, _act = _setup(db_client, auth_headers)

        response = db_client.post(
            "/api/activities/00000000-0000-7000-8000-000000000000/checkin",
            headers=student,
            json={"code": "ABCDEF"},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "activity_not_found"


class TestManagerManualCheckin:
    """``POST /registrations/{id}/checkin`` — the door-checker path."""

    def test_manager_manual_checkin(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, student, _org, activity = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"])
        _approve(db_client, admin, reg_id)

        response = db_client.post(f"/api/registrations/{reg_id}/checkin", headers=admin)

        assert response.status_code == 200
        assert response.json()["registration"]["checked_in_at"] is not None
        assert response.json()["already_checked_in"] is False

        repeat = db_client.post(f"/api/registrations/{reg_id}/checkin", headers=admin)
        assert repeat.json()["already_checked_in"] is True

        # A checked-in registration is frozen: cancel and review both fail.
        cancel = db_client.post(f"/api/registrations/{reg_id}/cancel", headers=student)
        assert cancel.status_code == 409
        assert cancel.json()["code"] == "cannot_cancel"
        review = db_client.post(
            f"/api/registrations/{reg_id}/review",
            headers=admin,
            json={"action": "reject"},
        )
        assert review.status_code == 409
        assert review.json()["code"] == "cannot_review_checked_in"

    def test_member_cannot_manual_checkin(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        _admin, student, _org, activity = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"])

        response = db_client.post(f"/api/registrations/{reg_id}/checkin", headers=student)

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_pending_registration_rejected_for_manual_checkin(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, _org, activity = _setup(db_client, auth_headers)
        reg_id = _register(db_client, student, activity["id"])  # pending

        response = db_client.post(f"/api/registrations/{reg_id}/checkin", headers=admin)

        assert response.status_code == 409
        assert response.json()["code"] == "registration_not_approved"

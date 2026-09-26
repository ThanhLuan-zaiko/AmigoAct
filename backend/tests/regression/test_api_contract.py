"""Regression tests: lock in behaviour that already works.

Every test here exists to answer one question — *"did my change break something
that used to work?"* — not to discover new behaviour. They assert exact shapes,
not just truthiness, and they are the first thing to run when triaging a bug.

Layer: **regression**
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.regression

RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

HEALTH_KEYS = {"status", "app", "version", "environment"}
READINESS_KEYS = {"status"}
GREETING_KEYS = {"message"}
VERSION_KEYS = {"name", "version"}


class TestHealthResponseContract:
    """The exact top-level keys of each endpoint. Adding a key breaks this."""

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ("/api/health", HEALTH_KEYS),
            ("/api/health/ready", READINESS_KEYS),
            ("/version", VERSION_KEYS),
        ],
    )
    def test_response_keys_are_stable(
        self, client: TestClient, path: str, expected: set[str]
    ) -> None:
        payload: dict[str, Any] = client.get(path).json()

        assert set(payload) == expected, (
            f"{path} response keys changed; update the contract and the docs"
        )

    def test_greeting_response_shape_is_stable(self, client: TestClient) -> None:
        payload: dict[str, Any] = client.get("/api/greeting", params={"name": "A"}).json()

        assert set(payload) == GREETING_KEYS
        assert isinstance(payload["message"], str)


class TestOpenApiSurface:
    """Guards the public HTTP surface against accidental additions/removals."""

    def test_expected_paths_are_registered(self, client: TestClient) -> None:
        paths: set[str] = set(client.get("/openapi.json").json()["paths"])

        # Intentional contract change: Phase 2 added the org/activity/
        # registration surface (see routers/{orgs,activities,registrations}.
        # py). Phase 3 added volunteer records, PDF certificates, and org
        # reporting (see routers/{records,reports}.py). Phase 1 added the
        # three /api/auth/* endpoints.
        assert paths == {
            "/api/health",
            "/api/health/ready",
            "/api/greeting",
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/me",
            "/api/orgs",
            "/api/orgs/join",
            "/api/orgs/{org_id}",
            "/api/orgs/{org_id}/members",
            "/api/orgs/{org_id}/members/me",
            "/api/orgs/{org_id}/members/{member_id}",
            "/api/orgs/{org_id}/activities",
            "/api/activities/{activity_id}",
            "/api/activities/{activity_id}/publish",
            "/api/activities/{activity_id}/cancel",
            "/api/activities/{activity_id}/complete",
            "/api/activities/{activity_id}/checkin-code",
            "/api/activities/{activity_id}/checkin",
            "/api/activities/{activity_id}/registrations",
            "/api/activities/{activity_id}/register",
            "/api/registrations/{registration_id}/cancel",
            "/api/registrations/{registration_id}/review",
            "/api/registrations/{registration_id}/checkin",
            "/api/me/feed",
            "/api/me/registrations",
            "/api/me/records",
            "/api/orgs/{org_id}/members/{member_id}/records",
            "/api/records/{record_id}",
            "/api/records/{record_id}/certificate",
            "/api/orgs/{org_id}/reports/overview",
            "/api/orgs/{org_id}/reports/activities",
            "/version",
        }

    def test_health_endpoints_are_tagged_for_grouping(self, client: TestClient) -> None:
        spec: dict[str, Any] = client.get("/openapi.json").json()

        assert spec["paths"]["/api/health"]["get"]["tags"] == ["health"]


class TestUserFacingLanguage:
    """The greeting text is Vietnamese — pinned on both sides of the stack.

    Changing it is a product decision, not a refactor: update
    ``frontend/tests/regression/api-contract.test.ts`` in the same commit.
    """

    def test_greeting_output_is_vietnamese(self, client: TestClient) -> None:
        payload: dict[str, Any] = client.get("/api/greeting", params={"name": "Lan"}).json()

        assert payload["message"] == "Xin chào, Lan!"

    def test_default_greeting_output_is_vietnamese(self, client: TestClient) -> None:
        payload: dict[str, Any] = client.get("/api/greeting").json()

        assert payload["message"] == "Xin chào, bạn!"


class TestErrorEnvelope:
    """The error body shape clients depend on."""

    def test_validation_errors_use_fastapis_detail_shape(self, client: TestClient) -> None:
        payload: dict[str, Any] = client.get("/api/greeting", params={"name": "x" * 81}).json()

        assert list(payload) == ["detail"]
        assert isinstance(payload["detail"], str)


class TestCertificateResponseContract:
    """The certificate download is a PDF attachment, never cached.

    Clients rely on the exact ``Content-Disposition`` filename pattern and
    the ``private, no-store`` cache directive — loosening either is a
    product decision, not a refactor.
    """

    def test_certificate_headers_are_stable(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _admin_user = auth_headers("cert-admin@example.edu", "correct-horse", "Quản trị")
        student, _student_user = auth_headers(
            "cert-student@example.edu", "correct-horse", "Sinh Viên"
        )
        org = db_client.post(
            "/api/orgs", headers=admin, json={"code": "CERT1", "name": "Đoàn trường"}
        ).json()["org"]
        membership = db_client.post(
            "/api/orgs/join", headers=student, json={"code": "CERT1"}
        ).json()["membership"]
        starts = datetime.now(UTC) + timedelta(days=1)
        activity = db_client.post(
            f"/api/orgs/{org['id']}/activities",
            headers=admin,
            json={
                "title": "Đợt tình nguyện",
                "starts_at": starts.isoformat(),
                "ends_at": (starts + timedelta(hours=2)).isoformat(),
            },
        ).json()["activity"]
        record = db_client.post(
            f"/api/orgs/{org['id']}/members/{membership['member_id']}/records",
            headers=admin,
            json={"title": "Đợt tình nguyện", "activity_id": activity["id"]},
        ).json()["record"]

        response = db_client.get(f"/api/records/{record['id']}/certificate", headers=student)

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert (
            response.headers["content-disposition"]
            == f'attachment; filename="chung-nhan-{record["id"]}.pdf"'
        )
        assert response.headers["cache-control"] == "private, no-store"
        assert response.content.startswith(b"%PDF")

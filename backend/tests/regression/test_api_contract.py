"""Regression tests: lock in behaviour that already works.

Every test here exists to answer one question — *"did my change break something
that used to work?"* — not to discover new behaviour. They assert exact shapes,
not just truthiness, and they are the first thing to run when triaging a bug.

Layer: **regression**
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.regression

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

        assert paths == {
            "/api/health",
            "/api/health/ready",
            "/api/greeting",
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

"""Integration tests: the real app, wired up, talked to over HTTP.

These prove the pieces are connected correctly — routing, dependency wiring,
the ``ValueError`` → 422 handler, and the lifespan. A failure here means two
components disagree, not that one unit is wrong.

Layer: **integration**
"""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


class TestHealthEndpoints:
    """Liveness and readiness, as a probe would call them."""

    def test_health_reports_ok(self, client: TestClient) -> None:
        response = client.get("/api/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_health_reports_the_configured_app_name(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        with build_client(app_name="AmigoAct Staging") as staging:
            response = staging.get("/api/health")

        assert response.json()["app"] == "AmigoAct Staging"

    def test_readiness_is_reported_after_startup(self, client: TestClient) -> None:
        response = client.get("/api/health/ready")

        assert response.status_code == 200
        assert response.json() == {"status": "ready"}


class TestGreetingEndpoint:
    """The HTTP surface of the domain logic, end to end."""

    def test_returns_a_greeting_for_a_valid_name(self, client: TestClient) -> None:
        response = client.get("/api/greeting", params={"name": "Lan"})

        assert response.status_code == 200
        assert response.json() == {"message": "Xin chào, Lan!"}

    def test_omitted_name_falls_back_to_the_default(self, client: TestClient) -> None:
        response = client.get("/api/greeting")

        assert response.json() == {"message": "Xin chào, bạn!"}

    def test_invalid_name_becomes_422_not_500(self, client: TestClient) -> None:
        """A domain ``ValueError`` must be translated by the registered handler."""
        response = client.get("/api/greeting", params={"name": "x" * 81})

        assert response.status_code == 422
        assert "at most 80 characters" in response.json()["detail"]


class TestRoutingAndMeta:
    """Cross-cutting wiring: mounted prefixes, docs, and error handling."""

    def test_routes_are_mounted_under_the_configured_prefix(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        with build_client(api_prefix="/v2") as v2:
            assert v2.get("/v2/health").status_code == 200
            assert v2.get("/api/health").status_code == 404

    def test_version_endpoint_is_not_under_the_api_prefix(self, client: TestClient) -> None:
        response = client.get("/version")

        assert response.status_code == 200
        assert "version" in response.json()

    @pytest.mark.parametrize("path", ["/openapi.json", "/docs"])
    def test_documentation_is_served(self, client: TestClient, path: str) -> None:
        assert client.get(path).status_code == 200

    def test_unknown_route_returns_a_404(self, client: TestClient) -> None:
        response = client.get("/api/definitely-not-a-route")

        assert response.status_code == 404

    def test_lifespan_sets_and_clears_application_state(self, app: FastAPI) -> None:
        with TestClient(app):
            assert app.state.ready is True
            assert app.state.settings is not None
        assert app.state.ready is False

    def test_cors_headers_appear_only_when_origins_are_configured(
        self, build_client: Callable[..., TestClient]
    ) -> None:
        with build_client(cors_origins='["http://localhost:3000"]') as cors_client:
            response = cors_client.get("/api/health", headers={"Origin": "http://localhost:3000"})

        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"

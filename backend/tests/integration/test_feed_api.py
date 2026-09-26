"""Integration tests for ``GET /me/feed`` — the cross-org upcoming list.

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


def _create_org(client: TestClient, headers: dict[str, str], code: str) -> Any:
    response = client.post("/api/orgs", headers=headers, json={"code": code, "name": "Club"})
    assert response.status_code == 201, response.text
    return response.json()["org"]


def _join(client: TestClient, headers: dict[str, str], code: str) -> None:
    response = client.post("/api/orgs/join", headers=headers, json={"code": code})
    assert response.status_code == 201, response.text


def _activity_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "title": "Hoạt động tình nguyện",
        "starts_at": (NOW + timedelta(minutes=30)).isoformat(),
        "ends_at": (NOW + timedelta(hours=4)).isoformat(),
    }
    body.update(overrides)
    return body


def _create_published(
    client: TestClient, headers: dict[str, str], org_id: str, **overrides: Any
) -> Any:
    created = client.post(
        f"/api/orgs/{org_id}/activities", headers=headers, json=_activity_body(**overrides)
    )
    assert created.status_code == 201, created.text
    activity = created.json()["activity"]
    published = client.post(f"/api/activities/{activity['id']}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return published.json()["activity"]


class TestFeed:
    """``GET /me/feed`` — upcoming/ongoing published activities across orgs."""

    def test_feed_lists_published_activity_with_registration_state(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, headers, "CLB1")
        member_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, member_headers, org["code"])
        activity = _create_published(db_client, headers, org["id"])
        draft = db_client.post(
            f"/api/orgs/{org['id']}/activities",
            headers=headers,
            json=_activity_body(title="Still a draft"),
        ).json()["activity"]

        feed = db_client.get("/api/me/feed", headers=member_headers).json()["activities"]
        assert [row["activity"]["id"] for row in feed] == [activity["id"]]
        assert draft["id"] not in {row["activity"]["id"] for row in feed}
        row = feed[0]
        assert set(row) == {"activity", "org", "my_registration_status", "registered"}
        assert row["my_registration_status"] is None
        assert row["registered"] == 0
        assert row["org"]["code"] == org["code"]

        registered = db_client.post(
            f"/api/activities/{activity['id']}/register", headers=member_headers, json={}
        )
        assert registered.status_code == 201, registered.text

        feed = db_client.get("/api/me/feed", headers=member_headers).json()["activities"]
        assert feed[0]["my_registration_status"] == "pending"
        assert feed[0]["registered"] == 1

    def test_feed_excludes_other_orgs_and_ended(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin_headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, admin_headers, "CLB1")
        other_admin, _ = auth_headers("other@example.edu", "correct-horse", "Other")
        other_org = _create_org(db_client, other_admin, "OTHER1")
        member_headers, _ = auth_headers("sv@example.edu", "correct-horse", "SV")
        _join(db_client, member_headers, org["code"])

        mine = _create_published(db_client, admin_headers, org["id"])
        ended = _create_published(db_client, admin_headers, org["id"], title="Long over")
        # Move its window into the past — published activities stay editable.
        db_client.patch(
            f"/api/activities/{ended['id']}",
            headers=admin_headers,
            json=_activity_body(
                title="Long over",
                starts_at=(NOW - timedelta(days=2)).isoformat(),
                ends_at=(NOW - timedelta(days=1)).isoformat(),
            ),
        )
        _create_published(db_client, other_admin, other_org["id"])

        feed = db_client.get("/api/me/feed", headers=member_headers).json()["activities"]
        ids = {row["activity"]["id"] for row in feed}
        assert ids == {mine["id"]}  # ended + foreign org both excluded

    def test_feed_is_empty_without_membership(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin_headers, _ = auth_headers("admin@example.edu", "correct-horse", "Admin")
        org = _create_org(db_client, admin_headers, "CLB1")
        _create_published(db_client, admin_headers, org["id"])
        outsider, _ = auth_headers("out@example.edu", "correct-horse", "Out")

        feed = db_client.get("/api/me/feed", headers=outsider).json()["activities"]

        assert feed == []

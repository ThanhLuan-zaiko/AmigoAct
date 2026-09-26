"""Integration tests for the manager reporting endpoints.

The scenario runs the full lifecycle over HTTP — org, two members with
faculties, three activities in different states, registrations, a manager
check-in, a completion (which mints a record), and a manual record — then
asserts every aggregate is folded from those real rows.

Layer: **integration**
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

NOW = datetime.now(UTC)
# Records' awarded_on and all date filters are business-tz aligned.
TODAY = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date()

TOTALS_KEYS = {
    "activities",
    "published",
    "completed",
    "cancelled",
    "registrations",
    "approved",
    "checked_in",
    "checkin_rate",
    "total_hours",
    "total_points",
}
ACTIVITY_ROW_KEYS = {
    "id",
    "title",
    "starts_at",
    "ends_at",
    "status",
    "capacity",
    "registered",
    "approved",
    "checked_in",
    "hours_awarded",
    "points_awarded",
}


def _new_activity(
    client: TestClient,
    headers: dict[str, str],
    org_id: str,
    *,
    title: str,
    starts: datetime,
    hours: str = "0",
    points: str = "0",
) -> Any:
    """Create a draft activity; returns the activity payload."""
    response = client.post(
        f"/api/orgs/{org_id}/activities",
        headers=headers,
        json={
            "title": title,
            "hours": hours,
            "points": points,
            "starts_at": starts.isoformat(),
            "ends_at": (starts + timedelta(hours=4)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["activity"]


def _setup_scenario(client: TestClient, auth_headers: RegisterFn) -> dict[str, Any]:
    """Build the full seeded org; returns every handle the tests assert on."""
    admin, _au = auth_headers("adm-rep@example.edu", "correct-horse", "Quản trị")
    sv1, _s1 = auth_headers("sv1-rep@example.edu", "correct-horse", "Sinh Viên Một")
    sv2, _s2 = auth_headers("sv2-rep@example.edu", "correct-horse", "Sinh Viên Hai")

    org = client.post(
        "/api/orgs", headers=admin, json={"code": "REP1", "name": "Đoàn Báo cáo"}
    ).json()["org"]
    m1 = client.post(
        "/api/orgs/join", headers=sv1, json={"code": "REP1", "faculty": "CNTT"}
    ).json()["membership"]
    m2 = client.post("/api/orgs/join", headers=sv2, json={"code": "REP1", "faculty": "CK"}).json()[
        "membership"
    ]

    # activity1: published → registrations → approve+checkin → complete.
    a1 = _new_activity(
        client,
        admin,
        org["id"],
        title="Hiến máu",
        starts=NOW + timedelta(minutes=30),
        hours="4",
        points="8",
    )
    client.post(f"/api/activities/{a1['id']}/publish", headers=admin)
    reg1 = client.post(f"/api/activities/{a1['id']}/register", headers=sv1, json={}).json()[
        "registration"
    ]
    reg2 = client.post(f"/api/activities/{a1['id']}/register", headers=sv2, json={}).json()[
        "registration"
    ]
    client.post(
        f"/api/registrations/{reg2['id']}/review", headers=admin, json={"action": "approve"}
    )
    client.post(f"/api/registrations/{reg2['id']}/checkin", headers=admin)
    # Complete needs a started activity — move the start into the past.
    client.patch(
        f"/api/activities/{a1['id']}",
        headers=admin,
        json={
            "title": "Hiến máu",
            "hours": "4",
            "points": "8",
            "starts_at": (NOW - timedelta(minutes=10)).isoformat(),
            "ends_at": (NOW + timedelta(hours=3)).isoformat(),
        },
    )
    client.post(f"/api/activities/{a1['id']}/complete", headers=admin)

    # activity2: published then cancelled. activity3: stays a draft.
    a2 = _new_activity(client, admin, org["id"], title="Bãi biển", starts=NOW + timedelta(days=2))
    client.post(f"/api/activities/{a2['id']}/publish", headers=admin)
    client.post(f"/api/activities/{a2['id']}/cancel", headers=admin)
    a3 = _new_activity(client, admin, org["id"], title="Nháp", starts=NOW + timedelta(days=3))

    # One manual standalone record for member 1.
    client.post(
        f"/api/orgs/{org['id']}/members/{m1['member_id']}/records",
        headers=admin,
        json={"title": "Hoạt động ngoài", "hours": "5", "points": "10"},
    )

    return {
        "admin": admin,
        "sv1": sv1,
        "sv2": sv2,
        "org": org,
        "m1": m1,
        "m2": m2,
        "a1": a1,
        "a2": a2,
        "a3": a3,
        "reg1": reg1,
        "reg2": reg2,
    }


class TestOverview:
    def test_totals_fold_real_rows(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        ctx = _setup_scenario(db_client, auth_headers)

        response = db_client.get(
            f"/api/orgs/{ctx['org']['id']}/reports/overview", headers=ctx["admin"]
        )

        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"totals", "monthly", "by_faculty", "top_volunteers"}
        totals = payload["totals"]
        assert set(totals) == TOTALS_KEYS
        assert totals["activities"] == 3
        assert totals["published"] == 0
        assert totals["completed"] == 1
        assert totals["cancelled"] == 1
        assert totals["registrations"] == 2
        assert totals["approved"] == 1
        assert totals["checked_in"] == 1
        assert totals["checkin_rate"] == 1.0
        # 4h from the completed activity + 5h manual; points likewise.
        assert totals["total_hours"] == "9"
        assert totals["total_points"] == "18"

    def test_monthly_faculty_and_top_volunteers(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        ctx = _setup_scenario(db_client, auth_headers)

        payload = db_client.get(
            f"/api/orgs/{ctx['org']['id']}/reports/overview", headers=ctx["admin"]
        ).json()

        month_rows = [b for b in payload["monthly"] if b["month"] == TODAY.strftime("%Y-%m")]
        assert len(month_rows) == 1
        bucket = month_rows[0]
        assert bucket["activities"] == 3
        assert bucket["registrations"] == 2
        assert bucket["hours"] == "9"

        faculties = {row["faculty"]: row for row in payload["by_faculty"]}
        assert set(faculties) == {"CNTT", "CK"}
        assert faculties["CNTT"]["members"] == 1
        assert faculties["CNTT"]["hours"] == "5"
        assert faculties["CNTT"]["points"] == "10"
        assert faculties["CK"]["hours"] == "4"

        top = payload["top_volunteers"]
        assert [v["member_id"] for v in top] == [
            ctx["m1"]["member_id"],
            ctx["m2"]["member_id"],
        ]
        assert top[0]["full_name"] == "Sinh Viên Một"
        assert top[0]["record_count"] == 1
        assert set(top[0]) == {
            "member_id",
            "full_name",
            "student_code",
            "faculty",
            "hours",
            "points",
            "record_count",
        }

    def test_empty_org_is_honest_zeros(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, _au = auth_headers("zero-rep@example.edu", "correct-horse", "Zero")
        org = db_client.post(
            "/api/orgs", headers=admin, json={"code": "ZERO1", "name": "Zero Org"}
        ).json()["org"]

        payload = db_client.get(f"/api/orgs/{org['id']}/reports/overview", headers=admin).json()

        assert payload["totals"] == {
            "activities": 0,
            "published": 0,
            "completed": 0,
            "cancelled": 0,
            "registrations": 0,
            "approved": 0,
            "checked_in": 0,
            "checkin_rate": 0.0,
            "total_hours": "0",
            "total_points": "0",
        }
        assert payload["monthly"] == []
        assert payload["by_faculty"] == []
        assert payload["top_volunteers"] == []

    def test_date_range_narrows_results(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        ctx = _setup_scenario(db_client, auth_headers)
        org_id = ctx["org"]["id"]

        far_future = db_client.get(
            f"/api/orgs/{org_id}/reports/overview",
            headers=ctx["admin"],
            params={
                "from": (TODAY + timedelta(days=60)).isoformat(),
                "to": (TODAY + timedelta(days=90)).isoformat(),
            },
        ).json()
        # a2 starts +2d and a3 +3d — outside the 60-90d window; records
        # awarded today are filtered out by awarded_on >= from.
        assert far_future["totals"]["activities"] == 0
        assert far_future["totals"]["total_hours"] == "0"
        assert far_future["monthly"] == []

        this_week = db_client.get(
            f"/api/orgs/{org_id}/reports/overview",
            headers=ctx["admin"],
            params={
                "from": (TODAY - timedelta(days=1)).isoformat(),
                "to": (TODAY + timedelta(days=1)).isoformat(),
            },
        ).json()
        # Only a1 (started today) and today's records survive the window.
        assert this_week["totals"]["activities"] == 1
        assert this_week["totals"]["registrations"] == 2
        assert this_week["totals"]["total_hours"] == "9"

    def test_member_cannot_read_reports(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        ctx = _setup_scenario(db_client, auth_headers)
        org_id = ctx["org"]["id"]

        for path in ("overview", "activities"):
            response = db_client.get(f"/api/orgs/{org_id}/reports/{path}", headers=ctx["sv1"])
            assert response.status_code == 403
            assert response.json()["code"] == "insufficient_role"

    def test_outsider_is_not_a_member(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        ctx = _setup_scenario(db_client, auth_headers)
        outsider, _ou = auth_headers("out-rep@example.edu", "correct-horse", "Out")

        response = db_client.get(f"/api/orgs/{ctx['org']['id']}/reports/overview", headers=outsider)

        assert response.status_code == 403
        assert response.json()["code"] == "not_a_member"


class TestActivitiesReport:
    def test_per_activity_funnel(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        ctx = _setup_scenario(db_client, auth_headers)

        response = db_client.get(
            f"/api/orgs/{ctx['org']['id']}/reports/activities", headers=ctx["admin"]
        )

        assert response.status_code == 200
        rows = response.json()["activities"]
        assert len(rows) == 3
        # Ordered by starts_at desc: a3 (+3d), a2 (+2d), a1 (today).
        assert [r["title"] for r in rows] == ["Nháp", "Bãi biển", "Hiến máu"]
        assert set(rows[0]) == ACTIVITY_ROW_KEYS

        a1_row = rows[2]
        assert a1_row["id"] == ctx["a1"]["id"]
        assert a1_row["status"] == "completed"
        assert a1_row["registered"] == 2  # pending + approved hold seats
        assert a1_row["approved"] == 1
        assert a1_row["checked_in"] == 1
        assert a1_row["hours_awarded"] == "4"
        assert a1_row["points_awarded"] == "8"

        assert rows[0]["status"] == "draft"
        assert rows[0]["registered"] == 0
        assert rows[0]["hours_awarded"] == "0"

    def test_date_range_excludes_activities(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        ctx = _setup_scenario(db_client, auth_headers)

        payload = db_client.get(
            f"/api/orgs/{ctx['org']['id']}/reports/activities",
            headers=ctx["admin"],
            params={
                "from": (TODAY + timedelta(days=1)).isoformat(),
                "to": (TODAY + timedelta(days=2, hours=12)).isoformat(),
            },
        ).json()

        # Only a2 (+2d) starts inside the window; a1 is past, a3 (+3d) after.
        assert [r["title"] for r in payload["activities"]] == ["Bãi biển"]

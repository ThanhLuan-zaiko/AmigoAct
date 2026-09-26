"""Integration tests for the participation-certificate download.

``GET /records/{id}/certificate`` streams a PDF built entirely from the
record's own rows — these tests pin the headers and check the extracted
text really carries the org, member, and verification code.

Layer: **integration**
"""

from __future__ import annotations

import re
from collections.abc import Callable
from io import BytesIO
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

pytestmark = pytest.mark.integration

RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]


def _setup(
    client: TestClient, auth_headers: RegisterFn
) -> tuple[dict[str, str], dict[str, str], Any, Any]:
    """Org with admin + member; returns the handles tests need."""
    admin, _au = auth_headers("adm-cert@example.edu", "correct-horse", "Quản trị")
    student, _su = auth_headers("sv-cert@example.edu", "correct-horse", "Trần Thị Bích")
    org = client.post(
        "/api/orgs",
        headers=admin,
        json={"code": "CERT1", "name": "CLB Tình nguyện Áo Xanh"},
    ).json()["org"]
    membership = client.post(
        "/api/orgs/join",
        headers=student,
        json={"code": "CERT1", "student_code": "SV777", "class_name": "K66-CA2"},
    ).json()["membership"]
    return admin, student, org, membership


def _record(client: TestClient, headers: dict[str, str], org_id: str, member_id: str) -> str:
    """Create a manual record and return its id."""
    response = client.post(
        f"/api/orgs/{org_id}/members/{member_id}/records",
        headers=headers,
        json={
            "title": "Chiến dịch mùa hè xanh",
            "hours": "6",
            "points": "12",
        },
    )
    assert response.status_code == 201, response.text
    record_id: str = response.json()["record"]["id"]
    return record_id


class TestCertificateAccess:
    def test_owner_downloads_pdf(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, student, org, membership = _setup(db_client, auth_headers)
        record_id = _record(db_client, admin, org["id"], membership["member_id"])

        response = db_client.get(f"/api/records/{record_id}/certificate", headers=student)

        assert response.status_code == 200
        assert response.content[:4] == b"%PDF"
        assert response.headers["content-type"].startswith("application/pdf")
        disposition = response.headers["content-disposition"]
        assert disposition.startswith("attachment;")
        assert f'filename="chung-nhan-{record_id}.pdf"' in disposition
        assert response.headers["cache-control"] == "private, no-store"

    def test_staff_downloads_pdf(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, _student, org, membership = _setup(db_client, auth_headers)
        record_id = _record(db_client, admin, org["id"], membership["member_id"])

        response = db_client.get(f"/api/records/{record_id}/certificate", headers=admin)

        assert response.status_code == 200
        assert response.content[:4] == b"%PDF"

    def test_other_member_is_denied(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, _student, org, membership = _setup(db_client, auth_headers)
        record_id = _record(db_client, admin, org["id"], membership["member_id"])
        other, _ou = auth_headers("o-cert@example.edu", "correct-horse", "Other")
        db_client.post("/api/orgs/join", headers=other, json={"code": "CERT1"})

        response = db_client.get(f"/api/records/{record_id}/certificate", headers=other)

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_outsider_is_denied(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        admin, _student, org, membership = _setup(db_client, auth_headers)
        record_id = _record(db_client, admin, org["id"], membership["member_id"])
        outsider, _ou = auth_headers("out-cert@example.edu", "correct-horse", "Out")

        response = db_client.get(f"/api/records/{record_id}/certificate", headers=outsider)

        assert response.status_code == 403
        assert response.json()["code"] == "insufficient_role"

    def test_missing_record_is_404(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        _admin, student, _org, _membership = _setup(db_client, auth_headers)

        response = db_client.get(
            "/api/records/00000000-0000-0000-0000-000000000099/certificate",
            headers=student,
        )

        assert response.status_code == 404
        assert response.json()["code"] == "record_not_found"

    def test_unauthenticated_is_401(self, db_client: TestClient) -> None:
        response = db_client.get("/api/records/00000000-0000-0000-0000-000000000099/certificate")

        assert response.status_code == 401


class TestCertificateContent:
    def test_extracted_text_carries_real_data(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, org, membership = _setup(db_client, auth_headers)
        record_id = _record(db_client, admin, org["id"], membership["member_id"])

        body = db_client.get(f"/api/records/{record_id}/certificate", headers=student).content

        # fpdf2 embeds a ToUnicode CMap for the TTF subset, so text
        # extraction is reliable for the Vietnamese labels.
        text = PdfReader(BytesIO(body)).pages[0].extract_text()
        assert "CHỨNG NHẬN" in text
        assert org["name"] in text
        assert "Trần Thị Bích" in text
        assert "Chiến dịch mùa hè xanh" in text
        assert record_id in text
        assert "SV777" in text
        # Decimal "6" → "6", never "6.0E0" scientific noise.
        assert "Số giờ tình nguyện: 6" in text
        assert re.search(r"Ngày cấp: \d{2}/\d{2}/\d{4}", text)

    def test_participation_record_omits_hours_line(
        self, db_client: TestClient, auth_headers: RegisterFn
    ) -> None:
        admin, student, org, membership = _setup(db_client, auth_headers)
        created = db_client.post(
            f"/api/orgs/{org['id']}/members/{membership['member_id']}/records",
            headers=admin,
            json={"title": "Tham dự hội thảo", "points": "2"},
        )
        record_id = created.json()["record"]["id"]

        body = db_client.get(f"/api/records/{record_id}/certificate", headers=student).content
        text = PdfReader(BytesIO(body)).pages[0].extract_text()

        # hours=None → no fabricated "0 giờ"; only the points line shows.
        assert "Số giờ tình nguyện" not in text
        assert "Số điểm: 2" in text

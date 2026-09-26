"""Integration tests for the ``/api/auth/*`` endpoints.

Real app over ``TestClient``, real argon2id hashing (cheap parameters via
the conftest), and a real SQLite database carrying the ORM schema. Exact
error bodies ``{"detail", "code"}`` are asserted — they are the client
contract.

Layer: **integration**
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from backend.db.models import Organization, OrgMember
from backend.domain.ids import new_id

pytestmark = pytest.mark.integration

SessionFactory = async_sessionmaker[AsyncSession]
RegisterFn = Callable[[str, str, str], tuple[dict[str, str], dict[str, Any]]]

AUTH = "/api/auth"
USER_KEYS = {"id", "email", "full_name", "phone", "is_active", "created_at"}
AUTH_KEYS = {"access_token", "token_type", "user"}
MEMBERSHIP_KEYS = {
    "member_id",
    "org_id",
    "role",
    "status",
    "student_code",
    "class_name",
    "faculty",
    "joined_at",
    "org",
}


def _register(db_client: TestClient, **overrides: str) -> Any:
    body = {
        "email": "lan@example.edu",
        "password": "correct-horse-battery",
        "full_name": "Nguyễn Lan",
        **overrides,
    }
    return db_client.post(f"{AUTH}/register", json=body)


def _add_membership(
    maker: SessionFactory,
    *,
    user_id: str,
    org_code: str,
    member_name: str,
    student_code: str | None = None,
) -> None:
    """Insert an org + linked roster row for the registered user."""

    async def _insert() -> None:
        async with maker() as session:
            # Ids are minted explicitly: column defaults fire at INSERT
            # time, not at construction.
            org = Organization(id=new_id(), code=org_code, name=f"Org {org_code}")
            member = OrgMember(
                id=new_id(),
                org_id=org.id,
                user_id=uuid.UUID(user_id),
                full_name=member_name,
                student_code=student_code,
            )
            session.add_all([org, member])
            await session.commit()

    asyncio.run(_insert())


class TestRegister:
    """POST /api/auth/register."""

    def test_success_returns_token_and_user(self, db_client: TestClient) -> None:
        response = _register(db_client)

        assert response.status_code == 201
        payload = response.json()
        assert set(payload) == AUTH_KEYS
        assert payload["token_type"] == "bearer"
        assert set(payload["user"]) == USER_KEYS
        user = payload["user"]
        assert user["email"] == "lan@example.edu"
        assert user["full_name"] == "Nguyễn Lan"
        assert user["phone"] is None
        assert user["is_active"] is True
        assert uuid.UUID(user["id"]).version == 7

        # The issued token actually authenticates.
        me = db_client.get(
            f"{AUTH}/me",
            headers={"Authorization": f"Bearer {payload['access_token']}"},
        )
        assert me.status_code == 200
        assert me.json()["user"]["id"] == user["id"]

    def test_email_is_normalized(self, db_client: TestClient) -> None:
        response = _register(db_client, email="  LAN@Example.EDU ")

        assert response.status_code == 201
        assert response.json()["user"]["email"] == "lan@example.edu"

    def test_duplicate_email_conflict(self, db_client: TestClient) -> None:
        assert _register(db_client).status_code == 201

        response = _register(db_client)  # same email again

        assert response.status_code == 409
        assert response.json() == {
            "detail": "email already registered",
            "code": "email_taken",
        }

    def test_invalid_email_is_422_with_code(self, db_client: TestClient) -> None:
        response = _register(db_client, email="not-an-email")

        assert response.status_code == 422
        assert response.json()["code"] == "invalid_email"

    def test_short_password_is_422_with_code(self, db_client: TestClient) -> None:
        response = _register(db_client, password="short")

        assert response.status_code == 422
        assert response.json()["code"] == "password_too_short"

    def test_blank_name_is_422_with_code(self, db_client: TestClient) -> None:
        response = _register(db_client, full_name="   ")

        assert response.status_code == 422
        assert response.json()["code"] == "invalid_name"


class TestLogin:
    """POST /api/auth/login."""

    def test_login_returns_token(self, db_client: TestClient) -> None:
        _register(db_client)

        response = db_client.post(
            f"{AUTH}/login",
            json={"email": "lan@example.edu", "password": "correct-horse-battery"},
        )

        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == AUTH_KEYS
        assert payload["user"]["email"] == "lan@example.edu"

    def test_wrong_password_is_401(self, db_client: TestClient) -> None:
        _register(db_client)

        response = db_client.post(
            f"{AUTH}/login",
            json={"email": "lan@example.edu", "password": "wrong-password"},
        )

        assert response.status_code == 401
        assert response.json()["code"] == "invalid_credentials"
        assert response.headers.get("WWW-Authenticate") == "Bearer"

    def test_unknown_email_is_401_same_code(self, db_client: TestClient) -> None:
        response = db_client.post(
            f"{AUTH}/login",
            json={"email": "ghost@example.edu", "password": "whatever-password"},
        )

        # Same code as a wrong password — no user enumeration.
        assert response.status_code == 401
        assert response.json()["code"] == "invalid_credentials"


class TestMe:
    """GET /api/auth/me."""

    def test_missing_token_is_401_with_challenge(self, db_client: TestClient) -> None:
        response = db_client.get(f"{AUTH}/me")

        assert response.status_code == 401
        assert response.json()["code"] == "missing_token"
        assert response.headers.get("WWW-Authenticate") == "Bearer"

    def test_garbage_token_is_401(self, db_client: TestClient) -> None:
        response = db_client.get(f"{AUTH}/me", headers={"Authorization": "Bearer not-a-jwt"})

        assert response.status_code == 401
        assert response.json()["code"] == "token_invalid"

    def test_malformed_header_is_missing_token(self, db_client: TestClient) -> None:
        response = db_client.get(f"{AUTH}/me", headers={"Authorization": "Token abc"})

        assert response.status_code == 401
        assert response.json()["code"] == "missing_token"

    def test_me_returns_memberships(
        self,
        db_client: TestClient,
        db_sessionmaker: SessionFactory,
        auth_headers: RegisterFn,
    ) -> None:
        headers, user = auth_headers("lan@example.edu", "correct-horse-battery", "Lan")
        _add_membership(
            db_sessionmaker,
            user_id=user["id"],
            org_code="CLB-A",
            member_name="Nguyễn Lan",
            student_code="SV001",
        )
        _add_membership(
            db_sessionmaker,
            user_id=user["id"],
            org_code="CLB-B",
            member_name="Lan Nguyen",
        )

        response = db_client.get(f"{AUTH}/me", headers=headers)

        assert response.status_code == 200
        payload = response.json()
        assert set(payload) == {"user", "memberships"}
        assert set(payload["user"]) == USER_KEYS

        memberships = payload["memberships"]
        assert len(memberships) == 2
        # Sorted by org code.
        assert [m["org"]["code"] for m in memberships] == ["CLB-A", "CLB-B"]
        first = memberships[0]
        assert set(first) == MEMBERSHIP_KEYS
        assert first["role"] == "member"
        assert first["status"] == "active"
        assert first["student_code"] == "SV001"
        assert set(first["org"]) == {"id", "code", "name"}
        assert first["org"]["name"] == "Org CLB-A"

    def test_me_with_no_memberships(self, db_client: TestClient, auth_headers: RegisterFn) -> None:
        headers, _user = auth_headers("solo@example.edu", "correct-horse-battery", "Solo")

        response = db_client.get(f"{AUTH}/me", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"user": response.json()["user"], "memberships": []}
        assert response.json()["user"]["email"] == "solo@example.edu"

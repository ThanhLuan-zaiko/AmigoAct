"""Unit tests for ``security`` — argon2id hashing and JWT issue/verify.

Layer: **unit**
"""

from __future__ import annotations

from typing import Any

import jwt.exceptions
import pytest
from argon2 import PasswordHasher
from argon2.low_level import Type

from backend.config import Settings
from backend.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    password_needs_rehash,
    verify_password,
)

pytestmark = pytest.mark.unit

SECRET = "unit-test-secret-that-is-long-enough"


def _settings(**overrides: Any) -> Settings:
    return Settings(**{"jwt_secret": SECRET, **overrides})


class TestPasswordHashing:
    """Passwords are hashed with argon2id and nothing else."""

    def test_hash_uses_argon2id_encoding(self) -> None:
        assert hash_password("correct horse battery staple").startswith("$argon2id$")

    def test_verify_accepts_the_right_password(self) -> None:
        password_hash = hash_password("s3cure!")

        assert verify_password(password_hash, "s3cure!") is True

    def test_verify_rejects_a_wrong_password(self) -> None:
        password_hash = hash_password("s3cure!")

        assert verify_password(password_hash, "wrong") is False

    def test_verify_rejects_a_malformed_hash(self) -> None:
        assert verify_password("not-a-hash", "whatever") is False

    def test_fresh_hash_does_not_need_rehash(self) -> None:
        assert password_needs_rehash(hash_password("s3cure!")) is False

    def test_weaker_hash_needs_rehash(self) -> None:
        weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1, type=Type.ID).hash(
            "s3cure!"
        )

        assert password_needs_rehash(weak) is True


class TestAccessToken:
    """JWTs are signed with the configured secret and validated strictly."""

    def test_roundtrip_returns_subject_and_claims(self) -> None:
        token = create_access_token("user-uuid-7", _settings(), claims={"role": "member"})

        claims = decode_access_token(token, _settings())

        assert claims["sub"] == "user-uuid-7"
        assert claims["iss"] == "amigoact"
        assert claims["role"] == "member"
        assert claims["exp"] > claims["iat"]

    def test_expired_token_is_rejected(self) -> None:
        token = create_access_token("sub", _settings(jwt_ttl_seconds=-10))

        with pytest.raises(jwt.exceptions.ExpiredSignatureError):
            decode_access_token(token, _settings())

    def test_wrong_secret_is_rejected(self) -> None:
        token = create_access_token("sub", _settings())

        with pytest.raises(jwt.exceptions.InvalidTokenError):
            decode_access_token(token, _settings(jwt_secret="a-different-secret-past-32-bytes"))

    def test_wrong_issuer_is_rejected(self) -> None:
        token = create_access_token("sub", _settings())

        with pytest.raises(jwt.exceptions.InvalidTokenError):
            decode_access_token(token, _settings(jwt_issuer="someone-else"))

    def test_reserved_claims_cannot_be_overridden(self) -> None:
        token = create_access_token("real-sub", _settings(), claims={"sub": "forged"})

        assert decode_access_token(token, _settings())["sub"] == "real-sub"

    def test_missing_secret_fails_loudly(self) -> None:
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            create_access_token("sub", Settings(jwt_secret=""))

        token = create_access_token("sub", _settings())
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            decode_access_token(token, Settings(jwt_secret=""))

"""Unit tests for the pure account field rules in ``domain.accounts``.

Layer: **unit**
"""

from __future__ import annotations

import pytest

from backend.domain.accounts import (
    normalize_email,
    normalize_full_name,
    validate_password,
)
from backend.domain.errors import RuleViolationError

pytestmark = pytest.mark.unit


class TestNormalizeEmail:
    """Emails are stripped, lowercased, and shape-checked."""

    def test_strips_and_lowercases(self) -> None:
        assert normalize_email("  Lan.NGUYEN@Example.EDU  ") == "lan.nguyen@example.edu"

    def test_accepts_boundary_lengths(self) -> None:
        local = "a" * 64
        domain = "b" * 251 + ".edu"  # 255-char domain
        assert normalize_email(f"{local}@{domain}") == f"{local}@{domain}"

    @pytest.mark.parametrize(
        "raw",
        [
            "",
            "   ",
            "no-at-sign",
            "@nodomain.com",
            "two@@at.com",
            "lan @example.com",  # inner whitespace
            "a" * 65 + "@example.com",  # local part > 64
            "a@" + "b" * 256,  # domain > 255
            "a@" + "b" * 317,  # total > 320
        ],
    )
    def test_rejects_bad_shapes_with_invalid_email_code(self, raw: str) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            normalize_email(raw)

        assert excinfo.value.code == "invalid_email"

    def test_total_length_boundary(self) -> None:
        # local 64 + @ + domain 255 = exactly 320 -> ok
        ok = "a" * 64 + "@" + "b" * 255
        assert normalize_email(ok) == ok

        too_long = "a" * 64 + "@" + "b" * 256
        with pytest.raises(RuleViolationError):
            normalize_email(too_long)


class TestValidatePassword:
    """Password bounds are 8..128 characters, content untouched."""

    @pytest.mark.parametrize("length", [8, 64, 128])
    def test_accepts_in_range(self, length: int) -> None:
        password = "x" * length

        assert validate_password(password) == password

    def test_rejects_short_with_code(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            validate_password("x" * 7)

        assert excinfo.value.code == "password_too_short"

    def test_rejects_long_with_code(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            validate_password("x" * 129)

        assert excinfo.value.code == "password_too_long"

    def test_does_not_normalize_content(self) -> None:
        password = "  Spaced Pass 123  "

        assert validate_password(password) == password


class TestNormalizeFullName:
    """Display names are whitespace-collapsed and bounded at 120."""

    def test_collapses_whitespace(self) -> None:
        assert normalize_full_name("  Nguyễn   Văn \n An  ") == "Nguyễn Văn An"

    def test_accepts_boundary_length(self) -> None:
        assert normalize_full_name("a" * 120) == "a" * 120

    @pytest.mark.parametrize("raw", ["", "   ", "a" * 121])
    def test_rejects_unusable_names_with_code(self, raw: str) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            normalize_full_name(raw)

        assert excinfo.value.code == "invalid_name"

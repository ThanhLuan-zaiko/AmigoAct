"""Unit tests for org/roster field rules in ``domain.organizations``.

Layer: **unit**
"""

from __future__ import annotations

import pytest

from backend.domain import organizations as rules
from backend.domain.errors import RuleViolationError

pytestmark = pytest.mark.unit


class TestOrgCode:
    """``normalize_org_code``: upper+strip, then the [A-Z0-9]{3,32} pattern."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("CLB-A123".replace("-", ""), "CLBA123"),  # letters+digits kept
            ("  abc123  ", "ABC123"),  # strip + uppercase
            ("XYZ", "XYZ"),  # minimum length
            ("A" * 32, "A" * 32),  # maximum length
        ],
    )
    def test_valid_codes(self, raw: str, expected: str) -> None:
        assert rules.normalize_org_code(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "AB",  # too short
            "A" * 33,  # too long
            "CLB-A",  # hyphen not allowed
            "CLB A1",  # inner space survives strip → invalid
            "đoàn",  # non-ASCII
            "   ",  # blank
        ],
    )
    def test_invalid_codes_raise_invalid_org_code(self, raw: str) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_org_code(raw)
        assert excinfo.value.code == "invalid_org_code"


class TestOrgName:
    """``normalize_org_name``: whitespace-collapsed, 1..200 chars."""

    def test_collapses_whitespace(self) -> None:
        assert rules.normalize_org_name("  CLB   \n Tình  Nguyện ") == "CLB Tình Nguyện"

    def test_blank_is_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_org_name("   ")
        assert excinfo.value.code == "invalid_org_name"

    def test_too_long_is_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_org_name("x" * 201)
        assert excinfo.value.code == "invalid_org_name"


class TestNormalizeOptional:
    """``normalize_optional``: collapse → None-if-blank → length bound."""

    def test_none_and_blank_map_to_none(self) -> None:
        assert rules.normalize_optional(None, 10) is None
        assert rules.normalize_optional("   ", 10) is None
        assert rules.normalize_optional(" \t\n ", 10) is None

    def test_collapses_inner_whitespace(self) -> None:
        assert rules.normalize_optional("  a   b ", 10) == "a b"

    def test_over_length_raises(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_optional("x" * 11, 10, field="description")
        assert excinfo.value.code == "value_too_long"


class TestOrgDescriptionAndEmail:
    """Description ≤2000; contact email reuses the account email rule."""

    def test_description_bounds(self) -> None:
        assert rules.normalize_org_description(None) is None
        assert rules.normalize_org_description("  ") is None
        assert rules.normalize_org_description("x" * 2000) == "x" * 2000
        with pytest.raises(RuleViolationError):
            rules.normalize_org_description("x" * 2001)

    def test_contact_email(self) -> None:
        assert rules.normalize_contact_email(None) is None
        assert rules.normalize_contact_email("   ") is None
        assert rules.normalize_contact_email("  A@Edu.VN ") == "a@edu.vn"
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_contact_email("not-an-email")
        assert excinfo.value.code == "invalid_email"


class TestRanks:
    """``rank``/``is_manager`` over the ordered role set."""

    def test_rank_order(self) -> None:
        assert rules.rank("member") < rules.rank("manager") < rules.rank("admin")

    def test_unknown_role_raises(self) -> None:
        with pytest.raises(KeyError):
            rules.rank("superuser")

    def test_is_manager(self) -> None:
        assert rules.is_manager("member") is False
        assert rules.is_manager("manager") is True
        assert rules.is_manager("admin") is True


class TestMemberFields:
    """Roster field normalizers: blank → None, case preserved."""

    def test_student_code_keeps_case(self) -> None:
        assert rules.normalize_student_code("  sv001 ") == "sv001"
        assert rules.normalize_student_code(None) is None
        assert rules.normalize_student_code("  ") is None

    def test_student_code_length(self) -> None:
        assert rules.normalize_student_code("s" * 32) == "s" * 32
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_student_code("s" * 33)
        assert excinfo.value.code == "value_too_long"

    def test_class_name(self) -> None:
        assert rules.normalize_class_name("  CNTT  2024 ") == "CNTT 2024"
        assert rules.normalize_class_name("c" * 64) == "c" * 64
        with pytest.raises(RuleViolationError):
            rules.normalize_class_name("c" * 65)

    def test_faculty(self) -> None:
        assert rules.normalize_faculty("Khoa CNTT") == "Khoa CNTT"
        with pytest.raises(RuleViolationError):
            rules.normalize_faculty("f" * 121)

    def test_member_name_reuses_full_name_rule(self) -> None:
        assert rules.normalize_member_name("  Nguyễn   Lan ") == "Nguyễn Lan"
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_member_name("   ")
        assert excinfo.value.code == "invalid_name"

"""Unit tests for check-in code generation/validation in ``domain.checkin``.

Layer: **unit**
"""

from __future__ import annotations

import pytest

from backend.domain import checkin
from backend.domain.errors import RuleViolationError

pytestmark = pytest.mark.unit


class TestGenerateCode:
    """Codes are exactly 6 glyphs from the unambiguous alphabet."""

    def test_length_and_alphabet(self) -> None:
        code = checkin.generate_checkin_code()
        assert len(code) == checkin.CHECKIN_CODE_LENGTH
        assert set(code) <= set(checkin.CHECKIN_CODE_ALPHABET)

    def test_alphabet_drops_ambiguous_glyphs(self) -> None:
        for bad in ("0", "O", "1", "I", "L"):
            assert bad not in checkin.CHECKIN_CODE_ALPHABET
        assert len(checkin.CHECKIN_CODE_ALPHABET) == 31

    def test_injected_rng_is_used(self) -> None:
        code = checkin.generate_checkin_code(rng=lambda seq: seq[0])
        assert code == "A" * checkin.CHECKIN_CODE_LENGTH


class TestNormalizeCode:
    """normalize_checkin_code: strip+upper, charset, exact length."""

    def test_lowercase_input_normalizes(self) -> None:
        assert checkin.normalize_checkin_code("  abcdef ") == "ABCDEF"

    def test_wrong_length_rejected(self) -> None:
        for bad in ("ABCDE", "ABCDEFG", ""):
            with pytest.raises(RuleViolationError) as excinfo:
                checkin.normalize_checkin_code(bad)
            assert excinfo.value.code == "invalid_code"

    def test_alphabet_violation_rejected(self) -> None:
        for bad in ("ABCDEF0", "ABC1EF", "O23ABC", "ABCDE!", "abc def"):
            with pytest.raises(RuleViolationError) as excinfo:
                checkin.normalize_checkin_code(bad)
            assert excinfo.value.code == "invalid_code"

    def test_valid_code_passes(self) -> None:
        assert checkin.normalize_checkin_code("AB2C3D") == "AB2C3D"


class TestCodesMatch:
    """codes_match is constant-time and None-safe."""

    def test_equal_codes_match(self) -> None:
        assert checkin.codes_match("AB2C3D", "AB2C3D") is True

    def test_different_codes_differ(self) -> None:
        assert checkin.codes_match("AB2C3D", "AB2C3E") is False

    def test_case_sensitive(self) -> None:
        # Input is normalized to uppercase before this point.
        assert checkin.codes_match("AB2C3D", "ab2c3d") is False

    def test_none_is_never_a_match(self) -> None:
        assert checkin.codes_match(None, "ABCDEF") is False
        assert checkin.codes_match("ABCDEF", None) is False
        assert checkin.codes_match(None, None) is False

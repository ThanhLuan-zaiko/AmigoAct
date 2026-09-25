"""Unit tests for :mod:`backend.domain.greeting`.

These are true unit tests: no app, no HTTP, no filesystem, no network. If one
of these fails, the bug is in the pure logic, full stop.

Layer: **unit**
"""

from __future__ import annotations

import pytest

from backend.domain.greeting import (
    DEFAULT_GREETING,
    DEFAULT_NAME,
    MAX_NAME_LENGTH,
    InvalidNameError,
    build_greeting,
    normalize_name,
)

pytestmark = pytest.mark.unit


class TestNormalizeName:
    """The name-cleaning step that precedes greeting construction."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Lan", "Lan"),
            ("  Lan  ", "Lan"),
            ("Lan   Anh", "Lan Anh"),
            ("\tLan\nAnh  ", "Lan Anh"),
        ],
    )
    def test_collapses_surrounding_and_repeated_whitespace(self, raw: str, expected: str) -> None:
        assert normalize_name(raw) == expected

    @pytest.mark.parametrize("raw", ["", "   ", "\n\t"])
    def test_rejects_blank_names(self, raw: str) -> None:
        with pytest.raises(InvalidNameError, match="must not be empty"):
            normalize_name(raw)

    def test_accepts_a_name_at_the_length_limit(self) -> None:
        assert normalize_name("x" * MAX_NAME_LENGTH) == "x" * MAX_NAME_LENGTH

    def test_rejects_a_name_over_the_length_limit(self) -> None:
        with pytest.raises(InvalidNameError, match="at most 80 characters"):
            normalize_name("x" * (MAX_NAME_LENGTH + 1))

    def test_length_is_measured_after_whitespace_collapse(self) -> None:
        """A long name of only spaces is still too long once collapsed."""
        with pytest.raises(InvalidNameError, match="at most 80 characters"):
            normalize_name(" ".join(["x"] * (MAX_NAME_LENGTH + 1)))


class TestBuildGreeting:
    """The public greeting builder."""

    def test_builds_a_greeting_for_a_name(self) -> None:
        assert build_greeting("Lan") == f"{DEFAULT_GREETING}, Lan!"

    def test_normalizes_the_name_first(self) -> None:
        assert build_greeting("  Lan   Anh ") == f"{DEFAULT_GREETING}, Lan Anh!"

    @pytest.mark.parametrize("blank", [None, "", "   "])
    def test_falls_back_to_the_default_name(self, blank: str | None) -> None:
        assert build_greeting(blank) == f"{DEFAULT_GREETING}, {DEFAULT_NAME}!"

    def test_default_greeting_is_vietnamese(self) -> None:
        assert DEFAULT_GREETING == "Xin chào"

    def test_default_name_is_vietnamese(self) -> None:
        assert DEFAULT_NAME == "bạn"

    def test_supports_a_custom_salutation(self) -> None:
        assert build_greeting("Lan", greeting="Chào buổi sáng") == ("Chào buổi sáng, Lan!")

    def test_collapses_whitespace_in_the_salutation(self) -> None:
        assert build_greeting("Lan", greeting="  Chào   buổi sáng ") == ("Chào buổi sáng, Lan!")

    @pytest.mark.parametrize("blank_greeting", ["", "   "])
    def test_blank_salutation_falls_back_to_the_default(self, blank_greeting: str) -> None:
        assert build_greeting("Lan", greeting=blank_greeting) == (f"{DEFAULT_GREETING}, Lan!")

    def test_always_ends_with_exactly_one_exclamation_mark(self) -> None:
        assert build_greeting("Lan").endswith("!")
        assert not build_greeting("Lan").endswith("!!")

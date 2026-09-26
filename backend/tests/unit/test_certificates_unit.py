"""Unit tests for the pure helpers inside the certificate renderer.

The PDF render path itself is exercised in
``tests/integration/test_certificates_api.py`` — here only the I/O-free
helpers are pinned (private helpers, per suite convention).

Layer: **unit**
"""

from __future__ import annotations

import unicodedata
from decimal import Decimal

import pytest

from backend.services.certificates import _format_decimal, _nfc

pytestmark = pytest.mark.unit


class TestFormatDecimal:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (Decimal("4.50"), "4.5"),
            (Decimal("10"), "10"),
            (Decimal("0"), "0"),
            (Decimal("0.25"), "0.25"),
            (Decimal("100"), "100"),  # never "1E+2" scientific notation
            (Decimal("9999.99"), "9999.99"),
        ],
    )
    def test_plain_output(self, value: Decimal, expected: str) -> None:
        assert _format_decimal(value) == expected


class TestNfc:
    def test_nfd_input_composes(self) -> None:
        nfd = unicodedata.normalize("NFD", "Nguyễn")
        assert not unicodedata.is_normalized("NFC", nfd)
        assert _nfc(nfd) == unicodedata.normalize("NFC", nfd)
        assert unicodedata.is_normalized("NFC", _nfc(nfd))

    def test_nfc_input_unchanged(self) -> None:
        assert _nfc("Hiến máu") == "Hiến máu"

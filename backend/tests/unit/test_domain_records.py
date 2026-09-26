"""Unit tests for volunteer-record field rules.

Layer: **unit**
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from backend.domain import records
from backend.domain.errors import RuleViolationError

pytestmark = pytest.mark.unit

TODAY = date(2026, 9, 26)


class TestNormalizeRecordTitle:
    def test_collapses_whitespace(self) -> None:
        assert records.normalize_record_title("  Dọn   rác\n bờ  hồ  ") == "Dọn rác bờ hồ"

    def test_single_character_is_allowed(self) -> None:
        # Unlike activity titles (3..200), records have a floor of 1.
        assert records.normalize_record_title("X") == "X"

    @pytest.mark.parametrize("raw", ["", "   ", "\n\t"])
    def test_blank_is_invalid(self, raw: str) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.normalize_record_title(raw)
        assert err.value.code == "invalid_title"

    def test_too_long_is_invalid(self) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.normalize_record_title("a" * 201)
        assert err.value.code == "invalid_title"

    def test_max_length_ok(self) -> None:
        assert len(records.normalize_record_title("a" * 200)) == 200


class TestNormalizeRecordNote:
    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_blank_becomes_none(self, raw: str | None) -> None:
        assert records.normalize_record_note(raw) is None

    def test_collapses_and_keeps(self) -> None:
        assert records.normalize_record_note("  đã  tham gia  đợt  2 ") == ("đã tham gia đợt 2")

    def test_too_long(self) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.normalize_record_note("x" * 1001)
        assert err.value.code == "value_too_long"


class TestNormalizeEvidenceUrl:
    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_blank_becomes_none(self, raw: str | None) -> None:
        assert records.normalize_evidence_url(raw) is None

    @pytest.mark.parametrize(
        "raw",
        ["https://example.com/e.pdf", "http://drive.example/f", "  https://x.vn  "],
    )
    def test_http_urls_pass_trimmed(self, raw: str) -> None:
        assert records.normalize_evidence_url(raw) == raw.strip()

    @pytest.mark.parametrize(
        "raw",
        ["ftp://x", "javascript:alert(1)", "example.com/no-scheme", "HTTPS://X"],
    )
    def test_non_http_schemes_rejected(self, raw: str) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.normalize_evidence_url(raw)
        assert err.value.code == "invalid_evidence_url"

    def test_too_long(self) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.normalize_evidence_url("https://x/" + "y" * 500)
        assert err.value.code == "value_too_long"


class TestValidateRecordAward:
    def test_none_hours_is_participation_only(self) -> None:
        records.validate_record_award(None, Decimal("0"))

    def test_bounds_inclusive(self) -> None:
        records.validate_record_award(Decimal("0"), Decimal("0"))
        records.validate_record_award(Decimal("9999.99"), Decimal("9999.99"))

    @pytest.mark.parametrize("hours", [Decimal("-0.01"), Decimal("10000")])
    def test_hours_out_of_bounds(self, hours: Decimal) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.validate_record_award(hours, Decimal("0"))
        assert err.value.code == "invalid_hours"

    @pytest.mark.parametrize("points", [Decimal("-1"), Decimal("9999.99") + Decimal("0.01")])
    def test_points_out_of_bounds(self, points: Decimal) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.validate_record_award(None, points)
        assert err.value.code == "invalid_points"


class TestParseAwardedOn:
    def test_none_defaults_to_today(self) -> None:
        assert records.parse_awarded_on(None, TODAY) == TODAY

    def test_iso_string_parses(self) -> None:
        assert records.parse_awarded_on("2026-01-15", TODAY) == date(2026, 1, 15)

    def test_date_passthrough(self) -> None:
        assert records.parse_awarded_on(date(2020, 2, 29), TODAY) == date(2020, 2, 29)

    def test_today_is_allowed(self) -> None:
        assert records.parse_awarded_on("2026-09-26", TODAY) == TODAY

    def test_future_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.parse_awarded_on("2026-09-27", TODAY)
        assert err.value.code == "future_awarded_on"

    def test_garbage_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.parse_awarded_on("26/09/2026", TODAY)
        assert err.value.code == "invalid_awarded_on"

    def test_datetime_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as err:
            records.parse_awarded_on(datetime(2020, 1, 1, tzinfo=UTC), TODAY)
        assert err.value.code == "invalid_awarded_on"


class TestSumHours:
    def test_none_hours_count_as_zero(self) -> None:
        rows = [
            SimpleNamespace(hours=Decimal("4.5")),
            SimpleNamespace(hours=None),
            SimpleNamespace(hours=Decimal("2")),
        ]

        assert records.sum_hours(rows) == Decimal("6.5")

    def test_empty_is_zero(self) -> None:
        assert records.sum_hours([]) == Decimal("0")

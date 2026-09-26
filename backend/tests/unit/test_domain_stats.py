"""Unit tests for the pure reporting aggregations.

Layer: **unit**
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from backend.domain import stats

pytestmark = pytest.mark.unit

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


class TestMonthKey:
    def test_utc_month_boundary_shifts_in_business_tz(self) -> None:
        # 2026-01-31 18:00 UTC is 2026-02-01 01:00 in +07 — February locally.
        moment = datetime(2026, 1, 31, 18, 0, tzinfo=UTC)
        assert stats.month_key(moment, VN_TZ) == "2026-02"

    def test_same_month_stays(self) -> None:
        assert stats.month_key(datetime(2026, 1, 15, 12, 0, tzinfo=UTC), VN_TZ) == "2026-01"

    def test_date_month_key_has_no_tz(self) -> None:
        assert stats.date_month_key(date(2026, 2, 1)) == "2026-02"


class TestMonthlyBuckets:
    def test_folds_and_sorts_ascending(self) -> None:
        rows = [
            stats.MonthlyRow(month="2026-03", activities=1),
            stats.MonthlyRow(month="2026-01", registrations=2),
            stats.MonthlyRow(month="2026-03", registrations=1, hours=Decimal("4")),
            stats.MonthlyRow(month="2026-01", hours=Decimal("1.5")),
        ]

        buckets = stats.monthly_buckets(rows)

        assert [b.month for b in buckets] == ["2026-01", "2026-03"]
        jan, mar = buckets
        assert (jan.activities, jan.registrations, jan.hours) == (0, 2, Decimal("1.5"))
        assert (mar.activities, mar.registrations, mar.hours) == (1, 1, Decimal("4"))

    def test_empty_rows_give_empty_list(self) -> None:
        assert stats.monthly_buckets([]) == []


class TestGroupSum:
    def test_groups_sum_and_order_desc(self) -> None:
        rows = [
            SimpleNamespace(key="CNTT", hours=Decimal("1"), points=Decimal("2")),
            SimpleNamespace(key=None, hours=None, points=Decimal("1")),
            SimpleNamespace(key="CNTT", hours=Decimal("3"), points=Decimal("4")),
            SimpleNamespace(key="CK", hours=Decimal("10"), points=Decimal("0")),
        ]

        groups = stats.group_sum(rows, key_fn=lambda row: row.key)

        assert [(g.key, g.hours, g.points, g.count) for g in groups] == [
            ("CK", Decimal("10"), Decimal("0"), 1),
            ("CNTT", Decimal("4"), Decimal("6"), 2),
            (None, Decimal("0"), Decimal("1"), 1),
        ]

    def test_empty_rows(self) -> None:
        assert stats.group_sum([], key_fn=lambda row: row.key) == []


class TestCheckinRate:
    def test_zero_approved_is_honest_zero(self) -> None:
        assert stats.checkin_rate(0, 0) == 0.0
        assert stats.checkin_rate(0, 3) == 0.0

    def test_ratio_rounded_to_4dp(self) -> None:
        assert stats.checkin_rate(3, 1) == 0.3333
        assert stats.checkin_rate(4, 1) == 0.25
        assert stats.checkin_rate(2, 2) == 1.0

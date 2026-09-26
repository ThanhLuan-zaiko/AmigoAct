"""Unit tests for the custom column types in ``backend.db.types``.

Pure value conversion — no database, no I/O. The dialect objects are only
used for their ``name`` and ``type_descriptor``.

Layer: **unit**
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import Integer, LargeBinary, Numeric, create_engine
from sqlalchemy.dialects import oracle, sqlite

from backend.db.types import DecimalAmount, UtcDateTime, Uuid

pytestmark = pytest.mark.unit

# Bare engine construction performs no I/O; we only need each dialect's
# name and type_descriptor for the TypeDecorator under test.
SQLITE = sqlite.dialect()
ORACLE = create_engine("oracle+oracledb://").dialect


class TestUuid:
    """UUIDv7 <-> RAW(16) conversion."""

    def test_bind_converts_uuid_to_16_bytes(self) -> None:
        value = uuid.uuid7()

        bound = Uuid().process_bind_param(value, ORACLE)

        assert bound == value.bytes
        assert len(bound) == 16

    def test_bind_passes_none_through(self) -> None:
        assert Uuid().process_bind_param(None, ORACLE) is None

    def test_bind_rejects_non_uuid(self) -> None:
        bad: Any = "not-a-uuid"

        with pytest.raises(TypeError, match=r"uuid\.UUID"):
            Uuid().process_bind_param(bad, ORACLE)

    def test_result_rebuilds_uuid_from_bytes(self) -> None:
        value = uuid.uuid7()

        assert Uuid().process_result_value(value.bytes, ORACLE) == value

    def test_result_accepts_memoryview(self) -> None:
        value = uuid.uuid7()

        assert Uuid().process_result_value(memoryview(value.bytes), SQLITE) == value

    def test_result_passes_uuid_and_none_through(self) -> None:
        value = uuid.uuid7()
        assert Uuid().process_result_value(value, SQLITE) == value
        assert Uuid().process_result_value(None, SQLITE) is None

    def test_sqlite_impl_is_large_binary(self) -> None:
        impl = Uuid().load_dialect_impl(SQLITE)

        assert isinstance(impl, LargeBinary)
        assert impl.length == 16

    def test_oracle_impl_is_raw16_not_blob(self) -> None:
        impl = Uuid().load_dialect_impl(ORACLE)

        assert isinstance(impl, oracle.RAW)
        assert impl.length == 16


class TestUtcDateTime:
    """Aware-UTC-only datetime handling for TIMESTAMP WITH TIME ZONE."""

    def test_bind_converts_aware_to_naive_utc(self) -> None:
        aware = datetime(2026, 9, 26, 12, 30, tzinfo=timezone(timedelta(hours=7)))

        bound = UtcDateTime().process_bind_param(aware, ORACLE)

        # Driver-bound values are naive wall-clock UTC by design.
        assert bound == datetime(2026, 9, 26, 5, 30)
        assert bound.tzinfo is None

    def test_bind_rejects_naive_datetime(self) -> None:
        naive = datetime(2026, 9, 26, 5, 30)

        with pytest.raises(ValueError, match="aware UTC"):
            UtcDateTime().process_bind_param(naive, ORACLE)

    def test_bind_passes_none_through(self) -> None:
        assert UtcDateTime().process_bind_param(None, SQLITE) is None

    def test_result_reattaches_utc_to_naive_driver_values(self) -> None:
        naive = datetime(2026, 9, 26, 5, 30)  # the driver returns naive values

        result = UtcDateTime().process_result_value(naive, ORACLE)

        assert result == datetime(2026, 9, 26, 5, 30, tzinfo=UTC)

    def test_result_converts_aware_values_to_utc(self) -> None:
        aware = datetime(2026, 9, 26, 12, 30, tzinfo=timezone(timedelta(hours=7)))

        result = UtcDateTime().process_result_value(aware, SQLITE)

        assert result == datetime(2026, 9, 26, 5, 30, tzinfo=UTC)

    def test_result_passes_none_through(self) -> None:
        assert UtcDateTime().process_result_value(None, ORACLE) is None


class TestDecimalAmount:
    """NUMBER(6,2) as Decimal on Oracle, integer hundredths on SQLite."""

    def test_sqlite_impl_is_integer(self) -> None:
        assert isinstance(DecimalAmount().load_dialect_impl(SQLITE), Integer)

    def test_oracle_impl_is_numeric_6_2(self) -> None:
        impl = DecimalAmount().load_dialect_impl(ORACLE)

        assert isinstance(impl, Numeric)
        assert impl.precision == 6
        assert impl.scale == 2

    def test_sqlite_bind_stores_hundredths(self) -> None:
        assert DecimalAmount().process_bind_param(Decimal("12.34"), SQLITE) == 1234
        assert DecimalAmount().process_bind_param(Decimal("0"), SQLITE) == 0

    def test_oracle_bind_passes_decimal_through(self) -> None:
        bound = DecimalAmount().process_bind_param(Decimal("12.34"), ORACLE)

        assert bound == Decimal("12.34")
        assert isinstance(bound, Decimal)

    def test_bind_passes_none_through(self) -> None:
        assert DecimalAmount().process_bind_param(None, SQLITE) is None
        assert DecimalAmount().process_bind_param(None, ORACLE) is None

    def test_sqlite_result_unscales_hundredths(self) -> None:
        assert DecimalAmount().process_result_value(1234, SQLITE) == Decimal("12.34")

    def test_oracle_result_is_decimal(self) -> None:
        result = DecimalAmount().process_result_value(Decimal("12.34"), ORACLE)

        assert result == Decimal("12.34")
        assert isinstance(result, Decimal)

    def test_result_passes_none_through(self) -> None:
        assert DecimalAmount().process_result_value(None, SQLITE) is None

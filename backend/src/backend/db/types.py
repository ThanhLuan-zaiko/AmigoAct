"""Custom SQLAlchemy column types bridging schema.sql and Python.

Three decorators cover every column family the ORM maps:

* :class:`Uuid` — UUIDv7 stored as ``RAW(16)`` bytes (Oracle) or a 16-byte
  blob (SQLite), surfaced as :class:`uuid.UUID`.
* :class:`UtcDateTime` — ``TIMESTAMP WITH TIME ZONE`` columns that are
  always timezone-aware UTC in Python. The python-oracledb thin driver
  returns TSTZ values as *naive* wall-clock datetimes and interprets naive
  binds in the session timezone, so every pooled session is pinned to UTC
  (see ``database._pin_utc_session``) and this type binds naive UTC while
  re-attaching ``tzinfo=utc`` on reads. Naive datetimes are rejected loudly.
* :class:`DecimalAmount` — ``NUMBER(6,2)`` values surfaced as
  :class:`decimal.Decimal`. SQLite has no fixed-point type, so values are
  stored as integer hundredths there; this also avoids SQLAlchemy's
  Decimal-to-float coercion warning on SQLite.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Integer, LargeBinary, Numeric
from sqlalchemy.dialects import oracle
from sqlalchemy.engine.interfaces import Dialect
from sqlalchemy.types import TypeDecorator, TypeEngine


class Uuid(TypeDecorator[uuid.UUID]):
    """UUIDv7 stored as 16 raw bytes, surfaced as :class:`uuid.UUID`.

    Oracle columns are ``RAW(16)``; binding ``uuid.bytes`` keeps index and
    join semantics identical to the hand-written DDL. ``load_dialect_impl``
    pins ``oracle.RAW(16)`` explicitly because the oracledb dialect would
    otherwise compile :class:`LargeBinary` to ``BLOB``, which cannot
    compare-equal against ``RAW(16)`` columns in joins.
    """

    impl = LargeBinary(16)
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        """Return ``RAW(16)`` on Oracle, a 16-byte blob elsewhere."""
        if dialect.name == "oracle":
            return dialect.type_descriptor(oracle.RAW(16))
        return dialect.type_descriptor(LargeBinary(16))

    def process_bind_param(self, value: object, dialect: Dialect) -> bytes | None:
        """Store a :class:`uuid.UUID` as its 16-byte representation.

        Raises:
            TypeError: If a non-UUID value reaches the bind — silently
                coercing strings would hide caller bugs.
        """
        if value is None:
            return None
        if not isinstance(value, uuid.UUID):
            msg = f"Uuid columns take uuid.UUID values, got {type(value).__name__}"
            raise TypeError(msg)
        return value.bytes

    def process_result_value(
        self, value: bytes | memoryview | uuid.UUID | None, dialect: Dialect
    ) -> uuid.UUID | None:
        """Rebuild a :class:`uuid.UUID` from the driver's 16 raw bytes."""
        if value is None:
            return None
        if isinstance(value, uuid.UUID):  # some drivers surface UUID directly
            return value
        if isinstance(value, memoryview):
            value = bytes(value)
        return uuid.UUID(bytes=value)


class UtcDateTime(TypeDecorator[datetime]):
    """``TIMESTAMP WITH TIME ZONE`` that is always aware UTC in Python.

    The python-oracledb thin driver fetches TSTZ as naive wall-clock values
    and interprets naive binds in the *session* timezone. Sessions are
    pinned to UTC at checkout (``database._pin_utc_session``), so this type
    binds aware values as naive UTC and re-attaches ``tzinfo=utc`` on reads.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """Convert an aware datetime to naive UTC for the driver.

        Raises:
            ValueError: If ``value`` is naive — a naive datetime has no
                defined instant and would silently adopt the session zone.
        """
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("aware UTC datetime required")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        """Return an aware UTC datetime from whatever the driver gave us."""
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class DecimalAmount(TypeDecorator[Decimal]):
    """``NUMBER(6,2)`` surfaced as :class:`decimal.Decimal`.

    Oracle binds and reads the Decimal natively. SQLite has no fixed-point
    numeric type (and binding a Decimal there triggers SQLAlchemy's
    float-coercion warning), so on SQLite the value is stored as integer
    hundredths — e.g. ``Decimal("12.34")`` lands as ``1234`` — and divided
    back out on read. Precision is exact on both dialects.
    """

    impl = Numeric(6, 2)
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[Any]:
        """Store integer hundredths on SQLite, native NUMBER elsewhere."""
        if dialect.name == "sqlite":
            return dialect.type_descriptor(Integer())
        return dialect.type_descriptor(Numeric(6, 2))

    def process_bind_param(
        self, value: Decimal | int | None, dialect: Dialect
    ) -> Decimal | int | None:
        """Bind the Decimal on Oracle, integer hundredths on SQLite."""
        if value is None:
            return None
        amount = Decimal(value)
        if dialect.name == "sqlite":
            return int(amount * 100)
        return amount

    def process_result_value(
        self, value: Decimal | int | float | None, dialect: Dialect
    ) -> Decimal | None:
        """Return a Decimal, unscaling SQLite's integer hundredths."""
        if value is None:
            return None
        if dialect.name == "sqlite":
            return Decimal(value) / 100
        return Decimal(value)

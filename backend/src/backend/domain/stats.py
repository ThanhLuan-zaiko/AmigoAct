"""Report aggregation primitives — pure reshaping, no I/O.

Services query light rows (ORM tuples or small dataclasses) and hand them
to these helpers, which own the bucketing/summing/rate arithmetic so the
reports stay honest: every number is a fold over real rows, and degenerate
inputs yield honest zeros rather than ``NaN`` or invented labels.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Protocol
from zoneinfo import ZoneInfo


def month_key(moment: datetime, tz: ZoneInfo) -> str:
    """Return ``"YYYY-MM"`` for an aware instant viewed in ``tz``.

    Which month an activity "belongs to" is a business-tz question: a
    UTC timestamp near a month boundary may land in the neighbouring
    month locally.
    """
    local = moment.astimezone(tz)
    return f"{local.year:04d}-{local.month:02d}"


def date_month_key(day: date) -> str:
    """Return ``"YYYY-MM"`` for a plain calendar date.

    ``awarded_on`` is already a business-tz-aligned calendar date — no
    timezone conversion applies.
    """
    return f"{day.year:04d}-{day.month:02d}"


@dataclass(frozen=True)
class MonthlyRow:
    """One event's contribution to its month bucket.

    The service emits one row per activity, registration, or record and
    :func:`monthly_buckets` folds them.
    """

    month: str
    activities: int = 0
    registrations: int = 0
    hours: Decimal = Decimal("0")


@dataclass(frozen=True)
class MonthlyBucket:
    """One month's folded counters."""

    month: str
    activities: int
    registrations: int
    hours: Decimal


@dataclass
class _MonthAcc:
    """Mutable per-month accumulator used while folding."""

    activities: int = 0
    registrations: int = 0
    hours: Decimal = Decimal("0")


def monthly_buckets(rows: Iterable[MonthlyRow]) -> list[MonthlyBucket]:
    """Fold contribution rows into one bucket per month, ascending."""
    buckets: dict[str, _MonthAcc] = {}
    for row in rows:
        acc = buckets.setdefault(row.month, _MonthAcc())
        acc.activities += row.activities
        acc.registrations += row.registrations
        acc.hours += row.hours
    return [
        MonthlyBucket(
            month=month,
            activities=acc.activities,
            registrations=acc.registrations,
            hours=acc.hours,
        )
        for month, acc in sorted(buckets.items())
    ]


class AwardLike(Protocol):
    """Anything carrying a nullable ``hours`` and a ``points`` award.

    Read-only members: an implementation may narrow ``hours`` to plain
    ``Decimal`` and still satisfy the protocol.
    """

    @property
    def hours(self) -> Decimal | None:
        """Credited hours; ``None`` counts as zero."""

    @property
    def points(self) -> Decimal:
        """Credited points."""


@dataclass(frozen=True)
class GroupSum:
    """Award totals for one group key (``None`` = "no value declared")."""

    key: str | None
    hours: Decimal
    points: Decimal
    count: int


@dataclass
class _GroupAcc:
    """Mutable per-group accumulator used while folding."""

    hours: Decimal = field(default=Decimal("0"))
    points: Decimal = field(default=Decimal("0"))
    count: int = 0


def group_sum[T: AwardLike](rows: Iterable[T], key_fn: Callable[[T], str | None]) -> list[GroupSum]:
    """Group award rows by ``key_fn`` and sum hours/points per group.

    ``hours=None`` counts as zero. Groups are ordered by hours desc, then
    points desc, then key asc — deterministic for equal totals. ``count``
    is the number of *rows* in the group: feed member-level rows and it
    counts members.
    """
    groups: dict[str | None, _GroupAcc] = {}
    for row in rows:
        acc = groups.setdefault(key_fn(row), _GroupAcc())
        acc.hours += row.hours if row.hours is not None else Decimal("0")
        acc.points += row.points
        acc.count += 1
    return sorted(
        (
            GroupSum(key=key, hours=acc.hours, points=acc.points, count=acc.count)
            for key, acc in groups.items()
        ),
        key=lambda group: (-group.hours, -group.points, group.key or ""),
    )


def checkin_rate(approved: int, checked_in: int) -> float:
    """Return ``checked_in / approved`` rounded to 4 decimals.

    Zero approved means an honest ``0.0`` — never ``NaN`` or a division
    error reaching an API payload.
    """
    if approved == 0:
        return 0.0
    return round(checked_in / approved, 4)

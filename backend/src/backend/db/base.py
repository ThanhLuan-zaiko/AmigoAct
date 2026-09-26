"""Declarative base shared by every ORM model.

``AsyncAttrs`` makes attribute access explicit in async contexts
(``await obj.awaitable_attrs.x``); all relationships are still declared
``lazy="raise"`` so an accidental implicit load fails loudly instead of
issuing a blocking query off the event loop.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase

from backend.config import get_settings


class Base(AsyncAttrs, DeclarativeBase):
    """Root of the ORM metadata tree; importing the models registers them."""


def business_today() -> date:
    """Return today's calendar date in the configured business timezone.

    ``volunteer_records.awarded_on`` is a calendar date (schema default
    ``TRUNC(SYSDATE)``); which date "today" is depends on
    ``Settings.timezone``, not on UTC.
    """
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


def utcnow() -> datetime:
    """Return the current instant as an aware UTC datetime.

    Used as the Python-side ``default``/``onupdate`` for ``*_at`` columns so
    the value passes through :class:`~backend.db.types.UtcDateTime` as an
    aware UTC datetime. The schema's ``DEFAULT SYSTIMESTAMP`` and
    ``BEFORE UPDATE`` triggers remain as a backstop for non-ORM writers.
    """
    return datetime.now(UTC)

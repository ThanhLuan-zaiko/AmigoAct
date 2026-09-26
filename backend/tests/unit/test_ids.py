"""Unit tests for ``domain.ids`` — UUIDv7 entity identifiers.

Layer: **unit**
"""

from __future__ import annotations

import time
import uuid

import pytest

from backend.domain.ids import new_id

pytestmark = pytest.mark.unit


class TestNewId:
    """Every entity id is a UUIDv7: unique, versioned, time-ordered."""

    def test_returns_a_uuid(self) -> None:
        assert isinstance(new_id(), uuid.UUID)

    def test_version_is_7(self) -> None:
        assert new_id().version == 7

    def test_ids_are_unique(self) -> None:
        ids = {new_id() for _ in range(1000)}

        assert len(ids) == 1000

    def test_embeds_current_unix_milliseconds(self) -> None:
        before = int(time.time() * 1000)

        identifier = new_id()

        after = int(time.time() * 1000)
        # UUIDv7 layout: the first 48 bits are the millisecond timestamp.
        timestamp_ms = identifier.int >> 80
        assert before <= timestamp_ms <= after

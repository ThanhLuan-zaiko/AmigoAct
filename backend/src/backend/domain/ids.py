"""Entity identifiers: UUIDv7 generated application-side.

UUIDv7 embeds a millisecond timestamp in the most significant bits, so ids
sort roughly by creation time — index-friendly while staying decentralised
(no sequence round-trip). Store them in Oracle as ``RAW(16)`` columns via
``uuid.bytes`` (or ``CHAR(36)`` via ``str()`` where readability wins).

Pure stdlib — no framework imports — so ids can be minted anywhere.
"""

from __future__ import annotations

import uuid


def new_id() -> uuid.UUID:
    """Return a fresh UUIDv7 identifier."""
    return uuid.uuid7()

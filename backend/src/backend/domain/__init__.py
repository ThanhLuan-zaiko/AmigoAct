"""Pure business logic, with no knowledge of HTTP or persistence.

Anything in :mod:`backend.domain` is safe to unit test in isolation: it
receives plain values, performs no I/O, and returns plain values.
"""

from __future__ import annotations

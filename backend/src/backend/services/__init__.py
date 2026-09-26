"""Session-aware business operations.

Services sit between :mod:`backend.api` (HTTP surface) and
:mod:`backend.domain` (pure rules): they own SQLAlchemy sessions, issue
queries, commit transactions, and raise :mod:`backend.domain.errors`
subclasses for the API layer to translate. No FastAPI imports live here —
a service is callable from a router, a script, or a WebSocket handler
alike.
"""

from __future__ import annotations

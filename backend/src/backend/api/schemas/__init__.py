"""Pydantic request/response schemas for the HTTP surface.

Schemas are thin transport shapes — business rules live in
:mod:`backend.domain` — and are the *only* objects routers return; ORM
entities are never serialized directly.
"""

from __future__ import annotations

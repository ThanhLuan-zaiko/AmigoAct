"""Persistence layer — SQLAlchemy 2.0 async ORM over the oracledb pool.

``base`` holds the declarative root, ``types`` the column TypeDecorators
that bridge schema.sql and Python, ``models`` the table mappings, and
``session`` the session factory builder.

Importing this package (directly or via any ``backend.db.*`` submodule)
imports :mod:`backend.db.models`, so every table is registered on
``Base.metadata`` — ``create_all`` never sees a partial schema.
"""

from __future__ import annotations

from . import models
from .base import Base

__all__ = ["Base", "models"]

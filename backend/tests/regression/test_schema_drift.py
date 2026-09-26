"""Regression: the ORM metadata must mirror schema.sql.

``schema.sql`` is the source of truth for the live Oracle schema; the ORM
metadata is what creates the SQLite test schema. This test parses the DDL
and compares column-name sets per mapped table so the two can never
silently drift apart (e.g. a column added to one but not the other).

Only the six tables mapped this phase are checked; when a new table gets
an ORM mapping, add its name to ``MAPPED_TABLES`` in the same commit.

Layer: **regression**
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.db.base import Base

pytestmark = pytest.mark.regression

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema.sql"

# Tables with ORM mappings. images/activity_photos/volunteer_record_images/
# notifications are intentionally unmapped this phase.
MAPPED_TABLES = (
    "users",
    "organizations",
    "org_members",
    "activities",
    "activity_registrations",
    "volunteer_records",
)

# A column-definition line is ``name TYPE ...`` — constraint lines
# (CONSTRAINT/PRIMARY/…) and their continuations (REFERENCES, OR, CHECK
# clauses spanning lines) never match because the second token is a type.
_CREATE_TABLE = re.compile(r"CREATE TABLE (\w+)\s*\(")
_COLUMN_DEF = re.compile(
    r"^(\w+)\s+(RAW|VARCHAR2|NVARCHAR2|VARCHAR|CHAR|NCHAR|NUMBER|INTEGER|INT"
    r"|DATE|TIMESTAMP|CLOB|NCLOB|BLOB|BOOLEAN|JSON|INTERVAL|FLOAT"
    r"|BINARY_FLOAT|BINARY_DOUBLE)\b",
    re.IGNORECASE,
)


def _parse_columns(sql: str) -> dict[str, set[str]]:
    """Extract ``{table_name: {column_name, ...}}`` from CREATE TABLE blocks."""
    tables: dict[str, set[str]] = {}
    current: str | None = None
    for raw_line in sql.splitlines():
        line = raw_line.split("--", 1)[0].strip()
        if not line:
            continue
        match = _CREATE_TABLE.match(line)
        if match:
            current = match.group(1).lower()
            tables[current] = set()
            continue
        if current is None:
            continue
        if line.startswith(")"):
            current = None
            continue
        column_match = _COLUMN_DEF.match(line)
        if column_match is not None:
            tables[current].add(column_match.group(1).lower())
    return tables


class TestSchemaDrift:
    """Column-name parity between schema.sql and the ORM metadata."""

    def test_schema_file_covers_all_mapped_tables(self) -> None:
        parsed = _parse_columns(SCHEMA_PATH.read_text(encoding="utf-8"))

        for table in MAPPED_TABLES:
            assert table in parsed, f"{table} missing from schema.sql"
            assert table in Base.metadata.tables, f"{table} missing from ORM metadata"

    @pytest.mark.parametrize("table", MAPPED_TABLES)
    def test_columns_match(self, table: str) -> None:
        parsed = _parse_columns(SCHEMA_PATH.read_text(encoding="utf-8"))
        ddl_columns = parsed[table]
        orm_columns = set(Base.metadata.tables[table].columns.keys())

        assert ddl_columns == orm_columns, (
            f"{table}: schema.sql has {sorted(ddl_columns - orm_columns)} not in "
            f"ORM; ORM has {sorted(orm_columns - ddl_columns)} not in schema.sql"
        )

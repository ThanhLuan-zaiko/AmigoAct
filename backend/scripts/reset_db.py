"""Drop, recreate, and rebuild the application schema in a local Oracle database.

Dev helper invoked by ``reset_database.ps1`` — it can also be run directly::

    uv run python scripts/reset_db.py [--allow-remote] [--schema PATH]

It connects as ``AMIGOACT_DB_ADMIN_USER`` (``SYS`` connects AS SYSDBA) to
``AMIGOACT_DB_HOST:AMIGOACT_DB_PORT/AMIGOACT_DB_SERVICE``, drops
``AMIGOACT_DB_USER`` if present, recreates it with the privileges the
application needs, then applies ``schema.sql`` (``--schema`` overrides the
path) through a fresh connection as the app user. It refuses to touch a
remote host or an Oracle-maintained account unless ``--allow-remote`` is
passed.

The admin password is read from the ``AMIGOACT_DB_ADMIN_PASSWORD`` environment
variable, falling back to a masked prompt — it is never taken from ``.env``.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
from pathlib import Path

import oracledb

from backend.config import get_settings

_DEFAULT_SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"

_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_$#]{0,127}$")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_NEVER_DROP = {"SYS", "SYSTEM", "PDBADMIN", "DBSNMP", "OUTLN"}

_GRANTS = (
    "CREATE SESSION",
    "CREATE TABLE",
    "CREATE SEQUENCE",
    "CREATE VIEW",
    "CREATE PROCEDURE",
    "CREATE TRIGGER",
    "CREATE SYNONYM",
    "CREATE TYPE",
)


def _validate_identifier(name: str, label: str) -> str:
    """Guard a SQL identifier that cannot be passed as a bind variable."""
    if not _IDENTIFIER.match(name):
        print(f"error: {label} '{name}' is not a valid Oracle identifier", file=sys.stderr)
        raise SystemExit(2)
    return name.upper()


def _check_target(user: str, admin: str, allow_remote: bool, host: str) -> None:
    """Refuse operations that would damage a shared or Oracle-owned schema."""
    if user in _NEVER_DROP:
        print(f"error: refusing to drop Oracle-internal user {user}", file=sys.stderr)
        raise SystemExit(2)
    if user == admin.upper():
        print(
            f"error: AMIGOACT_DB_USER ({user}) must differ from "
            f"AMIGOACT_DB_ADMIN_USER — dropping the login user is not allowed",
            file=sys.stderr,
        )
        raise SystemExit(2)
    if not allow_remote and host.lower() not in _LOCAL_HOSTS:
        print(
            f"error: db host '{host}' is not local — pass --allow-remote "
            "(via -AllowRemote) only if you really mean it",
            file=sys.stderr,
        )
        raise SystemExit(2)


def _admin_password(admin_user: str, dsn: str) -> str:
    """Resolve the admin password: env var first, masked prompt otherwise."""
    from_env = os.environ.get("AMIGOACT_DB_ADMIN_PASSWORD", "").strip()
    if from_env:
        return from_env
    if not sys.stdin.isatty():
        print(
            "error: no terminal to prompt on - set AMIGOACT_DB_ADMIN_PASSWORD "
            "in the environment instead",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return getpass.getpass(f"Password for {admin_user}@{dsn}: ")


def _user_exists(cursor: oracledb.Cursor, user: str) -> bool:
    cursor.execute("select count(*) from all_users where username = :1", [user])
    row = cursor.fetchone()
    return bool(row and row[0] > 0)


def _quote_password(value: str) -> str:
    """Render a password for ``IDENTIFIED BY`` — a double-quoted string."""
    return '"' + value.replace('"', '""') + '"'


_PLSQL_START = re.compile(
    r"^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TRIGGER|PROCEDURE|FUNCTION|PACKAGE)\b",
    re.IGNORECASE,
)


def _split_sql_statements(script: str) -> list[str]:
    """Split a DDL script into individual statements.

    ``schema.sql`` follows two conventions: a plain statement ends with ``;``
    at end-of-line, and a PL/SQL block (``CREATE TRIGGER`` and friends) ends
    with ``/`` alone on a line — the delimiter is stripped, not sent to
    Oracle. Blank lines and full-line ``--`` comments are skipped; trailing
    ``--`` comments inside a statement are left for Oracle to ignore.
    """
    statements: list[str] = []
    buffer: list[str] = []
    in_plsql = False
    for line in script.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        if in_plsql:
            if stripped == "/":
                statement = "\n".join(buffer).strip()
                if statement:
                    statements.append(statement)
                buffer, in_plsql = [], False
            else:
                buffer.append(line)
            continue
        if not buffer and _PLSQL_START.match(stripped):
            in_plsql = True
        buffer.append(line)
        if not in_plsql and stripped.endswith(";"):
            statement = "\n".join(buffer).rstrip().removesuffix(";").strip()
            if statement:
                statements.append(statement)
            buffer = []
    tail = "\n".join(buffer).strip()
    if tail:
        raise ValueError(f"unterminated statement in schema file: {tail[:80]}...")
    return statements


def _apply_schema(dsn: str, user: str, password: str, schema_path: Path) -> None:
    """Execute every statement in ``schema_path`` as the app user.

    Connecting as the freshly created user doubles as a credential check:
    a wrong ``AMIGOACT_DB_PASSWORD`` fails here rather than at app startup.
    """
    if not schema_path.is_file():
        print(f"error: schema file not found: {schema_path}", file=sys.stderr)
        raise SystemExit(2)
    statements = _split_sql_statements(schema_path.read_text(encoding="utf-8"))
    print(f"Applying {len(statements)} statements from {schema_path.name} ...")
    connection = oracledb.connect(user=user, password=password, dsn=dsn)
    try:
        cursor = connection.cursor()
        for index, statement in enumerate(statements, start=1):
            try:
                cursor.execute(statement)
            except oracledb.Error:
                first_line = statement.splitlines()[0] if statement.splitlines() else ""
                print(
                    f"error: statement {index} failed: {first_line} ...",
                    file=sys.stderr,
                )
                raise
        connection.commit()
    finally:
        connection.close()


def _parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse CLI flags for the reset helper."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="permit resetting a non-localhost database (dangerous)",
    )
    parser.add_argument(
        "--schema",
        type=Path,
        default=_DEFAULT_SCHEMA,
        help=f"DDL file applied after the user is recreated (default: {_DEFAULT_SCHEMA})",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """Entry point: drop the app user, recreate it, and apply schema.sql."""
    args = _parse_args(argv)
    settings = get_settings()

    host, port, service = settings.db_host, settings.db_port, settings.db_service
    dsn = f"{host}:{port}/{service}"
    app_user = _validate_identifier(settings.db_user, "AMIGOACT_DB_USER")
    admin_user = _validate_identifier(settings.db_admin_user, "AMIGOACT_DB_ADMIN_USER")

    if not settings.db_password:
        print("error: AMIGOACT_DB_PASSWORD is empty — fill it in .env", file=sys.stderr)
        return 2

    _check_target(app_user, admin_user, args.allow_remote, host)
    admin_password = _admin_password(admin_user, dsn)
    if not admin_password:
        print("error: empty admin password", file=sys.stderr)
        return 2

    mode = oracledb.AUTH_MODE_SYSDBA if admin_user == "SYS" else oracledb.AUTH_MODE_DEFAULT
    print(f"Connecting to {dsn} as {admin_user} ...")
    connection = oracledb.connect(
        user=admin_user,
        password=admin_password,
        dsn=dsn,
        mode=mode,
    )
    try:
        cursor = connection.cursor()
        # Identifiers cannot be bound; they are regex-validated above and the
        # password is passed as a double-quoted string.
        if _user_exists(cursor, app_user):
            print(f"Dropping existing user {app_user} ...")
            cursor.execute("drop user " + app_user + " cascade")
        print(f"Creating user {app_user} ...")
        cursor.execute(
            "create user " + app_user + " identified by " + _quote_password(settings.db_password)
        )
        cursor.execute("grant " + ", ".join(_GRANTS) + " to " + app_user)
        cursor.execute("alter user " + app_user + " quota unlimited on users")
    finally:
        connection.close()

    _apply_schema(dsn, app_user, settings.db_password, args.schema)
    print(f"Done - schema {app_user} rebuilt from {args.schema.name} on {dsn}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

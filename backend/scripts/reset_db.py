"""Drop and recreate the application schema in a local Oracle database.

Dev helper invoked by ``reset_database.ps1`` — it can also be run directly::

    uv run python scripts/reset_db.py [--allow-remote]

It connects as ``AMIGOACT_DB_ADMIN_USER`` (``SYS`` connects AS SYSDBA) to
``AMIGOACT_DB_HOST:AMIGOACT_DB_PORT/AMIGOACT_DB_SERVICE``, drops
``AMIGOACT_DB_USER`` if present, and recreates it with the privileges the
application needs. It refuses to touch a remote host or an Oracle-maintained
account unless ``--allow-remote`` is passed.

The admin password is read from the ``AMIGOACT_DB_ADMIN_PASSWORD`` environment
variable, falling back to a masked prompt — it is never taken from ``.env``.
"""

from __future__ import annotations

import getpass
import os
import re
import sys

import oracledb

from backend.config import get_settings

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


def main(argv: list[str]) -> int:
    """Entry point: drop the app schema user and recreate it empty."""
    allow_remote = "--allow-remote" in argv
    settings = get_settings()

    host, port, service = settings.db_host, settings.db_port, settings.db_service
    dsn = f"{host}:{port}/{service}"
    app_user = _validate_identifier(settings.db_user, "AMIGOACT_DB_USER")
    admin_user = _validate_identifier(settings.db_admin_user, "AMIGOACT_DB_ADMIN_USER")

    if not settings.db_password:
        print("error: AMIGOACT_DB_PASSWORD is empty — fill it in .env", file=sys.stderr)
        return 2

    _check_target(app_user, admin_user, allow_remote, host)
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

    print(f"Done - schema {app_user} is empty and ready on {dsn}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

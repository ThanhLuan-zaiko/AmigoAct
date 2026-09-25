"""Greeting text generation.

Pure functions only — no I/O, no framework imports. This is the reference
example of a *unit testable* unit (see ``tests/unit/test_greeting.py``).

User-facing strings are Vietnamese. See AGENTS.md > Language convention.
"""

from __future__ import annotations

MAX_NAME_LENGTH = 80
DEFAULT_NAME = "bạn"
DEFAULT_GREETING = "Xin chào"


class InvalidNameError(ValueError):
    """Raised when a supplied name cannot be used to build a greeting."""


def normalize_name(name: str) -> str:
    """Collapse surrounding and repeated whitespace in ``name``.

    Args:
        name: Raw name as provided by the caller.

    Returns:
        The trimmed name with internal runs of whitespace reduced to one space.

    Raises:
        InvalidNameError: If the name is empty or longer than
            :data:`MAX_NAME_LENGTH` after normalization.
    """
    collapsed = " ".join(name.split())
    if not collapsed:
        raise InvalidNameError("name must not be empty")
    if len(collapsed) > MAX_NAME_LENGTH:
        msg = f"name must be at most {MAX_NAME_LENGTH} characters, got {len(collapsed)}"
        raise InvalidNameError(msg)
    return collapsed


def build_greeting(name: str | None = None, *, greeting: str = DEFAULT_GREETING) -> str:
    """Build a greeting string for ``name``.

    Args:
        name: Optional name. When ``None`` or blank, a generic greeting is
            returned using :data:`DEFAULT_NAME`.
        greeting: The salutation to use, e.g. ``"Xin chào"``.

    Returns:
        A greeting such as ``"Xin chào, Lan!"``.

    Raises:
        InvalidNameError: If ``name`` is present but not usable.
    """
    salutation = " ".join(greeting.split()) or DEFAULT_GREETING
    if name is None or not name.strip():
        return f"{salutation}, {DEFAULT_NAME}!"
    return f"{salutation}, {normalize_name(name)}!"

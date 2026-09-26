"""Check-in codes — generation and comparison, pure stdlib.

Managers publish a short code (printed, QR, or spoken) that members type
at the door. The alphabet drops ambiguous glyphs (``0``, ``O``, ``1``,
``I``, ``L``) so handwritten codes survive; comparison goes through
:func:`hmac.compare_digest` to keep the check constant-time.
"""

from __future__ import annotations

import hmac
import secrets
from collections.abc import Callable

from backend.domain.errors import RuleViolationError

# 31 glyphs: uppercase letters + digits minus the ambiguous set.
CHECKIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CHECKIN_CODE_LENGTH = 6


def generate_checkin_code(rng: Callable[[str], str] = secrets.choice) -> str:
    """Return a fresh check-in code drawn from :data:`CHECKIN_CODE_ALPHABET`.

    Args:
        rng: Picks one element from a sequence — ``secrets.choice`` in
            production; tests inject a deterministic picker.
    """
    return "".join(rng(CHECKIN_CODE_ALPHABET) for _ in range(CHECKIN_CODE_LENGTH))


def normalize_checkin_code(raw: str) -> str:
    """Strip and uppercase ``raw``, then validate charset and length.

    Raises:
        RuleViolationError: With ``code="invalid_code"`` when the value is
            not exactly :data:`CHECKIN_CODE_LENGTH` alphabet characters.
    """
    candidate = raw.strip().upper()
    if len(candidate) != CHECKIN_CODE_LENGTH or any(
        char not in CHECKIN_CODE_ALPHABET for char in candidate
    ):
        raise RuleViolationError("invalid check-in code", code="invalid_code")
    return candidate


def codes_match(expected: str | None, supplied: str | None) -> bool:
    """Return ``True`` when both codes exist and are identical.

    ``None`` on either side is simply ``False`` — an activity with no code
    set rejects every attempt. The comparison is constant-time so a wrong
    guess cannot be walked character by character.
    """
    if expected is None or supplied is None:
        return False
    return hmac.compare_digest(expected, supplied)

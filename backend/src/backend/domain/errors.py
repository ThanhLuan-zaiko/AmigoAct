"""Domain error hierarchy — transport-free business failures.

Every expected business-rule failure raises a :class:`DomainError` subclass.
Each carries a human-readable ``detail`` (English diagnostics, per the repo
language convention) plus a stable machine ``code`` that API clients switch
on. The HTTP layer in :mod:`backend.api.errors` maps subclasses to status
codes; the domain never imports HTTP machinery.
"""

from __future__ import annotations


class DomainError(Exception):
    """Base for expected business-rule failures.

    Attributes:
        detail: English diagnostic message for developers.
        code: Stable machine-readable string, e.g. ``"email_taken"``.
            Subclasses set a class-level default; callers may override it
            per raise via the ``code`` kwarg.
    """

    code: str = "error"

    def __init__(self, detail: str, *, code: str | None = None) -> None:
        """Store the diagnostic and optionally override the class-level code.

        Args:
            detail: English diagnostic message.
            code: Specific code overriding the subclass default, e.g.
                ``ConflictError("email already registered", code="email_taken")``.
        """
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code


class NotFoundError(DomainError):
    """The requested entity does not exist (or is not visible to the caller)."""

    code = "not_found"


class PermissionDeniedError(DomainError):
    """The caller is authenticated but not allowed to perform the action."""

    code = "permission_denied"


class ConflictError(DomainError):
    """The action collides with existing state, e.g. a unique constraint."""

    code = "conflict"


class RuleViolationError(DomainError):
    """Input failed a business-rule check (format, range, invariant)."""

    code = "rule_violation"


class AuthenticationError(DomainError):
    """Credentials are missing, invalid, or the account cannot authenticate."""

    code = "unauthenticated"

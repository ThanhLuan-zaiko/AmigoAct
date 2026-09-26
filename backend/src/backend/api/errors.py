"""HTTP translation for the domain error hierarchy.

One exception handler maps :class:`~backend.domain.errors.DomainError`
subclasses to status codes and emits the stable error body
``{"detail": ..., "code": ...}`` that clients switch on. ``detail`` is an
English diagnostic; ``code`` is the machine contract.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.domain.errors import (
    AuthenticationError,
    ConflictError,
    DomainError,
    NotFoundError,
    PermissionDeniedError,
    RuleViolationError,
)

# Order matters for the response contract; subclasses not listed default
# to 500 via the DomainError fallback.
_STATUS_BY_TYPE: dict[type[DomainError], int] = {
    AuthenticationError: 401,
    PermissionDeniedError: 403,
    NotFoundError: 404,
    ConflictError: 409,
    RuleViolationError: 422,
}


def register_error_handlers(application: FastAPI) -> None:
    """Attach the domain-error handler to the app."""

    @application.exception_handler(DomainError)
    async def domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
        """Render ``{"detail", "code"}`` with the subclass-mapped status."""
        status_code = _STATUS_BY_TYPE.get(type(exc), 500)
        headers = {"WWW-Authenticate": "Bearer"} if isinstance(exc, AuthenticationError) else None
        return JSONResponse(
            status_code=status_code,
            content={"detail": exc.detail, "code": exc.code},
            headers=headers,
        )

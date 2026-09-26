"""Unit tests for the domain error hierarchy in ``domain.errors``.

Layer: **unit**
"""

from __future__ import annotations

import pytest

from backend.domain.errors import (
    AuthenticationError,
    ConflictError,
    DomainError,
    NotFoundError,
    PermissionDeniedError,
    RuleViolationError,
)

pytestmark = pytest.mark.unit


class TestDomainError:
    """The shared base carries detail and a stable machine code."""

    def test_detail_is_exposed_and_is_the_message(self) -> None:
        exc = DomainError("something broke")

        assert exc.detail == "something broke"
        assert str(exc) == "something broke"

    def test_default_code(self) -> None:
        assert DomainError("x").code == "error"

    def test_code_override_via_kwarg(self) -> None:
        exc = ConflictError("email already registered", code="email_taken")

        assert exc.code == "email_taken"
        assert exc.detail == "email already registered"

    def test_is_an_exception(self) -> None:
        with pytest.raises(DomainError, match="boom"):
            raise DomainError("boom")


class TestSubclassCodes:
    """Each subclass pins its default machine code."""

    @pytest.mark.parametrize(
        ("error_type", "expected_code"),
        [
            (NotFoundError, "not_found"),
            (PermissionDeniedError, "permission_denied"),
            (ConflictError, "conflict"),
            (RuleViolationError, "rule_violation"),
            (AuthenticationError, "unauthenticated"),
        ],
    )
    def test_default_codes(self, error_type: type[DomainError], expected_code: str) -> None:
        assert error_type("x").code == expected_code

    @pytest.mark.parametrize(
        "error_type",
        [
            NotFoundError,
            PermissionDeniedError,
            ConflictError,
            RuleViolationError,
            AuthenticationError,
        ],
    )
    def test_all_subclasses_are_domain_errors(self, error_type: type[DomainError]) -> None:
        assert issubclass(error_type, DomainError)

    def test_override_does_not_leak_to_class(self) -> None:
        ConflictError("dup", code="email_taken")

        assert ConflictError("other").code == "conflict"
        assert ConflictError.code == "conflict"

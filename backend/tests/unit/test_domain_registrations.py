"""Unit tests for registration decisions in ``domain.registrations``.

Layer: **unit**
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from backend.domain import registrations as rules
from backend.domain.errors import ConflictError, RuleViolationError

pytestmark = pytest.mark.unit

CHECKED_IN = datetime(2026, 3, 2, 12, 30, tzinfo=UTC)


@dataclass
class FakeRegistration:
    """A structurally-typed stand-in for the ORM registration row.

    Mutable on purpose: ``RegistrationState`` is a mutable-field protocol,
    so a frozen dataclass would not satisfy mypy.
    """

    status: str
    checked_in_at: datetime | None = None


class TestDecideRegister:
    """decide_register maps prior state to new/reactivate/error."""

    def test_no_row_is_new(self) -> None:
        assert rules.decide_register(None) == "new"

    def test_cancelled_reactivates(self) -> None:
        assert rules.decide_register("cancelled") == "reactivate"

    @pytest.mark.parametrize("status", ["pending", "approved"])
    def test_active_rows_conflict(self, status: str) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.decide_register(status)
        assert excinfo.value.code == "already_registered"

    def test_rejected_is_final(self) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.decide_register("rejected")
        assert excinfo.value.code == "registration_rejected"


class TestMayCancel:
    """Only pending/approved, not checked in, on a live activity."""

    @pytest.mark.parametrize("status", ["pending", "approved"])
    def test_cancellable(self, status: str) -> None:
        rules.may_cancel(status, None, "published")

    @pytest.mark.parametrize("status", ["rejected", "cancelled"])
    def test_terminal_registration_states(self, status: str) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.may_cancel(status, None, "published")
        assert excinfo.value.code == "cannot_cancel"

    def test_checked_in_is_frozen(self) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.may_cancel("approved", CHECKED_IN, "published")
        assert excinfo.value.code == "cannot_cancel"

    @pytest.mark.parametrize("activity_status", ["completed", "cancelled"])
    def test_terminal_activity_states(self, activity_status: str) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.may_cancel("pending", None, activity_status)
        assert excinfo.value.code == "cannot_cancel"


class TestDecideReview:
    """pending → approve/reject; approved → reject still allowed."""

    def test_pending_approve(self) -> None:
        assert rules.decide_review(FakeRegistration("pending"), "approve") == "approved"

    def test_pending_reject(self) -> None:
        assert rules.decide_review(FakeRegistration("pending"), "reject") == "rejected"

    def test_approved_can_still_be_rejected(self) -> None:
        assert rules.decide_review(FakeRegistration("approved"), "reject") == "rejected"

    def test_approved_cannot_be_reapproved(self) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.decide_review(FakeRegistration("approved"), "approve")
        assert excinfo.value.code == "cannot_review"

    @pytest.mark.parametrize("action", ["approve", "reject"])
    @pytest.mark.parametrize("status", ["rejected", "cancelled"])
    def test_terminal_states_cannot_review(self, status: str, action: str) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.decide_review(FakeRegistration(status), action)
        assert excinfo.value.code == "cannot_review"

    def test_checked_in_cannot_be_reviewed(self) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.decide_review(FakeRegistration("approved", CHECKED_IN), "reject")
        assert excinfo.value.code == "cannot_review_checked_in"

    def test_unknown_action_is_a_rule_violation(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.decide_review(FakeRegistration("pending"), "hold")
        assert excinfo.value.code == "invalid_review_action"


class TestCheckinEligible:
    """Only approved registrations may check in."""

    def test_approved_ok(self) -> None:
        rules.checkin_eligible(FakeRegistration("approved"))

    @pytest.mark.parametrize("status", ["pending", "rejected", "cancelled"])
    def test_not_approved(self, status: str) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.checkin_eligible(FakeRegistration(status))
        assert excinfo.value.code == "registration_not_approved"


class TestCapacity:
    """capacity_available: None is unlimited; else seats left check."""

    def test_unlimited(self) -> None:
        rules.capacity_available(None, 10**9)

    def test_room_left(self) -> None:
        rules.capacity_available(10, 9)

    def test_full(self) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.capacity_available(10, 10)
        assert excinfo.value.code == "activity_full"


class TestNormalizeNote:
    """Optional note: blank → None, ≤500 chars."""

    def test_blank_is_none(self) -> None:
        assert rules.normalize_note(None) is None
        assert rules.normalize_note("   ") is None

    def test_collapsed(self) -> None:
        assert rules.normalize_note("  can   bring \n water ") == "can bring water"

    def test_bound(self) -> None:
        assert rules.normalize_note("n" * 500) == "n" * 500
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_note("n" * 501)
        assert excinfo.value.code == "value_too_long"

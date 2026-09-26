"""Unit tests for activity lifecycle and schedule rules.

Layer: **unit**
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from backend.domain import activities as rules
from backend.domain.errors import ConflictError, RuleViolationError

pytestmark = pytest.mark.unit

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
STARTS = datetime(2026, 3, 2, 12, 0, tzinfo=UTC)
ENDS = datetime(2026, 3, 2, 16, 0, tzinfo=UTC)


@dataclass
class FakeActivity:
    """A structurally-typed stand-in for the ORM ``Activity`` row.

    Mutable on purpose: ``ActivitySchedule`` is a mutable-field protocol,
    so a frozen dataclass would not satisfy mypy.
    """

    status: str = "published"
    registration_opens_at: datetime | None = None
    registration_closes_at: datetime | None = None
    starts_at: datetime = STARTS
    ends_at: datetime = ENDS


class TestTransitions:
    """require_transition walks the TRANSITIONS matrix exactly."""

    @pytest.mark.parametrize(
        ("current", "target"),
        [
            ("draft", "published"),
            ("draft", "cancelled"),
            ("published", "cancelled"),
            ("published", "completed"),
        ],
    )
    def test_allowed(self, current: str, target: str) -> None:
        rules.require_transition(current, target)  # no raise

    @pytest.mark.parametrize(
        ("current", "target"),
        [
            ("draft", "completed"),
            ("draft", "draft"),
            ("published", "draft"),
            ("published", "published"),
            ("cancelled", "draft"),
            ("cancelled", "published"),
            ("cancelled", "completed"),
            ("cancelled", "cancelled"),
            ("completed", "draft"),
            ("completed", "cancelled"),
            ("completed", "completed"),
        ],
    )
    def test_forbidden_and_terminal(self, current: str, target: str) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.require_transition(current, target)
        assert excinfo.value.code == "invalid_transition"

    def test_terminal_states_have_no_outgoing_edges(self) -> None:
        for status in ("cancelled", "completed"):
            for target in rules.ACTIVITY_STATUSES:
                with pytest.raises(ConflictError):
                    rules.require_transition(status, target)


class TestValidateSchedule:
    """Title bounds, awareness, and window coherence."""

    def test_valid_returns_normalized_title(self) -> None:
        title = rules.validate_schedule("  Ngày   hội ", STARTS, ENDS, None, None)
        assert title == "Ngày hội"

    @pytest.mark.parametrize("title", ["ab", " ", "x" * 201])
    def test_invalid_title(self, title: str) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_schedule(title, STARTS, ENDS, None, None)
        assert excinfo.value.code == "invalid_title"

    def test_naive_starts_rejected(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_schedule("Event", datetime(2026, 3, 2), ENDS, None, None)
        assert excinfo.value.code == "naive_datetime"

    def test_naive_ends_and_windows_rejected(self) -> None:
        naive = datetime(2026, 3, 1)
        with pytest.raises(RuleViolationError):
            rules.validate_schedule("Event", STARTS, naive, None, None)
        with pytest.raises(RuleViolationError):
            rules.validate_schedule("Event", STARTS, ENDS, naive, None)
        with pytest.raises(RuleViolationError):
            rules.validate_schedule("Event", STARTS, ENDS, None, naive)

    def test_end_must_follow_start(self) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_schedule("Event", ENDS, ENDS, None, None)  # equal
        assert excinfo.value.code == "invalid_window"
        with pytest.raises(RuleViolationError):
            rules.validate_schedule("Event", ENDS, STARTS, None, None)  # inverted

    def test_close_before_open_rejected(self) -> None:
        opens = STARTS - timedelta(days=1)
        closes = opens - timedelta(hours=1)
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_schedule("Event", STARTS, ENDS, opens, closes)
        assert excinfo.value.code == "invalid_window"

    def test_close_after_start_rejected(self) -> None:
        closes = STARTS + timedelta(minutes=1)
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_schedule("Event", STARTS, ENDS, None, closes)
        assert excinfo.value.code == "invalid_window"

    def test_close_equal_start_is_allowed(self) -> None:
        # closes <= starts_at is inclusive — closing at the start is legal.
        rules.validate_schedule("Event", STARTS, ENDS, None, STARTS)

    def test_open_only_is_allowed(self) -> None:
        rules.validate_schedule("Event", STARTS, ENDS, STARTS - timedelta(days=1), None)


class TestAwardsAndCapacity:
    """Award bounds 0..9999.99 and capacity None-or-1..99_999_999."""

    def test_awards_within_bounds(self) -> None:
        rules.validate_awards(Decimal("0"), Decimal("9999.99"))
        rules.validate_awards(Decimal("9999.99"), Decimal("0"))

    @pytest.mark.parametrize("hours", ["-0.01", "10000", "9999.999"])
    def test_invalid_hours(self, hours: str) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_awards(Decimal(hours), Decimal("0"))
        assert excinfo.value.code == "invalid_hours"

    @pytest.mark.parametrize("points", ["-1", "10000"])
    def test_invalid_points(self, points: str) -> None:
        with pytest.raises(RuleViolationError) as excinfo:
            rules.validate_awards(Decimal("0"), Decimal(points))
        assert excinfo.value.code == "invalid_points"

    def test_capacity(self) -> None:
        assert rules.validate_capacity(None) is None
        assert rules.validate_capacity(1) == 1
        assert rules.validate_capacity(99_999_999) == 99_999_999
        for bad in (0, -5, 100_000_000):
            with pytest.raises(RuleViolationError) as excinfo:
                rules.validate_capacity(bad)
            assert excinfo.value.code == "invalid_capacity"


class TestLocationAndDescription:
    """Optional text fields: blank → None, bound enforced."""

    def test_location(self) -> None:
        assert rules.normalize_location(None) is None
        assert rules.normalize_location("   ") is None
        assert rules.normalize_location("  Sảnh  A ") == "Sảnh A"
        with pytest.raises(RuleViolationError) as excinfo:
            rules.normalize_location("x" * 301)
        assert excinfo.value.code == "value_too_long"

    def test_description_preserves_inner_newlines(self) -> None:
        text = "line one\n\nline two"
        assert rules.normalize_description(f"  {text}  ") == text
        assert rules.normalize_description(None) is None
        assert rules.normalize_description("   ") is None
        with pytest.raises(RuleViolationError):
            rules.normalize_description("x" * 20001)


class TestCheckinWindow:
    """Check-in opens 60 minutes early and closes at the activity end."""

    def test_window_bounds(self) -> None:
        opens, closes = rules.checkin_window(FakeActivity())
        assert opens == STARTS - timedelta(minutes=rules.CHECKIN_EARLY_MINUTES)
        assert closes == ENDS

    def test_exact_open_is_allowed(self) -> None:
        rules.checkin_allowed_at(
            STARTS - timedelta(minutes=rules.CHECKIN_EARLY_MINUTES), FakeActivity()
        )

    def test_exact_close_is_allowed(self) -> None:
        rules.checkin_allowed_at(ENDS, FakeActivity())

    def test_before_window(self) -> None:
        too_early = STARTS - timedelta(minutes=rules.CHECKIN_EARLY_MINUTES, seconds=1)
        with pytest.raises(ConflictError) as excinfo:
            rules.checkin_allowed_at(too_early, FakeActivity())
        assert excinfo.value.code == "checkin_not_started"

    def test_after_window(self) -> None:
        with pytest.raises(ConflictError) as excinfo:
            rules.checkin_allowed_at(ENDS + timedelta(seconds=1), FakeActivity())
        assert excinfo.value.code == "checkin_ended"


class TestRegistrationWindow:
    """Published + inside [opens, closes|starts_at]."""

    def test_published_with_defaults_open_until_start(self) -> None:
        rules.registration_window_open(FakeActivity(), NOW)  # NOW < STARTS

    def test_non_published_is_closed(self) -> None:
        for status in ("draft", "cancelled", "completed"):
            with pytest.raises(ConflictError) as excinfo:
                rules.registration_window_open(FakeActivity(status=status), NOW)
            assert excinfo.value.code == "registration_closed"

    def test_before_opens_is_closed(self) -> None:
        activity = FakeActivity(registration_opens_at=STARTS - timedelta(days=1))
        with pytest.raises(ConflictError) as excinfo:
            rules.registration_window_open(activity, STARTS - timedelta(days=1, seconds=1))
        assert excinfo.value.code == "registration_closed"

    def test_at_opens_is_open(self) -> None:
        opens = STARTS - timedelta(days=1)
        rules.registration_window_open(FakeActivity(registration_opens_at=opens), opens)

    def test_after_closes_is_closed(self) -> None:
        closes = STARTS - timedelta(hours=1)
        activity = FakeActivity(registration_closes_at=closes)
        with pytest.raises(ConflictError) as excinfo:
            rules.registration_window_open(activity, closes + timedelta(seconds=1))
        assert excinfo.value.code == "registration_closed"

    def test_at_closes_is_open_inclusive(self) -> None:
        closes = STARTS - timedelta(hours=1)
        rules.registration_window_open(FakeActivity(registration_closes_at=closes), closes)

    def test_default_close_is_starts_at(self) -> None:
        activity = FakeActivity()  # no explicit window
        rules.registration_window_open(activity, STARTS)  # inclusive
        with pytest.raises(ConflictError):
            rules.registration_window_open(activity, STARTS + timedelta(seconds=1))


class TestLifecycleGuards:
    """can_publish / can_complete / can_edit."""

    def test_can_publish(self) -> None:
        rules.can_publish(FakeActivity(status="draft", ends_at=ENDS), NOW)
        with pytest.raises(ConflictError) as excinfo:
            rules.can_publish(FakeActivity(status="published"), NOW)
        assert excinfo.value.code == "invalid_transition"

    def test_publish_after_end_is_activity_over(self) -> None:
        ended = FakeActivity(status="draft", ends_at=NOW - timedelta(seconds=1))
        with pytest.raises(ConflictError) as excinfo:
            rules.can_publish(ended, NOW)
        assert excinfo.value.code == "activity_over"

    def test_can_complete(self) -> None:
        rules.can_complete(FakeActivity(), STARTS)  # at start
        with pytest.raises(ConflictError) as excinfo:
            rules.can_complete(FakeActivity(), STARTS - timedelta(seconds=1))
        assert excinfo.value.code == "not_started"
        with pytest.raises(ConflictError) as excinfo:
            rules.can_complete(FakeActivity(status="draft"), ENDS)
        assert excinfo.value.code == "invalid_transition"

    def test_can_edit(self) -> None:
        rules.can_edit(FakeActivity(status="draft"))
        rules.can_edit(FakeActivity(status="published"))
        for status in ("cancelled", "completed"):
            with pytest.raises(ConflictError) as excinfo:
                rules.can_edit(FakeActivity(status=status))
            assert excinfo.value.code == "terminal_state"

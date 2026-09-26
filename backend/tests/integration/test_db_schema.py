"""Integration tests for the ORM schema against a real (SQLite) database.

These exercise the mappings end to end — inserts, the n-m association
object (``activity_registrations``) and its proxies, uniqueness rules,
cascading deletes, and the custom column types — against the full schema
created by ``Base.metadata.create_all``.

Layer: **integration**
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable, Coroutine
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from backend.db.models import (
    Activity,
    ActivityRegistration,
    Organization,
    OrgMember,
    User,
    VolunteerRecord,
)
from backend.domain.ids import new_id

pytestmark = pytest.mark.integration

SessionFactory = async_sessionmaker[AsyncSession]


def _run(
    maker: SessionFactory,
    scenario: Callable[[AsyncSession], Coroutine[Any, Any, None]],
) -> None:
    """Run ``scenario(session)`` on a fresh loop with a dedicated session."""
    asyncio.run(_run_scenario(maker, scenario))


async def _run_scenario(
    maker: SessionFactory,
    scenario: Callable[[AsyncSession], Coroutine[Any, Any, None]],
) -> None:
    async with maker() as session:
        await scenario(session)


def _future_window() -> tuple[datetime, datetime]:
    starts = datetime.now(UTC) + timedelta(days=7)
    return starts, starts + timedelta(hours=4)


async def _seed_org_member_activity(
    session: AsyncSession,
) -> tuple[Organization, User, OrgMember, Activity]:
    """Insert the minimal org/user/member/activity graph.

    Ids are minted explicitly with ``new_id()`` — the ``default=new_id``
    column default only fires at INSERT time, so reading ``.id`` of an
    unflushed row would hand back ``None``.
    """
    org = Organization(id=new_id(), code="CLB-A", name="Club Alpha")
    user = User(
        id=new_id(),
        email="member@example.edu",
        password_hash="$argon2id$placeholder",
        full_name="Member One",
    )
    member = OrgMember(id=new_id(), org_id=org.id, user_id=user.id, full_name="Member One")
    starts, ends = _future_window()
    activity = Activity(
        id=new_id(),
        org_id=org.id,
        title="Beach cleanup",
        starts_at=starts,
        ends_at=ends,
        created_by=member.id,
    )
    session.add_all([org, user, member, activity])
    await session.commit()
    return org, user, member, activity


class TestCrudRoundtrip:
    """Rows go in and come back with the right Python types."""

    def test_inserted_rows_roundtrip_types(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            org, user, member, activity = await _seed_org_member_activity(session)

            reloaded_user = await session.get(User, user.id)
            assert reloaded_user is not None
            # Uuid type: RAW/bytes on disk, uuid.UUID in Python.
            assert isinstance(reloaded_user.id, uuid.UUID)
            assert uuid.UUID(str(reloaded_user.id)) == reloaded_user.id
            assert reloaded_user.id.version == 7
            # UtcDateTime: naive UTC on disk, aware UTC in Python.
            assert reloaded_user.created_at.tzinfo is UTC
            assert reloaded_user.is_active is True
            # Defaults supplied Python-side.
            assert member.role == "member"
            assert member.status == "active"
            assert isinstance(member.joined_at, datetime)
            assert activity.status == "draft"
            assert activity.points == Decimal("0")
            assert activity.hours == Decimal("0")
            assert activity.org_id == org.id

        _run(db_sessionmaker, scenario)

    def test_decimal_amounts_persist_exactly(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            starts, ends = _future_window()
            org = Organization(code="CLB-B", name="Club Beta")
            session.add(org)
            await session.flush()
            activity = Activity(
                org_id=org.id,
                title="Blood drive",
                starts_at=starts,
                ends_at=ends,
                points=Decimal("12.34"),
                hours=Decimal("2.50"),
            )
            session.add(activity)
            await session.commit()

            # expire_on_commit=False keeps in-memory attrs; force a real
            # DB read to prove the DecimalAmount hundredths roundtrip.
            await session.refresh(activity)
            assert activity.points == Decimal("12.34")
            assert activity.hours == Decimal("2.5")

        _run(db_sessionmaker, scenario)


class TestAssociationObject:
    """The member<->activity n-m relation via activity_registrations."""

    def test_proxies_reach_both_sides(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            _, _, member, activity = await _seed_org_member_activity(session)
            registration = ActivityRegistration(
                activity_id=activity.id,
                member_id=member.id,
                status="approved",
                note="I can bring supplies",
            )
            session.add(registration)
            await session.commit()

            # Reload through the association object with eager loading —
            # relationships are lazy="raise", so an unloaded access would
            # explode instead of lazily querying.
            reloaded_member = await session.scalar(
                select(OrgMember)
                .where(OrgMember.id == member.id)
                .options(
                    selectinload(OrgMember.registrations).selectinload(
                        ActivityRegistration.activity
                    )
                )
            )
            assert reloaded_member is not None
            member_activities = list(reloaded_member.activities)
            assert [a.id for a in member_activities] == [activity.id]

            reloaded_activity = await session.scalar(
                select(Activity)
                .where(Activity.id == activity.id)
                .options(
                    selectinload(Activity.registrations).selectinload(ActivityRegistration.member)
                )
            )
            assert reloaded_activity is not None
            activity_members = list(reloaded_activity.members)
            assert [m.id for m in activity_members] == [member.id]

            # The association object carries its own columns.
            row = reloaded_activity.registrations[0]
            assert row.status == "approved"
            assert row.note == "I can bring supplies"

        _run(db_sessionmaker, scenario)

    def test_lazy_access_raises_instead_of_loading(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            _, _, member, _ = await _seed_org_member_activity(session)
            reloaded = await session.get(OrgMember, member.id)
            assert reloaded is not None

            with pytest.raises(InvalidRequestError):
                _ = reloaded.registrations

        _run(db_sessionmaker, scenario)

    def test_duplicate_registration_is_rejected(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            _, _, member, activity = await _seed_org_member_activity(session)
            session.add(ActivityRegistration(activity_id=activity.id, member_id=member.id))
            await session.commit()

            duplicate = ActivityRegistration(activity_id=activity.id, member_id=member.id)
            session.add(duplicate)
            with pytest.raises(IntegrityError):
                await session.commit()

        _run(db_sessionmaker, scenario)


class TestDeleteBehaviour:
    """ON DELETE CASCADE/SET NULL behave like schema.sql's constraints."""

    def test_deleting_org_cascades_members_and_activities(
        self, db_sessionmaker: SessionFactory
    ) -> None:
        async def scenario(session: AsyncSession) -> None:
            org, _, member, activity = await _seed_org_member_activity(session)
            session.add(ActivityRegistration(activity_id=activity.id, member_id=member.id))
            await session.commit()

            await session.delete(org)
            await session.commit()

            assert await session.scalar(select(func.count()).select_from(Organization)) == 0
            assert await session.scalar(select(func.count()).select_from(OrgMember)) == 0
            assert await session.scalar(select(func.count()).select_from(Activity)) == 0
            assert await session.scalar(select(func.count()).select_from(ActivityRegistration)) == 0
            # users are independent of orgs — the account survives.
            assert await session.scalar(select(func.count()).select_from(User)) == 1

        _run(db_sessionmaker, scenario)

    def test_deleting_member_nulls_activity_created_by(
        self, db_sessionmaker: SessionFactory
    ) -> None:
        async def scenario(session: AsyncSession) -> None:
            _, _, member, activity = await _seed_org_member_activity(session)

            await session.delete(member)
            await session.commit()

            # The DB did ON DELETE SET NULL — refresh the in-session copy.
            await session.refresh(activity)
            assert activity.created_by is None
            # The user row itself is untouched (SET NULL on user_id).
            assert await session.scalar(select(func.count()).select_from(User)) == 1

        _run(db_sessionmaker, scenario)


class TestVolunteerRecord:
    """Achievement records link back through registrations or standalone."""

    def test_record_with_and_without_registration(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            _, _, member, activity = await _seed_org_member_activity(session)
            registration = ActivityRegistration(
                activity_id=activity.id, member_id=member.id, status="approved"
            )
            session.add(registration)
            await session.flush()

            linked = VolunteerRecord(
                member_id=member.id,
                activity_id=activity.id,
                registration_id=registration.id,
                title="Beach cleanup",
                hours=Decimal("4.5"),
                points=Decimal("10"),
            )
            standalone = VolunteerRecord(
                member_id=member.id,
                title="External first-aid training",
                hours=Decimal("8"),
            )
            session.add_all([linked, standalone])
            await session.commit()

            reloaded = await session.get(VolunteerRecord, linked.id)
            assert reloaded is not None
            assert reloaded.hours == Decimal("4.5")
            assert reloaded.points == Decimal("10")
            assert reloaded.registration_id == registration.id
            assert isinstance(reloaded.awarded_on, date)

            # uq_volrec_reg: at most one record per registration.
            dupe = VolunteerRecord(
                member_id=member.id,
                registration_id=registration.id,
                title="duplicate",
            )
            session.add(dupe)
            with pytest.raises(IntegrityError):
                await session.commit()

        _run(db_sessionmaker, scenario)

    def test_pragma_foreign_keys_is_on(self, db_sessionmaker: SessionFactory) -> None:
        async def scenario(session: AsyncSession) -> None:
            result = await session.execute(text("PRAGMA foreign_keys"))
            assert result.scalar() == 1

        _run(db_sessionmaker, scenario)

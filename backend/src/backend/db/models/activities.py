"""ORM models for volunteer activities and their outcomes.

``activity_registrations`` is the association object for the n-m relation
between members (students) and activities: it carries the extra columns a
pure join table cannot — ``status`` (pending/approved/…), ``note``,
``checked_in_at``, ``reviewed_by``/``reviewed_at``. Both endpoints expose
it through association proxies::

    member.activities   # activities this member registered for
    activity.members    # members registered for this activity

``volunteer_records`` is the official achievement record (ghi nhận thành
tích); its ``activity_id`` is nullable because external service can be
recorded standalone.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    column,
)
from sqlalchemy.ext.associationproxy import AssociationProxy, association_proxy
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.base import Base, business_today, utcnow
from backend.db.types import DecimalAmount, UtcDateTime, Uuid
from backend.domain.ids import new_id

if TYPE_CHECKING:
    from backend.db.models.accounts import Organization, OrgMember


class Activity(Base):
    """A volunteer activity/event (đợt hoạt động tình nguyện).

    ``points``/``hours`` are the *default* awards a completed participation
    earns; the recorded award on :class:`VolunteerRecord` may differ.
    """

    __tablename__ = "activities"
    __table_args__ = (
        # "Unique when present" — mirrors the CASE-based function index in
        # schema.sql; a partial unique index expresses it on SQLite.
        Index(
            "uq_activities_checkin",
            "org_id",
            "checkin_code",
            unique=True,
            sqlite_where=column("checkin_code").is_not(None),
        ),
        Index("ix_activities_org_list", "org_id", "status", "starts_at"),
        Index("ix_activities_feed", "status", "starts_at"),
        Index("ix_activities_checkin", "checkin_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    capacity: Mapped[int | None] = mapped_column(Integer)
    points: Mapped[Decimal] = mapped_column(DecimalAmount, default=Decimal("0"))
    hours: Mapped[Decimal] = mapped_column(DecimalAmount, default=Decimal("0"))
    # FK to images.id lives in schema.sql (table unmapped this phase).
    poster_image_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    registration_opens_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    registration_closes_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    starts_at: Mapped[datetime] = mapped_column(UtcDateTime)
    ends_at: Mapped[datetime] = mapped_column(UtcDateTime)
    checkin_code: Mapped[str | None] = mapped_column(String(12))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("org_members.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    organization: Mapped[Organization] = relationship(
        back_populates="activities",
        foreign_keys=[org_id],
        lazy="raise",
    )
    creator: Mapped[OrgMember | None] = relationship(
        foreign_keys=[created_by],
        lazy="raise",
    )
    registrations: Mapped[list[ActivityRegistration]] = relationship(
        back_populates="activity",
        foreign_keys="ActivityRegistration.activity_id",
        lazy="raise",
        passive_deletes=True,
    )
    members: AssociationProxy[list[OrgMember]] = association_proxy("registrations", "member")


class ActivityRegistration(Base):
    """A member signing up for an activity — the n-m association object."""

    __tablename__ = "activity_registrations"
    __table_args__ = (
        UniqueConstraint("activity_id", "member_id", name="uq_registrations"),
        Index("ix_registrations_member", "member_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("activities.id", ondelete="CASCADE")
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("org_members.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(String(20), default="pending")
    note: Mapped[str | None] = mapped_column(String(500))
    checked_in_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("org_members.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    activity: Mapped[Activity] = relationship(
        back_populates="registrations",
        foreign_keys=[activity_id],
        lazy="raise",
    )
    member: Mapped[OrgMember] = relationship(
        back_populates="registrations",
        foreign_keys=[member_id],
        lazy="raise",
    )
    reviewer: Mapped[OrgMember | None] = relationship(
        foreign_keys=[reviewed_by],
        lazy="raise",
    )


class VolunteerRecord(Base):
    """The official achievement record: what a member earned.

    Usually derives from an attended registration (``registration_id``),
    but may be recorded standalone — then ``activity_id`` is NULL.
    """

    __tablename__ = "volunteer_records"
    __table_args__ = (
        UniqueConstraint("registration_id", name="uq_volrec_reg"),
        # One record per member per activity; standalone rows (activity_id
        # NULL) are exempt — mirrors the CASE index via a partial index.
        Index(
            "uq_volrec_member_activity",
            "member_id",
            "activity_id",
            unique=True,
            sqlite_where=column("activity_id").is_not(None),
        ),
        Index("ix_volrec_member", "member_id", "awarded_on"),
        Index("ix_volrec_activity", "activity_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("org_members.id", ondelete="CASCADE")
    )
    activity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("activities.id", ondelete="SET NULL")
    )
    registration_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("activity_registrations.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(200))
    hours: Mapped[Decimal | None] = mapped_column(DecimalAmount)
    points: Mapped[Decimal] = mapped_column(DecimalAmount, default=Decimal("0"))
    awarded_on: Mapped[date] = mapped_column(Date, default=business_today)
    note: Mapped[str | None] = mapped_column(String(1000))
    evidence_url: Mapped[str | None] = mapped_column(String(500))
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("org_members.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    member: Mapped[OrgMember] = relationship(
        foreign_keys=[member_id],
        lazy="raise",
    )
    activity: Mapped[Activity | None] = relationship(
        foreign_keys=[activity_id],
        lazy="raise",
    )
    registration: Mapped[ActivityRegistration | None] = relationship(
        foreign_keys=[registration_id],
        lazy="raise",
    )
    recorder: Mapped[OrgMember | None] = relationship(
        foreign_keys=[recorded_by],
        lazy="raise",
    )

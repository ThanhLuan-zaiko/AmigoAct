"""ORM models for accounts: users, organizations, and the org roster.

Mirrors ``schema.sql`` exactly — same table and column names, nullability,
string lengths, and delete behaviour. Columns that reference ``images``
(``avatar_image_id``, ``logo_image_id``) are mapped as plain UUIDs this
phase because the ``images`` table is not yet mapped; the real FK
constraints still live in ``schema.sql``.

Unique-presence semantics: Oracle expresses "unique when present" via
CASE-based function indexes (``uq_org_members_user``,
``uq_org_members_student``). The metadata declares equivalent *partial*
unique indexes for SQLite via ``sqlite_where`` so the test schema enforces
the same rule.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, String, column
from sqlalchemy.ext.associationproxy import AssociationProxy, association_proxy
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.base import Base, utcnow
from backend.db.types import UtcDateTime, Uuid
from backend.domain.ids import new_id

if TYPE_CHECKING:
    from backend.db.models.activities import Activity, ActivityRegistration


class User(Base):
    """A global login account (org admins, managers, volunteers)."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(24))
    # FK to images.id lives in schema.sql (table unmapped this phase).
    avatar_image_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    memberships: Mapped[list[OrgMember]] = relationship(
        back_populates="user",
        foreign_keys="OrgMember.user_id",
        lazy="raise",
        # FK is ON DELETE SET NULL; let the database own delete behaviour
        # instead of the ORM issuing UPDATEs.
        passive_deletes=True,
    )


class Organization(Base):
    """A Đoàn trường, student club, or any org running activities."""

    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(String(2000))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    # FK to images.id lives in schema.sql (table unmapped this phase).
    logo_image_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    members: Mapped[list[OrgMember]] = relationship(
        back_populates="organization",
        foreign_keys="OrgMember.org_id",
        lazy="raise",
        passive_deletes=True,  # ON DELETE CASCADE lives in the database
    )
    activities: Mapped[list[Activity]] = relationship(
        back_populates="organization",
        foreign_keys="Activity.org_id",
        lazy="raise",
        passive_deletes=True,
    )


class OrgMember(Base):
    """One roster row per person per org (danh sách đoàn viên).

    ``user_id`` stays NULL until the member registers in the app, so a
    roster can be imported before accounts exist. Student metadata is
    org-scoped and therefore lives here rather than on :class:`User`.
    """

    __tablename__ = "org_members"
    __table_args__ = (
        # "Unique when present" — mirrors the CASE-based function indexes
        # in schema.sql; partial indexes express it natively on SQLite.
        Index(
            "uq_org_members_user",
            "org_id",
            "user_id",
            unique=True,
            sqlite_where=column("user_id").is_not(None),
        ),
        Index(
            "uq_org_members_student",
            "org_id",
            "student_code",
            unique=True,
            sqlite_where=column("student_code").is_not(None),
        ),
        Index("ix_org_members_org", "org_id", "status"),
        Index("ix_org_members_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_id)
    org_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    role: Mapped[str] = mapped_column(String(20), default="member")
    status: Mapped[str] = mapped_column(String(20), default="active")
    full_name: Mapped[str] = mapped_column(String(120))
    student_code: Mapped[str | None] = mapped_column(String(32))
    class_name: Mapped[str | None] = mapped_column(String(64))
    faculty: Mapped[str | None] = mapped_column(String(120))
    joined_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)

    organization: Mapped[Organization] = relationship(
        back_populates="members",
        foreign_keys=[org_id],
        lazy="raise",
    )
    user: Mapped[User | None] = relationship(
        back_populates="memberships",
        foreign_keys=[user_id],
        lazy="raise",
    )
    registrations: Mapped[list[ActivityRegistration]] = relationship(
        back_populates="member",
        foreign_keys="ActivityRegistration.member_id",
        lazy="raise",
        passive_deletes=True,
    )
    # The n-m relation at the heart of the assignment: members (students)
    # participate in many activities, and each activity has many members —
    # through the activity_registrations association object.
    activities: AssociationProxy[list[Activity]] = association_proxy("registrations", "activity")

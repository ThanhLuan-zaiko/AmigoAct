"""Participation certificates — context loading and PDF rendering.

``get_record_for_certificate`` resolves the row into a
:class:`CertificateContext` — everything the PDF needs, already
authorized. ``render_certificate_pdf`` then draws an A4 certificate
entirely from that context (no other data source is consulted), in
Vietnamese, using the bundled Be Vietnam Pro fonts (OFL-licensed, stored
under ``backend/assets/fonts/``).
"""

from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import get_settings
from backend.db.base import business_today
from backend.db.models import (
    Activity,
    ActivityRegistration,
    Organization,
    OrgMember,
    User,
    VolunteerRecord,
)
from backend.domain.errors import NotFoundError, PermissionDeniedError
from backend.domain.organizations import is_manager
from backend.services.events import DomainEvent
from backend.services.memberships import get_membership

FONTS_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"
_FONT_REGULAR = FONTS_DIR / "BeVietnamPro-Regular.ttf"
_FONT_BOLD = FONTS_DIR / "BeVietnamPro-Bold.ttf"


@dataclass(frozen=True)
class CertificateContext:
    """Everything a certificate certifies — the render input, pre-authorized."""

    record_id: uuid.UUID
    member_name: str
    student_code: str | None
    class_name: str | None
    org_name: str
    org_code: str
    title: str
    hours: Decimal | None
    points: Decimal
    awarded_on: date
    checked_in_at: datetime | None
    issued_on: date


async def get_record_for_certificate(
    session: AsyncSession, record_id: uuid.UUID, user: User
) -> tuple[CertificateContext, list[DomainEvent]]:
    """Resolve ``record_id`` into a render context for an authorized caller.

    Allowed when the caller owns the record (their member row) or holds a
    manager/admin role in the record's org.

    Raises:
        NotFoundError: ``record_not_found`` for a missing record (or a
            broken member/org chain, which the FK graph forbids anyway).
        PermissionDeniedError: ``insufficient_role`` for everyone else.
    """
    record = await session.get(VolunteerRecord, record_id)
    if record is None:
        raise NotFoundError("record not found", code="record_not_found")
    member = await session.get(OrgMember, record.member_id)
    if member is None:
        raise NotFoundError("record not found", code="record_not_found")
    if member.user_id != user.id:
        staff = await get_membership(session, member.org_id, user.id)
        if staff is None or not is_manager(staff.role):
            raise PermissionDeniedError(
                "requires the record owner or org staff",
                code="insufficient_role",
            )
    org = await session.get(Organization, member.org_id)
    if org is None:
        raise NotFoundError("record not found", code="record_not_found")
    activity = (
        await session.get(Activity, record.activity_id) if record.activity_id is not None else None
    )
    checked_in_at: datetime | None = None
    if record.registration_id is not None:
        registration = await session.get(ActivityRegistration, record.registration_id)
        if registration is not None:
            checked_in_at = registration.checked_in_at
    return (
        CertificateContext(
            record_id=record.id,
            member_name=member.full_name,
            student_code=member.student_code,
            class_name=member.class_name,
            org_name=org.name,
            org_code=org.code,
            title=activity.title if activity is not None else record.title,
            hours=record.hours,
            points=record.points,
            awarded_on=record.awarded_on,
            checked_in_at=checked_in_at,
            issued_on=business_today(),
        ),
        [],
    )


def _format_decimal(value: Decimal) -> str:
    """Render an award amount plainly: ``12.50``→``"12.5"``, never ``1E+2``."""
    return format(value.normalize(), "f")


def _nfc(text: str) -> str:
    """Compose Vietnamese input to NFC so glyphs render precomposed."""
    return unicodedata.normalize("NFC", text)


def _line(pdf: FPDF, height: float, text: str) -> None:
    """Write one centred line of wrapped text, then move to the next row."""
    pdf.multi_cell(0, height, text, align=Align.C, new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def render_certificate_pdf(ctx: CertificateContext) -> bytes:
    """Render an A4 portrait participation certificate from ``ctx``.

    Every printable string comes from the context — the renderer invents
    nothing beyond fixed Vietnamese labels. Long names/titles wrap via
    ``multi_cell``; short labels stay on single centred lines.
    """
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    pdf.add_font("bvp", "", str(_FONT_REGULAR))
    pdf.add_font("bvp", "B", str(_FONT_BOLD))

    pdf.set_font("bvp", "B", 13)
    _line(pdf, 7, _nfc(ctx.org_name))
    pdf.set_font("bvp", "", 9)
    _line(pdf, 5, f"MÃ TỔ CHỨC: {ctx.org_code}")
    pdf.ln(14)

    pdf.set_font("bvp", "B", 24)
    _line(pdf, 12, "CHỨNG NHẬN TÌNH NGUYỆN")
    pdf.ln(8)

    pdf.set_font("bvp", "", 12)
    _line(pdf, 7, "Chứng nhận")
    pdf.set_font("bvp", "B", 26)
    _line(pdf, 12, _nfc(ctx.member_name))

    identifiers = [
        part
        for part in (
            f"MSSV: {ctx.student_code}" if ctx.student_code else None,
            f"Lớp: {ctx.class_name}" if ctx.class_name else None,
        )
        if part is not None
    ]
    if identifiers:
        pdf.set_font("bvp", "", 11)
        _line(pdf, 6, _nfc("   ".join(identifiers)))
    pdf.ln(6)

    pdf.set_font("bvp", "", 12)
    _line(pdf, 7, "đã tham gia hoạt động")
    pdf.set_font("bvp", "B", 15)
    _line(pdf, 9, _nfc(ctx.title))
    pdf.ln(4)

    pdf.set_font("bvp", "", 12)
    award_line = (
        f"Số giờ tình nguyện: {_format_decimal(ctx.hours)} — Số điểm: {_format_decimal(ctx.points)}"
        if ctx.hours is not None
        else f"Số điểm: {_format_decimal(ctx.points)}"
    )
    _line(pdf, 7, award_line)
    if ctx.checked_in_at is not None:
        attended = ctx.checked_in_at.astimezone(ZoneInfo(get_settings().timezone))
        _line(pdf, 7, f"Ngày tham gia: {attended:%d/%m/%Y}")
    pdf.ln(4)
    _line(pdf, 7, f"Ngày cấp: {ctx.issued_on:%d/%m/%Y}")

    pdf.set_y(-28)
    pdf.set_font("bvp", "", 8)
    _line(pdf, 5, f"Mã xác thực: {ctx.record_id}")
    return bytes(pdf.output())

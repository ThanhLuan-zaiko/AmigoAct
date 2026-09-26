"""Volunteer-record endpoints: member read, staff manage, certificates.

Routers stay thin — validation lives in :mod:`backend.domain.records`,
persistence and authorization in :mod:`backend.services.records`,
:mod:`backend.services.record_admin`, and
:mod:`backend.services.certificates`. Mutations publish the returned
``record.changed`` events post-commit.
"""

from __future__ import annotations

import uuid
from typing import cast

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import get_current_user
from backend.api.events import publish_events
from backend.api.schemas.orgs import OrgRef
from backend.api.schemas.records import (
    ManualRecordRequest,
    MemberRecordsResponse,
    MyRecordRow,
    MyRecordsResponse,
    OrgAwardTotalOut,
    RecordMemberRef,
    RecordOut,
    RecordResponse,
    RecordTotals,
    RecordUpdateRequest,
)
from backend.api.schemas.registrations import ActivityStatusRef, RegistrationActivityRef
from backend.database import get_session
from backend.db.models import Activity, User, VolunteerRecord
from backend.services import certificates, record_admin, records
from backend.services.members import UNSET
from backend.services.memberships import require_org_role

router = APIRouter(tags=["records"])


def _record_out(record: VolunteerRecord) -> RecordOut:
    """Map a ``VolunteerRecord`` row to its response schema."""
    return RecordOut.model_validate(record)


def _activity_ref(activity: Activity | None) -> RegistrationActivityRef | None:
    """Map an optional ``Activity`` to its inlined reference."""
    if activity is None:
        return None
    return RegistrationActivityRef(
        id=activity.id,
        title=activity.title,
        starts_at=activity.starts_at,
        ends_at=activity.ends_at,
        status=cast(ActivityStatusRef, activity.status),
    )


@router.get("/me/records")
async def my_records(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MyRecordsResponse:
    """Every record the caller holds, with totals and per-org breakdown."""
    result, events = await records.my_records(session, user)
    await publish_events(request, events)
    return MyRecordsResponse(
        totals=RecordTotals(hours=result.total_hours, points=result.total_points),
        by_org=[
            OrgAwardTotalOut(
                org=OrgRef.model_validate(total.org),
                hours=total.hours,
                points=total.points,
            )
            for total in result.by_org
        ],
        records=[
            MyRecordRow(
                record=_record_out(row.record),
                activity=_activity_ref(row.activity),
                org=OrgRef.model_validate(row.org),
            )
            for row in result.rows
        ],
    )


@router.get("/orgs/{org_id}/members/{member_id}/records")
async def list_member_records(
    org_id: uuid.UUID,
    member_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MemberRecordsResponse:
    """List one member's records; managers and admins of the org only."""
    staff = await require_org_role(session, org_id, user.id, "manager")
    result, events = await records.member_records(session, staff, member_id)
    await publish_events(request, events)
    return MemberRecordsResponse(
        member=RecordMemberRef(
            member_id=result.member.id,
            full_name=result.member.full_name,
            student_code=result.member.student_code,
            class_name=result.member.class_name,
            faculty=result.member.faculty,
            email=result.email,
        ),
        records=[_record_out(record) for record in result.records],
    )


@router.post("/orgs/{org_id}/members/{member_id}/records", status_code=201)
async def create_member_record(
    org_id: uuid.UUID,
    member_id: uuid.UUID,
    body: ManualRecordRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RecordResponse:
    """Record standalone service for a member; managers and admins only."""
    staff = await require_org_role(session, org_id, user.id, "manager")
    record, events = await record_admin.create_manual_record(
        session,
        staff,
        member_id,
        title=body.title,
        hours=body.hours,
        points=body.points,
        awarded_on=body.awarded_on,
        note=body.note,
        evidence_url=body.evidence_url,
        activity_id=body.activity_id,
    )
    await publish_events(request, events)
    return RecordResponse(record=_record_out(record))


@router.patch("/records/{record_id}")
async def update_record(
    record_id: uuid.UUID,
    body: RecordUpdateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RecordResponse:
    """Edit a record's award fields; staff of the record's org only."""
    provided = body.model_fields_set
    patch = record_admin.RecordPatch(
        title=body.title if "title" in provided else UNSET,
        hours=body.hours if "hours" in provided else UNSET,
        points=body.points if "points" in provided else UNSET,
        awarded_on=body.awarded_on if "awarded_on" in provided else UNSET,
        note=body.note if "note" in provided else UNSET,
        evidence_url=body.evidence_url if "evidence_url" in provided else UNSET,
    )
    record, events = await record_admin.update_record(session, user, record_id, patch)
    await publish_events(request, events)
    return RecordResponse(record=_record_out(record))


@router.delete("/records/{record_id}", status_code=204)
async def delete_record(
    record_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    """Delete a record; staff of the record's org only."""
    _, events = await record_admin.delete_record(session, user, record_id)
    await publish_events(request, events)


@router.get("/records/{record_id}/certificate")
async def record_certificate(
    record_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    """Download the participation certificate PDF; owner or org staff."""
    ctx, _events = await certificates.get_record_for_certificate(session, record_id, user)
    pdf_bytes = certificates.render_certificate_pdf(ctx)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (f'attachment; filename="chung-nhan-{record_id}.pdf"'),
            "Cache-Control": "private, no-store",
        },
    )

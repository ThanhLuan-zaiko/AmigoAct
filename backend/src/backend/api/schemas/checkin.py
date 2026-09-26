"""Request schemas for the member-facing check-in endpoint."""

from __future__ import annotations

from pydantic import BaseModel


class CheckinRequest(BaseModel):
    """Body of ``POST /activities/{id}/checkin`` — the typed/QR code."""

    code: str

"""Push service-emitted domain events onto the WebSocket channel.

Services return ``(result, events)``; routers call :func:`publish_events`
after the service returns (post-commit) so clients never learn about a
change that could still roll back.
"""

from __future__ import annotations

from collections.abc import Iterable

from fastapi import Request

from backend.services.events import DomainEvent
from backend.websocket import ConnectionManager


async def publish_events(request: Request, events: Iterable[DomainEvent]) -> None:
    """Fan every event out to its target users' open sockets.

    ``user_ids`` are sent as strings — the connection manager indexes
    sockets by the JWT ``sub`` claim, which is the user's UUID string.
    """
    manager: ConnectionManager = request.app.state.ws_manager
    for event in events:
        await manager.send_to_users(
            (str(user_id) for user_id in event.user_ids),
            {"type": event.type, "data": event.data},
        )

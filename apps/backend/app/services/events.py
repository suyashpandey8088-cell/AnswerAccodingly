from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from datetime import datetime, timezone
from typing import AsyncIterator

from ..schemas.run import RunEvent


class EventHub:
    """In-process live fan-out with bounded replay history; SQLite remains authoritative."""

    def __init__(self) -> None:
        self._history: dict[str, list[RunEvent]] = defaultdict(list)
        self._subscribers: dict[str, set[asyncio.Queue[RunEvent]]] = defaultdict(set)
        self._sequence: dict[str, int] = defaultdict(int)

    def publish(self, run_id: str, event: str, data: dict) -> RunEvent:
        self._sequence[run_id] += 1
        item = RunEvent(
            event=event,
            run_id=run_id,
            sequence=self._sequence[run_id],
            timestamp=datetime.now(timezone.utc),
            data=data,
        )
        history = self._history[run_id]
        history.append(item)
        if len(history) > 1_000:
            del history[: len(history) - 1_000]
        for queue in list(self._subscribers[run_id]):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(item)
        return item

    def subscribe(self, run_id: str) -> tuple[list[RunEvent], asyncio.Queue[RunEvent]]:
        queue: asyncio.Queue[RunEvent] = asyncio.Queue(maxsize=100)
        history = list(self._history[run_id])
        self._subscribers[run_id].add(queue)
        return history, queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue[RunEvent]) -> None:
        self._subscribers[run_id].discard(queue)

    @staticmethod
    def encode(event: RunEvent) -> str:
        payload = json.dumps(event.data, ensure_ascii=False, separators=(",", ":"))
        return f"id: {event.sequence}\nevent: {event.event}\ndata: {payload}\n\n"

    async def stream(self, run_id: str) -> AsyncIterator[str]:
        history, queue = self.subscribe(run_id)
        try:
            for item in history:
                yield self.encode(item)
                if item.event in {"run.completed", "run.cancelled", "run.failed"}:
                    return
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                    yield self.encode(item)
                    if item.event in {"run.completed", "run.cancelled", "run.failed"}:
                        break
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self.unsubscribe(run_id, queue)

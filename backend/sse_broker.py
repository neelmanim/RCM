"""
sse_broker.py — In-memory SSE pub/sub broker
=============================================

Manages a registry of active SSE subscriber queues, keyed by user_id.

Design decisions:
  - asyncio.Queue per subscriber (not a broadcast list) so slow readers
    don't block fast ones and each connection gets its own backpressure.
  - Multiple concurrent connections per user are supported (e.g. two
    browser tabs) — publish() fans out to ALL queues for that user.
  - Queues are bounded (maxsize=50) to prevent unbounded memory growth
    if a client is lagging.
  - The broker is a module-level singleton (no DI needed for a
    single-process FastAPI server).
  - Thread safety: all writes happen on the asyncio event loop thread
    (FastAPI is async), so no locking is required.

Usage:
    # In SSE route:
    queue = sse_broker.subscribe(user_id)
    try:
        while True:
            event = await asyncio.wait_for(queue.get(), timeout=30)
            yield f"data: {json.dumps(event)}\\n\\n"
    finally:
        sse_broker.unsubscribe(user_id, queue)

    # In webhook / dialer route:
    await sse_broker.publish(user_id, {"type": "CALL_STATUS", ...})
"""

import asyncio
import logging
from collections import defaultdict
from typing import Dict, Set

logger = logging.getLogger(__name__)

# Registry: user_id → set of asyncio.Queue
_subscribers: Dict[int, Set[asyncio.Queue]] = defaultdict(set)

QUEUE_MAXSIZE = 50  # events; drop oldest if client is lagging


def subscribe(user_id: int) -> asyncio.Queue:
    """
    Register a new SSE subscriber for the given user.
    Returns a bounded asyncio.Queue the caller should read from.
    """
    q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
    _subscribers[user_id].add(q)
    logger.debug(
        "[SSEBroker] subscribe user_id=%s  total_queues=%s",
        user_id, len(_subscribers[user_id])
    )
    return q


def unsubscribe(user_id: int, queue: asyncio.Queue) -> None:
    """
    Remove the subscriber queue after the SSE connection closes.
    Safe to call even if the queue was already removed.
    """
    _subscribers[user_id].discard(queue)
    if not _subscribers[user_id]:
        del _subscribers[user_id]
    logger.debug(
        "[SSEBroker] unsubscribe user_id=%s  remaining=%s",
        user_id, len(_subscribers.get(user_id, set()))
    )


async def publish(user_id: int, event: dict) -> int:
    """
    Fan-out an event dict to all active SSE queues for user_id.

    Returns the number of queues that received the message.
    If a queue is full (slow client), the event is dropped for that
    subscriber and a warning is logged — we never block the webhook.
    """
    queues = list(_subscribers.get(user_id, set()))
    if not queues:
        logger.debug(
            "[SSEBroker] publish user_id=%s: no subscribers (event=%s)",
            user_id, event.get("type", "?")
        )
        return 0

    delivered = 0
    for q in queues:
        try:
            q.put_nowait(event)
            delivered += 1
        except asyncio.QueueFull:
            logger.warning(
                "[SSEBroker] Queue full for user_id=%s — dropping event %s",
                user_id, event.get("type", "?")
            )
    logger.debug(
        "[SSEBroker] publish user_id=%s event=%s delivered=%s/%s",
        user_id, event.get("type", "?"), delivered, len(queues)
    )
    return delivered


def subscriber_count(user_id: int) -> int:
    """Return number of active SSE connections for a user (for testing/monitoring)."""
    return len(_subscribers.get(user_id, set()))


def total_subscribers() -> int:
    """Return total number of active SSE connections across all users."""
    return sum(len(qs) for qs in _subscribers.values())

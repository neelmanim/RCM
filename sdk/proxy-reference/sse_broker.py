"""
sse_broker.py — In-memory SSE pub/sub broker (SDK Reference Proxy)
==================================================================
Adapted from RCM's sse_broker.py — call_id-keyed (not user_id-keyed)
since SDK customers don't have a user session concept.

Design:
  - asyncio.Queue per subscriber, keyed by call_id (or "global").
  - publish_all() fans out to ALL active queues (browser tab + webhook).
  - Bounded queues (maxsize=50) prevent memory bloat.
"""

import asyncio
import logging
from collections import defaultdict
from typing import Dict, Set

logger = logging.getLogger(__name__)

# Registry: channel_key → set of asyncio.Queue
# channel_key is a call_id or "global"
_subscribers: Dict[str, Set[asyncio.Queue]] = defaultdict(set)

QUEUE_MAXSIZE = 50


def subscribe(channel_key: str) -> asyncio.Queue:
    """Register a new SSE subscriber for the given call_id (or 'global')."""
    q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
    _subscribers[channel_key].add(q)
    logger.debug("[SSEBroker] subscribe key=%s total=%s", channel_key, len(_subscribers[channel_key]))
    return q


def unsubscribe(channel_key: str, queue: asyncio.Queue) -> None:
    """Deregister a subscriber queue."""
    queues = _subscribers.get(channel_key)
    if queues:
        queues.discard(queue)
        if not queues:
            del _subscribers[channel_key]
    logger.debug("[SSEBroker] unsubscribe key=%s", channel_key)


async def publish(channel_key: str, event: dict) -> int:
    """
    Publish an event to all subscribers for a specific call_id.
    Returns the number of queues that received the event.
    """
    queues = list(_subscribers.get(channel_key, []))
    sent = 0
    for q in queues:
        try:
            q.put_nowait(event)
            sent += 1
        except asyncio.QueueFull:
            logger.warning("[SSEBroker] queue full for key=%s — dropping event", channel_key)
    return sent


async def publish_all(event: dict) -> int:
    """
    Publish an event to ALL active subscribers (all call_ids + global).
    Used by the webhook receiver which doesn't know which browser tab to target.
    """
    all_queues = [q for qs in _subscribers.values() for q in qs]
    sent = 0
    for q in all_queues:
        try:
            q.put_nowait(event)
            sent += 1
        except asyncio.QueueFull:
            logger.warning("[SSEBroker] queue full — dropping broadcast event")
    logger.debug("[SSEBroker] publish_all: %s queues received event", sent)
    return sent


def subscriber_count() -> int:
    """Return total number of active subscriber queues."""
    return sum(len(qs) for qs in _subscribers.values())

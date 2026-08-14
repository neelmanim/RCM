"""
poller.py — Background call status poller
=========================================
When RCM webhooks are NOT configured (the default for most SDK customers),
this poller periodically checks active call status and publishes results into the
SSE broker — providing equivalent real-time status delivery.

The poller is started at app startup (via lifespan in main.py) and runs for the
entire lifetime of the process.

Architecture:
  - Single asyncio task — zero threads.
  - Polls every POLL_INTERVAL_S seconds.
  - One RCM GET /calls/{call_id}/status per active call.
  - Publishes CALL_STATUS events → SSE broker → browser SDK.
  - Terminal calls are automatically removed from the active registry.
"""

import asyncio
import logging
from typing import Callable

logger = logging.getLogger(__name__)

POLL_INTERVAL_S = 2   # seconds between each polling sweep

# These status values indicate the call is terminal (remove from active registry)
TERMINAL_STATUSES = {
    "CALL_ENDED", "CALL_FAILED", "CALL_MISSED",
    "disconnected", "ended", "failed", "completed",
    "no_answer", "cancelled", "busy",
}


async def start_polling(rcm_get: Callable, sse_broker) -> None:
    """
    Main polling loop. Imported and started as an asyncio task in main.py.

    Args:
        rcm_get: Async function to GET from RCM API.
                        Signature: async def rcm_get(path, params) -> dict
        sse_broker:     The sse_broker module (publish_all, etc.)
    """
    logger.info("[Poller] Started — polling interval: %ss", POLL_INTERVAL_S)

    # Import _active_calls from main at runtime to avoid circular import.
    # The poller reads this dict to know which calls to track.
    import main as _main

    while True:
        try:
            active = dict(_main._active_calls)  # snapshot to avoid mutation during iteration

            for call_id, meta in active.items():
                try:
                    result = await rcm_get(f"/calls/{call_id}/status")
                    raw_status = str(result.get("status") or result.get("state") or "")
                    duration   = int(result.get("duration") or result.get("call_duration") or 0)

                    if not raw_status:
                        continue

                    event = {
                        "type":     "CALL_STATUS",
                        "call_id":  call_id,
                        "status":   raw_status,
                        "duration": duration,
                    }
                    await sse_broker.publish_all(event)

                    # Terminal → remove from registry so we stop polling it
                    if raw_status in TERMINAL_STATUSES:
                        _main._active_calls.pop(call_id, None)
                        logger.info("[Poller] Call %s terminal (%s) — deregistered", call_id, raw_status)

                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    # Non-fatal — log and continue polling other calls
                    logger.debug("[Poller] Error polling %s: %s", call_id, e)

        except asyncio.CancelledError:
            logger.info("[Poller] Cancelled — shutting down")
            return
        except Exception as e:
            logger.error("[Poller] Unexpected error: %s", e)

        await asyncio.sleep(POLL_INTERVAL_S)


def stop_polling():
    """No-op — cancellation is handled via the asyncio task in main.py lifespan."""
    pass

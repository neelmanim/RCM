"""
Shared application state — avoids circular imports between main.py and route modules.
Set by the startup background thread once all schema migrations complete.
"""
from datetime import datetime, timezone

startup_complete: bool = False
startup_time: datetime = datetime.now(timezone.utc)   # set at import time = process start

# Set at the top of every journey_engine.tick() call — lets monitoring_routes
# detect a poller that's silently stopped ticking (crashed thread, swallowed
# exception) even though the generic scheduler_alive check ("is *some* timer
# thread alive") would still report healthy.
last_journey_tick_at = None

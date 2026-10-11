"""Small shared time helpers."""
from datetime import timezone


def as_utc(dt):
    """SQLite hands back naive datetimes; treat them as UTC like Postgres does. None stays None."""
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)

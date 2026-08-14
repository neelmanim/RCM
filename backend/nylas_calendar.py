# ── nylas_calendar.py — Nylas v3 Calendar API helpers ───────────────────────
"""
Raw Nylas Calendar HTTP calls, shared by:
  - routes/call_routes.py::log_call — creates a real calendar event + invite
    when an SDR logs a "Meeting Booked" outcome.
  - routes/email_routes.py's calendar-availability endpoint — free-busy check
    surfaced in the "Meeting Booked" modal before submit.

Same grant as email (Nylas v3 shares one OAuth grant across Messages and
Calendar) — no new auth flow. Kept fully synchronous (httpx.Client, not
AsyncClient) so it can be called directly from call_routes.py::log_call,
a plain sync `def` that FastAPI already runs in a worker thread.
"""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

NYLAS_API_BASE = "https://api.us.nylas.com"


class NylasCalendarError(RuntimeError):
    """Carries the HTTP status code so callers can distinguish a 401 (grant
    revoked/expired — mark the mailbox as needing reconnection) from any
    other failure (treated as transient) without parsing the message."""
    def __init__(self, message: str, status_code: int = None):
        super().__init__(message)
        self.status_code = status_code


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def get_primary_calendar_id(grant_id: str, api_key: str) -> str | None:
    """Returns the grant's primary calendar id (falls back to the first
    calendar if none is flagged primary), or None if the grant has no
    calendars at all (e.g. missing Calendar scope)."""
    try:
        resp = httpx.get(
            f"{NYLAS_API_BASE}/v3/grants/{grant_id}/calendars",
            headers=_headers(api_key),
            timeout=15,
        )
    except httpx.HTTPError as e:
        raise NylasCalendarError(f"Nylas calendars request failed: {e}") from e
    if resp.status_code != 200:
        raise NylasCalendarError(f"Nylas calendars error {resp.status_code}: {resp.text}", resp.status_code)
    calendars = resp.json().get("data", [])
    if not calendars:
        return None
    primary = next((c for c in calendars if c.get("is_primary")), None)
    return (primary or calendars[0]).get("id")


def check_free_busy(grant_id: str, api_key: str, email: str, start_ts: int, end_ts: int) -> list:
    """Returns the busy time_slots for `email` in [start_ts, end_ts] (unix
    seconds). Empty list means no conflict OR the calendar couldn't be read
    (e.g. per-email "error" object) — a calendar we can't read should never
    block the booking flow, only skip the warning."""
    try:
        resp = httpx.post(
            f"{NYLAS_API_BASE}/v3/grants/{grant_id}/calendars/free-busy",
            headers=_headers(api_key),
            json={"start_time": start_ts, "end_time": end_ts, "emails": [email]},
            timeout=15,
        )
    except httpx.HTTPError as e:
        raise NylasCalendarError(f"Nylas free-busy request failed: {e}") from e
    if resp.status_code != 200:
        raise NylasCalendarError(f"Nylas free-busy error {resp.status_code}: {resp.text}", resp.status_code)
    for entry in resp.json().get("data", []):
        if entry.get("email") == email and entry.get("object") == "free_busy":
            return entry.get("time_slots", [])
    return []


def create_event(grant_id: str, api_key: str, calendar_id: str, title: str, description: str,
                  start_ts: int, end_ts: int, participant_email: str = None,
                  participant_name: str = None, extra_emails: list = None) -> dict:
    """Creates a real calendar event, inviting `participant_email` (the lead)
    plus any `extra_emails` (additional guests the SDR added) if given
    (Google/Outlook then send the actual invite email — no separate emailing
    logic needed here). Returns the created event's data dict (id, html_link
    when the underlying provider is Google)."""
    participants = []
    if participant_email:
        p = {"email": participant_email}
        if participant_name:
            p["name"] = participant_name
        participants.append(p)
    for email in extra_emails or []:
        if email and email != participant_email:
            participants.append({"email": email})

    body = {
        "title": title,
        "description": description,
        "when": {"object": "timespan", "start_time": start_ts, "end_time": end_ts},
        "participants": participants,
    }
    try:
        resp = httpx.post(
            f"{NYLAS_API_BASE}/v3/grants/{grant_id}/events",
            headers=_headers(api_key),
            params={"calendar_id": calendar_id, "notify_participants": "true"},
            json=body,
            timeout=15,
        )
    except httpx.HTTPError as e:
        raise NylasCalendarError(f"Nylas create-event request failed: {e}") from e
    if resp.status_code not in (200, 201):
        raise NylasCalendarError(f"Nylas create-event error {resp.status_code}: {resp.text}", resp.status_code)
    return resp.json().get("data", {})

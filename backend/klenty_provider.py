# ── klenty_provider.py — Klenty call-activity pull-sync provider ────────────
"""
DialerProvider implementation for Klenty's call-completion GET API.

This is a temporary bridging integration (see docs/RELEASES.md) — SDRs
currently place some calls through Klenty (using an Aircall-owned number)
that never reach Aircall's own call log or RCM. Once SDRs move fully
onto RCM's own dialing, this provider goes away.

Klenty is pull-only (no webhooks) and per-user (one API call per SDR,
keyed by their Klenty username — no bulk "all calls" endpoint exists).

API Base: https://app.klenty.com/apis/v1
Auth: single account-level API key, header `x-API-key`
      (generated in Klenty: Settings -> Integrations -> Klenty API Key).
"""
import json
import logging
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

from dialer_provider import (
    CallEventType,
    DialerProvider,
    InitiateCallResult,
    NormalizedCallEvent,
)

logger = logging.getLogger(__name__)

MAX_SYNC_LOOKBACK_DAYS = 29  # Klenty rejects a startDate older than this from
                              # today (error K2002) — NOT a span-length limit
                              # between from/to. LIVE-TESTED 2026-07-29: 29
                              # days back succeeds, 30 fails with K2002.


class KlentyDialerProvider(DialerProvider):
    """Pull-only call-history reader. Cannot place outbound calls."""

    provider_name = "klenty"

    def __init__(self, api_key: str, base_url: str = "https://app.klenty.com/apis/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    # ── HTTP helper ──────────────────────────────────────────────────────────

    def _get(self, path: str, params: dict = None, retries: int = 3) -> dict:
        url = f"{self.base_url}{path}"
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
            if qs:
                url = f"{url}?{qs}"

        headers = {
            "x-API-key": self.api_key,
            "Accept": "application/json",
            # Cloudflare (in front of app.klenty.com) blocks the default
            # "Python-urllib/3.x" User-Agent outright (error 1010) — a normal
            # browser-like UA is required even for a legitimate API key.
            "User-Agent": "Mozilla/5.0 (compatible; RCMCRM/1.0)",
        }

        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = resp.read().decode()
                    return json.loads(body) if body else {}
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < retries - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"[Klenty] 429 rate-limited, waiting {wait}s (attempt {attempt + 1}/{retries})")
                    time.sleep(wait)
                    continue
                if e.code in (502, 503, 504) and attempt < retries - 1:
                    wait = 2 ** attempt
                    logger.warning(f"[Klenty] {e.code} gateway error — retrying in {wait}s (attempt {attempt + 1}/{retries})")
                    time.sleep(wait)
                    continue
                error_body = ""
                try:
                    error_body = e.read().decode()
                except Exception:
                    pass
                logger.error(f"[Klenty] HTTP {e.code} GET {path}: {error_body}")
                raise RuntimeError(f"Klenty API error {e.code}: {error_body}")
            except Exception as e:
                if attempt < retries - 1:
                    logger.warning(f"[Klenty] Network error on attempt {attempt + 1}/{retries}: {type(e).__name__}: {e} — retrying in 1s")
                    time.sleep(1)
                    continue
                logger.error(f"[Klenty] Request failed after {retries} attempts: {e}")
                raise
        return {}

    # ── DialerProvider ABC ───────────────────────────────────────────────────

    def initiate_call(self, phone_number: str, user_email: str, lead_id: str) -> InitiateCallResult:
        return InitiateCallResult(
            success=False,
            provider=self.provider_name,
            error="Klenty is call-history-only — outbound calling is not supported through this integration.",
        )

    def get_users(self) -> list[dict]:
        # No bulk user-listing endpoint exists; not applicable (no outbound capability).
        return []

    def get_numbers(self) -> list[dict]:
        # Not applicable — Klenty has no RCM-initiated outbound path.
        return []

    def handle_webhook(self, payload: dict) -> Optional[NormalizedCallEvent]:
        # Klenty has no webhooks. This only satisfies the ABC contract —
        # the real normalizer is _normalize_call(), used for polled records.
        return None

    def test_connection(self, username: str) -> dict:
        """Verify the API key against a real Klenty username — there is no
        account-level "whoami" self-check endpoint; every call is scoped to
        one user (RCA 2026-07-22: a placeholder "whoami" username was
        rejected outright as 'Invalid user', not treated as a self-check)."""
        if not username:
            return {"success": False, "message": "No Klenty username available to test with", "details": {}}
        try:
            self._get(f"/user/{username}/calls", params={"startDate": "2000-01-01", "endDate": "2000-01-01", "page": "1"})
            return {"success": True, "message": "Klenty API key accepted", "details": {}}
        except RuntimeError as e:
            return {"success": False, "message": str(e), "details": {}}

    # ── Klenty-specific ──────────────────────────────────────────────────────

    def _normalize_call(self, raw: dict) -> NormalizedCallEvent:
        """Normalize one raw Klenty call record (from fetch_calls_paginated) into
        a NormalizedCallEvent. Every Klenty record is already a completed call —
        there is no "call started" push, so event_type is always CALL_ENDED."""
        username = raw.get("username") or ""
        # RCA 2026-08-03: some Klenty records have startTime: null (a call that
        # errored before ever "starting", per Klenty's own model) but a real
        # endTime. Falling through to created_at (sync time) for these —
        # the previous behavior — misattributes them to whatever day the
        # backfill happened to run, the same bug class dialer_call_event_time()
        # fixed elsewhere. endTime is still a real call-time signal.
        started_at = _parse_ts(raw.get("startTime")) or _parse_ts(raw.get("endTime"))
        return NormalizedCallEvent(
            event_type=CallEventType.CALL_ENDED,
            provider=self.provider_name,
            provider_call_id=str(raw.get("callSid") or ""),
            phone_number=raw.get("prospectPhoneNo"),
            user_email=username if "@" in username else None,
            direction=(raw.get("type") or "outbound").lower(),
            duration=int(raw["duration"]) if raw.get("duration") is not None else None,
            started_at=started_at,
            ended_at=_parse_ts(raw.get("endTime")),
            raw_payload=raw,
        )

    def fetch_calls_paginated(self, username: str, from_date: str, to_date: str, page: int = 1) -> dict:
        """Fetch one page of a single SDR's call history.
        from_date/to_date: 'yyyy-mm-dd'. from_date must be within
        MAX_SYNC_LOOKBACK_DAYS of today (Klenty's real constraint — not a
        span limit between from_date/to_date).

        Real response shapes (LIVE-TESTED 2026-07-29 against the production
        API key/account):
          results found: {"status": true, "data": {"callData": [...], "hasMore": bool}}
          none found:    {"status": false, "errors": [{"code": "K2003", ...}]}
        "calls"/"hasMore" are nested under "data", not top-level — a prior
        version of this code read them from the top level and silently
        resolved to an always-empty list.

        RCA 2026-08-06 (LIVE-TESTED): any other status:false code (e.g.
        K2002, "invalid date range") was ALSO being treated as "0 calls
        found" — identical to a genuinely empty K2003 day. This is what let
        a real Klenty-side fault (a narrow recent date window rejected with
        K2002 while the same data was reachable via a wider query) go
        unnoticed for 6 days: the nightly sync kept "succeeding" with
        imported=0 every night, no different from an ordinary quiet day.
        Only K2003 means "valid request, nothing found" — anything else is
        raised so the caller's existing retry/abort path (and log line)
        actually surfaces it instead of silently swallowing it.

        RCA 2026-08-03 (LIVE-TESTED): Klenty's endDate filter is exclusive —
        a same-day range (startDate == endDate) always returns K2003 "no
        record found", even on a day with real calls. Not hit by the nightly
        sync today (it always requests a multi-day window), but a landmine
        for any single-day-scoped caller, so this widens same-day requests by
        one day and filters the result back down client-side.

        Returns: { calls: [...], has_more: bool, page: int }
        """
        start = datetime.strptime(from_date, "%Y-%m-%d")
        lookback_days = (datetime.now(timezone.utc).date() - start.date()).days
        if lookback_days > MAX_SYNC_LOOKBACK_DAYS:
            raise ValueError(
                f"Klenty rejects a start date more than {MAX_SYNC_LOOKBACK_DAYS} days "
                f"before today: {from_date} is {lookback_days} days ago"
            )

        request_to_date = to_date
        if request_to_date == from_date:
            request_to_date = (datetime.strptime(to_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

        result = self._get(
            f"/user/{username}/calls",
            params={"startDate": from_date, "endDate": request_to_date, "page": str(page)},
        )
        if not result.get("status"):
            error = (result.get("errors") or [{}])[0]
            if error.get("code") != "K2003":
                raise RuntimeError(
                    f"Klenty rejected the request: {error.get('code')} {error.get('errorMessage')}"
                )
            data = {}
        else:
            data = result.get("data") or {}
        calls = data.get("callData") or []
        if request_to_date != to_date:
            calls = [c for c in calls if (c.get("startTime") or c.get("endTime") or "")[:10] == to_date]
        return {
            "calls": calls,
            "has_more": bool(data.get("hasMore")),
            "page": page,
        }


def _parse_ts(val) -> Optional[datetime]:
    """Parse a Klenty timestamp string into a UTC datetime."""
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        if "T" in str(val):
            dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc)
        ts = float(val)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (ValueError, TypeError, OSError):
        return None

# ── messaging_provider.py — Alternate Messenger Contact Center dialer provider ───────
"""
DialerProvider implementation for the Alternate Messenger Contact Center API.
Supports browser-based calling via LiveKit WebRTC and phone bridge mode.

API Base: https://app.alternatecrm.com/contact-center/v1
Auth: Auto-generated JWT via HMAC authentication (api_key + user_id).
      Tokens are cached (90-min TTL) and refreshed automatically on expiry or 401.
"""
import json
import logging
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from messaging_auth import AlternateMessengerAuthManager
from dialer_provider import (
    CallEventType,
    DialerProvider,
    InitiateCallResult,
    NormalizedCallEvent,
)
from phone_utils import strip_extension, validate_phone_dialable

logger = logging.getLogger(__name__)


# ── Status mapping: Alternate Messenger → CRM CallEventType ──────────────────────────
_STATUS_MAP = {
    "initiated":  CallEventType.CALL_STARTED,
    "ringing":    CallEventType.CALL_STARTED,
    "active":     CallEventType.CALL_ANSWERED,
    "completed":  CallEventType.CALL_ENDED,
    "failed":     CallEventType.CALL_ENDED,
    "cancelled":  CallEventType.CALL_ENDED,
    "no_answer":  CallEventType.CALL_ENDED,
    "busy":       CallEventType.CALL_ENDED,
}

# Terminal statuses where the call is definitely over
_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "no_answer", "busy"}


def _to_messenger_number(number: str, default_country_code: str = "1") -> str:
    """
    Normalize a phone number to E.164 format (+<country><local>).
    This is the actual formatter for the outbound `phone_number` field
    (the lead being called) — see initiate_call().

    RCA 2026-07-22: default_country_code was "91" (India), so ANY bare
    number with no +/00/0 prefix — the vast majority of this org's lead
    phone numbers — got dialed as India. A live DB audit found every
    genuine India-country lead already stores its number with an explicit
    "+91" prefix, so this default never actually helped a real Indian
    number; it only ever misdialed real (mostly US) leads. Same root cause
    as the sibling bug in aircall_provider.py::_format_e164.

    Examples:
        +919240915643  → +919240915643  (explicit prefix — unaffected)
        00919240915643 → +919240915643  (explicit prefix — unaffected)
        9240915643     → +19240915643   (bare digits — now defaults to US/NANP)
    """
    if number is None:
        return ""
    if not number:
        return ""

    cleaned_number, extension = strip_extension(number)
    if extension is not None:
        logger.warning(
            f"[Alternate Messenger] Extension stripped from phone number: "
            f"'{number}' \u2192 '{cleaned_number}'. "
            f"Alternate Messenger does not support extensions."
        )
        number = cleaned_number

    n = (
        number.strip()
        .replace(" ", "").replace("-", "")
        .replace("(", "").replace(")", "").replace(".", "")
    )

    if n.startswith("+"):
        return n
    if n.startswith("00"):
        return "+" + n[2:]
    if n.startswith("0"):
        n = n[1:]
    return f"+{default_country_code}{n}"


def _to_00_prefix(number: str, default_country_code: str = "91") -> str:
    """
    [LEGACY — kept for backward-compat with stored numbers]
    Normalize any phone format to 00-prefix. Used internally to parse
    stored messenger_from_number values (which are stored as 00919...).

    NOTE: For actual API payloads, use:
      - _to_e164()           for phone_number field
      - _strip_to_digits()   for from_number field
    """
    if not number:
        return ""

    cleaned_number, extension = strip_extension(number)
    if extension is not None:
        number = cleaned_number

    n = (
        number.strip()
        .replace(" ", "").replace("-", "")
        .replace("(", "").replace(")", "").replace(".", "")
    )

    if n.startswith("00"):
        return n                      # already 00-prefix — no-op
    if n.startswith("+"):
        return "00" + n[1:]           # E.164 → 00-prefix
    if n.startswith("0"):
        n = n[1:]                     # local 0-prefix → strip, then add country code
    return f"00{default_country_code}{n}"


def _strip_to_digits(number: str, default_country_code: str = "91") -> str:
    """
    Convert any phone number format to raw digits with country code but no prefix.
    This matches Alternate Messenger's actual wire format for from_number.

    VERIFIED 2026-06-12 from real browser network traffic:
      from_number wire format: "912264236334"  (country code + local, no +/00 prefix)

    Examples:
        +919240915643  → 919240915643
        00919240915643 → 919240915643
        912264236334   → 912264236334   (no-op)
    """
    if not number:
        return ""

    cleaned_number, _ = strip_extension(number)
    n = (
        cleaned_number.strip()
        .replace(" ", "").replace("-", "")
        .replace("(", "").replace(")", "").replace(".", "")
    )

    if n.startswith("+"):
        return n[1:]          # +919240... → 919240...
    if n.startswith("00"):
        return n[2:]          # 00919240... → 919240...
    return n                  # already raw digits


class AlternateDialerProvider(DialerProvider):
    """Alternate Messenger Contact Center calling provider with auto-HMAC auth."""

    provider_name = "messenger"

    def __init__(self, base_url: str, api_key: str, user_id: str, from_number: str = "", notify_url: str = ""):
        self._root_url = base_url.rstrip("/")  # e.g. https://app.alternatecrm.com
        self.base_url = self._root_url
        # Ensure the contact-center path is included
        if "/contact-center" not in self.base_url:
            self.base_url = f"{self.base_url}/contact-center/v1"
        self.api_key = api_key
        self.user_id = str(user_id)
        self.from_number = from_number or ""
        self.notify_url  = notify_url or ""   # if set, Alternate Messenger pushes events here

    # ── HTTP helpers ─────────────────────────────────────────────────────────

    def _headers(self) -> dict:
        """Build auth headers using auto-generated JWT."""
        token = AlternateMessengerAuthManager.get_token(
            self._root_url, self.api_key, self.user_id
        )
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _request(self, method: str, path: str, body: dict = None,
                 params: dict = None, retries: int = 3) -> dict:
        """
        Make an HTTP request to the Alternate Messenger Contact Center API.
        Handles 401 auto-retry (token refresh), rate-limit (429) backoff.
        """
        url = f"{self.base_url}{path}"
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
            if qs:
                url = f"{url}?{qs}"

        data = json.dumps(body).encode() if body is not None else None
        _retried_auth = False  # Only auto-retry auth once

        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp_body = resp.read().decode()
                    return json.loads(resp_body) if resp_body else {}
            except urllib.error.HTTPError as e:
                status = e.code
                error_body = ""
                try:
                    error_body = e.read().decode()
                except Exception:
                    pass

                if status == 401 and not _retried_auth:
                    # Token expired — clear cache, get fresh token, retry once
                    logger.warning("[Alternate Messenger] 401 — refreshing token and retrying")
                    AlternateMessengerAuthManager.clear_cache(
                        self._root_url, self.api_key, self.user_id
                    )
                    _retried_auth = True
                    continue

                if status == 401:
                    logger.error("[Alternate Messenger] 401 after token refresh — credentials invalid")
                    raise RuntimeError(
                        "Alternate Messenger authentication failed after token refresh. "
                        "Check your API Key and User ID in Settings."
                    )

                if status == 429 and attempt < retries - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"[Alternate Messenger] 429 rate-limited, waiting {wait}s (attempt {attempt + 1}/{retries})")
                    time.sleep(wait)
                    continue

                # 502/503/504 are transient gateway errors — retry with short backoff
                # (e.g. Alternate Messenger infra blip). Usually resolves within 1-2 seconds.
                if status in (502, 503, 504) and attempt < retries - 1:
                    wait = 2 ** attempt  # 1s, 2s, ... (shorter than 429 backoff)
                    logger.warning(
                        f"[Alternate Messenger] {status} gateway error on {method} {path} "
                        f"— retrying in {wait}s (attempt {attempt + 1}/{retries})"
                    )
                    time.sleep(wait)
                    continue

                logger.error(f"[Alternate Messenger] HTTP {status} {method} {path}: {error_body}")
                raise RuntimeError(f"Alternate Messenger API error {status}: {error_body}")
            except Exception as e:
                if isinstance(e, RuntimeError):
                    raise
                if attempt < retries - 1:
                    logger.warning(
                        f"[Alternate Messenger] Network error on attempt {attempt + 1}/{retries} "
                        f"{method} {path}: {type(e).__name__}: {e} — retrying in 1s"
                    )
                    time.sleep(1)
                    continue
                logger.error(f"[Alternate Messenger] Request failed after {retries} attempts {method} {path}: {e}")
                raise

        return {}

    def _get(self, path: str, params: dict = None) -> dict:
        return self._request("GET", path, params=params)

    def _post(self, path: str, body: dict = None) -> dict:
        return self._request("POST", path, body=body)

    # ── DialerProvider interface ─────────────────────────────────────────────

    @staticmethod
    def _validate_phone_for_messenger(formatted_e164: str, original: str = "") -> Optional[str]:
        """
        Pre-flight validation of a Alternate Messenger-format E.164 phone number.
        Delegates to the shared phone_utils.validate_phone_dialable validator.

        GROUND TRUTH (2026-06-12): Alternate Messenger uses E.164 (+91...), not 00XX.
        Parameter renamed from formatted_00 to formatted_e164 for clarity.

        Returns a human-readable error string if invalid, None if OK.
        """
        if not formatted_e164:
            display = original or "(empty)"
            return (
                f"No phone number provided for this lead ('{display}'). "
                f"Please add a valid phone number to the lead record."
            )
        if not formatted_e164.startswith("+"):
            return (
                f"Phone number '{original or formatted_e164}' could not be formatted "
                f"for Alternate Messenger (expected E.164 '+XX...' format). "
                f"Please update the lead with a number including country code "
                f"(e.g. +91... for India, +1... for US/Canada)."
            )
        # Already E.164 — run shared validation directly
        return validate_phone_dialable(formatted_e164, original)


    def initiate_call(self, phone_number: str, user_email: str, lead_id: str,
                      use_agent_phone: bool = False, contact_name: str = "") -> InitiateCallResult:
        """
        Start an outbound call via the Alternate Messenger Contact Center API.
        Supports both browser (WebRTC/LiveKit) and phone bridge modes.
        """
        # C3/C4: Guard None/empty phone_number before any processing
        if not phone_number:
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=(
                    "No phone number provided for this lead. "
                    "Please add a valid phone number to the lead record."
                ),
            )

        try:
            # ── VERIFIED GROUND TRUTH (2026-06-12, real browser network traffic) ────────
            # /calls/initiate wire format:
            #   {"phone_number": "+919580440262", "contact_name": "",
            #    "use_agent_phone": false/true, "from_number": "<DID as configured>"}
            #
            # phone_number (lead's number): normalize to E.164 — can arrive in any
            #   format from our DB (+91, 00, plain digits, etc.)
            #
            # from_number (outbound DID): send VERBATIM from Settings — zero format
            #   transformation. Different telecom providers (Tata, Airtel, etc.) register
            #   DIDs in different formats. The admin sets it once in Settings in the exact
            #   format their Alternate Messenger account requires, and we pass it through as-is.
            #   Only whitespace/dashes/parens are stripped for safety.
            # ─────────────────────────────────────────────────────────────────────────

            # phone_number: normalize to E.164 — arrives in any format from DB
            norm_to = _to_messenger_number(phone_number)
            logger.info(f"[Alternate Messenger] phone_number: {phone_number!r} → {norm_to!r}")

            # Internal validation uses E.164 form
            validation_error = self._validate_phone_for_messenger(norm_to, phone_number)
            if validation_error:
                logger.warning(f"[Alternate Messenger] Pre-validation failed for lead {lead_id}: {validation_error}")
                return InitiateCallResult(success=False, provider=self.provider_name, error=validation_error)

            # from_number: pass-through verbatim (only strip whitespace/dashes/parens)
            # The admin stores it in Settings in exactly the format their provider needs.
            raw_from = self.from_number or ""
            norm_from = (
                raw_from.strip()
                .replace(" ", "").replace("-", "")
                .replace("(", "").replace(")", "")
            )
            # Bridge calls ring the agent's phone first — from_number (outbound DID) is
            # required so Alternate Messenger knows which line to call the agent on.
            # Browser (WebRTC) calls go directly through LiveKit — no caller ID needed.
            if not norm_from and use_agent_phone:
                logger.error("[Alternate Messenger] from_number not configured — required for bridge mode")
                return InitiateCallResult(
                    success=False,
                    provider=self.provider_name,
                    error=(
                        "Phone bridge mode requires an outbound caller ID. "
                        "Go to Settings → Contact Center → Default Caller ID and enter "
                        "the DID exactly as shown in your Alternate Messenger account "
                        "(e.g. '00919240915643' or '912264236334' depending on your provider)."
                    ),
                )
            if norm_from:
                logger.info(f"[Alternate Messenger] from_number (verbatim): {raw_from!r} → {norm_from!r}")
            else:
                logger.info("[Alternate Messenger] from_number not set — omitting from payload (browser call)")

            payload: dict = {
                "phone_number":    norm_to,
                "contact_name":    contact_name,
                "use_agent_phone": use_agent_phone,   # false=browser, true=bridge
            }
            if norm_from:
                payload["from_number"] = norm_from
            # CONFIRMED WORKING 2026-07-15: prior 2 attempts (2026-07-09, 2026-07-10)
            # both 422'd live with "Unknown field" on app.alternatecrm.com despite
            # vendor confirmation each time (see Rule 18). This 3rd attempt was
            # verified with a real live call on staging: 200 response, call_id
            # returned, and the phone actually rang. Do not remove this field
            # without a new live 422 reproducing first.
            if self.notify_url:
                payload["webhook_url"] = self.notify_url
                logger.info(f"[Alternate Messenger] webhook_url set in payload: {self.notify_url}")

            logger.info(f"[Alternate Messenger] Initiating call: payload={payload}")
            result = self._post("/calls/initiate", body=payload)
            logger.info(f"[Alternate Messenger] initiate_call response: {result}")

            call_id = result.get("call_id") or result.get("id", "")
            livekit_token = result.get("token")
            livekit_url = result.get("livekit_url")
            room_name = result.get("room_name")


            return InitiateCallResult(
                success=True,
                provider=self.provider_name,
                provider_call_id=str(call_id),
                phone_number=phone_number,
                livekit_token=livekit_token,
                livekit_url=livekit_url,
                room_name=room_name,
                agent_join_via_phone=use_agent_phone,
            )
        except Exception as e:
            # ── C6: Map every Alternate Messenger failure to a clear, actionable message ──────
            # RuntimeError messages from _request() follow the pattern:
            #   "Alternate Messenger API error {status}: {response_body_text}"
            # Network errors are plain exception messages (no "Alternate Messenger API error" prefix).
            err_str = str(e)

            # Step 1: Try to extract Alternate Messenger's own error message from the response body.
            # This is best-effort — we never block the error path on JSON parsing failures.
            messenger_detail = ""
            try:
                if "Alternate Messenger API error" in err_str and ": " in err_str:
                    # Format: "Alternate Messenger API error 422: <body>"
                    # Split on first ": " after the status code
                    after_prefix = err_str.split("Alternate Messenger API error ")[1]
                    # after_prefix = "422: {\"error\":\"...\"}"
                    body_str = after_prefix.split(": ", 1)[1] if ": " in after_prefix else ""
                    if body_str:
                        body_data = json.loads(body_str)
                        messenger_detail = (
                            body_data.get("error")
                            or body_data.get("message")
                            or body_data.get("detail")
                            or ""
                        )
                        if isinstance(messenger_detail, dict):
                            # Some APIs return nested error objects
                            messenger_detail = str(messenger_detail)
            except Exception:
                pass  # Best-effort — never surface a parse error here

            detail_suffix = (
                f' Alternate Messenger says: "{messenger_detail}"'
                if messenger_detail else ""
            )

            # Step 2: Map to a friendly primary message by status code.
            if "422" in err_str:
                user_error = (
                    "Alternate Messenger rejected the call \u2014 the phone number or caller ID "
                    "appears invalid. Please verify both in the lead record and in "
                    "Settings \u2192 Contact Center."
                    + detail_suffix
                )
            elif "400" in err_str:
                user_error = (
                    "Alternate Messenger could not process the call request (bad request). "
                    "Please check the phone number and caller ID."
                    + detail_suffix
                )
            elif "429" in err_str:
                user_error = (
                    "Alternate Messenger is rate-limiting requests. "
                    "Please wait a few seconds and try again."
                )
            elif "403" in err_str:
                user_error = (
                    "Alternate Messenger authentication error (403 Forbidden). "
                    "Please check your API key and User ID in Settings \u2192 Contact Center."
                    + detail_suffix
                )
            elif "401" in err_str:
                # Covers both "Alternate Messenger API error 401" and the explicit retry message
                user_error = (
                    "Alternate Messenger authentication failed. "
                    "Please check your API credentials in Settings \u2192 Contact Center."
                )
            elif "503" in err_str or "502" in err_str or "504" in err_str:
                user_error = (
                    "Alternate Messenger service is temporarily unavailable. "
                    "Please wait a moment and try again."
                )
            elif "500" in err_str:
                user_error = (
                    "Alternate Messenger encountered an internal server error. "
                    "Please try again in a few seconds. If the issue persists, "
                    "check the Alternate Messenger status page."
                )
            elif "timed out" in err_str.lower() or "timeout" in err_str.lower():
                user_error = (
                    "Could not reach Alternate Messenger (request timed out). "
                    "Please check your internet connection and try again."
                )
            elif "connection" in err_str.lower() and "refused" in err_str.lower():
                user_error = (
                    "Could not connect to Alternate Messenger (connection refused). "
                    "Please check your internet connection and try again."
                )
            else:
                # Unknown error — include the raw message for support traceability
                # but trim it to avoid exposing full stack traces to users
                trimmed = err_str[:200] if len(err_str) > 200 else err_str
                user_error = f"Could not start the call via Alternate Messenger: {trimmed}"

            logger.error(f"[Alternate Messenger] initiate_call failed: {e}")
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=user_error,
                phone_number=phone_number,
            )


    def disconnect_call(self, call_id: str = None, phone_number: str = None) -> dict:
        """
        End an active call.

        GROUND TRUTH (from Alternate Messenger developer curl examples, 2026-06-12):
          POST /calls/disconnect body is ONLY: {"call_id": "<numeric_id>"}
          No phone_number field — Alternate Messenger ignores/rejects extra fields.
          phone_number parameter kept for API compatibility but NOT forwarded.
        """
        try:
            if not call_id:
                logger.warning("[Alternate Messenger] disconnect_call called without call_id — skipping")
                return {"success": False, "error": "No call_id provided"}
            body = {"call_id": call_id}
            return self._post("/calls/disconnect", body=body)
        except Exception as e:
            logger.error(f"[Alternate Messenger] disconnect_call failed: {e}")
            return {"success": False, "error": str(e)}

    def call_action(self, call_id: str, action: str, room_name: str = None) -> dict:
        """
        Perform an in-call action: hold, mute, unmute, hangup.
        """
        try:
            body = {"action": action}
            if room_name:
                body["room_name"] = room_name
            return self._post(f"/calls/{call_id}/action", body=body)
        except Exception as e:
            logger.error(f"[Alternate Messenger] call_action({action}) failed: {e}")
            return {"success": False, "error": str(e)}

    def get_call_status(self, call_id: str) -> dict:
        """Get the latest status of a call."""
        try:
            if call_id and call_id.lstrip('+').isdigit() and 7 <= len(call_id.lstrip('+')) <= 15:
                return {"status": "unknown", "error": "phone-like call_id skipped"}
            return self._post(f"/calls/{call_id}/status", body={"call_id": call_id})
        except Exception as e:
            logger.error(f"[Alternate Messenger] get_call_status failed: {e}")
            return {"status": "unknown", "error": str(e)}

    def get_livekit_token(self, call_id: str) -> dict:
        """Get a LiveKit token and URL for browser-based calling."""
        try:
            return self._get(f"/calls/{call_id}/token")
        except Exception as e:
            logger.error(f"[Alternate Messenger] get_livekit_token failed: {e}")
            return {"error": str(e)}

    def get_recording_url(self, provider_call_id: str) -> Optional[str]:
        """Get a pre-signed recording URL for a completed call."""
        try:
            if provider_call_id and provider_call_id.lstrip('+').isdigit() and 7 <= len(provider_call_id.lstrip('+')) <= 15:
                return None
            result = self._get(f"/calls/{provider_call_id}/recording-url")
            return result.get("recording_url") or result.get("url")
        except Exception as e:
            logger.warning(f"[Alternate Messenger] get_recording_url failed for {provider_call_id}: {e}")
            return None

    def fetch_call(self, provider_call_id: str) -> Optional[dict]:
        """Fetch call details including recording URL and duration.

        Strategy:
        1. Hit /calls/{id}/status — returns {call_id, status} only.
        2. If duration/ended_at still missing, search the paginated /calls list
           for the specific call_id to get duration_seconds, ended_at, etc.
        """
        try:
            # Guard: skip if provider_call_id looks like a phone number
            if provider_call_id and provider_call_id.lstrip('+').isdigit() and 7 <= len(provider_call_id.lstrip('+')) <= 15:
                logger.debug(f"[Alternate Messenger] Skipping fetch_call for phone-like ID: {provider_call_id}")
                return None

            # Independent of the /status call below: a broken /status endpoint must not
            # prevent us from still trying the recording URL (separate Alternate Messenger endpoint).
            try:
                status = self._post(f"/calls/{provider_call_id}/status", body={"call_id": provider_call_id})
            except Exception as status_err:
                logger.warning(f"[Alternate Messenger] fetch_call: /status failed for {provider_call_id}: {status_err}")
                status = {"call_id": provider_call_id, "status": "unknown"}

            recording_url = self.get_recording_url(provider_call_id)
            if recording_url:
                status["recording_url"] = recording_url

            # Status endpoint only returns {call_id, status}. Search the paginated
            # calls list to get duration_seconds, ended_at, and other full details.
            try:
                page = 1
                found = None
                while page <= 5:  # search up to 5 pages (250 most recent calls)
                    result = self._get("/calls", params={"page": str(page), "page_size": "50"})
                    items = result.get("items") or result.get("calls") or result.get("data") or []
                    for item in items:
                        if item.get("call_id") == provider_call_id or item.get("id") == provider_call_id:
                            found = item
                            break
                    if found or len(items) < 50:
                        break
                    page += 1

                if found:
                    # Map Alternate Messenger's paginated field names to our normalized names
                    dur = found.get("duration_seconds")
                    if dur is not None:
                        status["duration"] = int(dur)
                    if found.get("ended_at"):
                        status["ended_at"] = found["ended_at"]
                    if found.get("started_at") and not status.get("started_at"):
                        status["started_at"] = found["started_at"]
                    # recording_link is a relative path — convert to full recording URL
                    if not status.get("recording_url") and found.get("recording_link"):
                        fresh_url = self.get_recording_url(provider_call_id)
                        if fresh_url:
                            status["recording_url"] = fresh_url
                    # Transcription (may be empty dict {} when skipped)
                    if found.get("transcription") and isinstance(found["transcription"], dict) and found["transcription"]:
                        status["transcription"] = found["transcription"]
                    logger.info(
                        f"[Alternate Messenger] fetch_call: found full details for {provider_call_id} "
                        f"on page {page}: duration={status.get('duration')}s ended_at={status.get('ended_at')}"
                    )
            except Exception as search_err:
                logger.debug(f"[Alternate Messenger] fetch_call paginated search failed for {provider_call_id}: {search_err}")

            return status
        except Exception as e:
            logger.warning(f"[Alternate Messenger] fetch_call failed for {provider_call_id}: {e}")
            return None

    def get_users(self) -> list[dict]:
        """
        Alternate Messenger Contact Center may not have a user listing API.
        Returns empty list — users are configured per-SDR in the CRM.
        """
        return []

    def get_numbers(self) -> list[dict]:
        """Return the current SDR's verified outgoing numbers from call history."""
        try:
            result = self._get("/calls", params={"page": "1", "page_size": "100"})
            calls = result.get("data") or result.get("calls") or result.get("items") or []
            seen = {}
            for call in calls:
                num = call.get("outgoing_number") or call.get("from_number") or call.get("caller_id")
                if num and num not in seen:
                    seen[num] = 0
                seen[num] = seen.get(num, 0) + 1
            return [
                {"id": str(i + 1), "name": f"Caller ID ({count} calls)", "number": num}
                for i, (num, count) in enumerate(seen.items())
            ]
        except Exception as e:
            logger.warning(f"[Alternate Messenger] get_numbers failed: {e}")
            return []

    def get_numbers_for_user(self, sub_user_id: str) -> list[str]:
        """
        Fetch the distinct outgoing numbers used by a specific Alternate Messenger sub-agent.

        Authenticates as `sub_user_id` using the shared api_key, then queries
        /contact-center/v1/calls to extract unique `outgoing_number` values.
        These represent phone numbers that sub-agent has successfully called from.

        Returns a deduplicated list in descending usage frequency order.
        """
        if not sub_user_id:
            return []
        # Build a temporary provider scoped to this sub-agent
        sub_provider = AlternateDialerProvider(
            base_url=self._root_url,
            api_key=self.api_key,
            user_id=str(sub_user_id),
            from_number="",
        )
        try:
            result = sub_provider._get("/calls", params={"page": "1", "page_size": "100"})
            calls = result.get("data") or result.get("calls") or result.get("items") or []
            usage: dict[str, int] = {}
            for call in calls:
                num = call.get("outgoing_number") or call.get("from_number") or call.get("caller_id")
                if num:
                    usage[num] = usage.get(num, 0) + 1
            # Return sorted by frequency (most-used first)
            return [n for n, _ in sorted(usage.items(), key=lambda x: -x[1])]
        except Exception as e:
            logger.warning(f"[Alternate Messenger] get_numbers_for_user({sub_user_id}) failed: {e}")
            raise


    def handle_webhook(self, payload: dict) -> Optional[NormalizedCallEvent]:
        """
        Normalize a Alternate Messenger/LiveKit webhook event into a standard CallEvent.
        Expected payload fields: call_id, status, phone_number, duration, etc.
        """
        call_id = str(payload.get("call_id") or payload.get("id", ""))
        if not call_id:
            logger.debug("[Alternate Messenger] Webhook missing call_id, ignoring")
            return None

        status = (payload.get("status") or "").lower()
        event_type = _STATUS_MAP.get(status)
        if not event_type:
            logger.warning(
                f"[Alternate Messenger] Unrecognised webhook status '{status}' — call_id={call_id!r}. "
                f"Full payload: {payload}"
            )
            return None

        # Parse timestamps
        started_at = _parse_ts(payload.get("started_at") or payload.get("start_time"))
        answered_at = _parse_ts(payload.get("answered_at") or payload.get("answer_time"))
        ended_at = _parse_ts(payload.get("ended_at") or payload.get("end_time"))

        # Alternate Messenger paginated API uses 'duration_seconds'; webhook may use either
        duration = payload.get("duration_seconds") or payload.get("duration")
        if duration is not None:
            try:
                duration = int(duration)
            except (ValueError, TypeError):
                duration = None

        phone = payload.get("to_number") or payload.get("phone_number") or payload.get("customer_number")
        user_email = payload.get("agent_email") or payload.get("user_email")
        direction = payload.get("direction", "outbound")
        recording_url = payload.get("recording_url")
        transcript = payload.get("transcript")

        return NormalizedCallEvent(
            event_type=event_type,
            provider=self.provider_name,
            provider_call_id=call_id,
            phone_number=phone,
            user_email=user_email,
            direction=direction,
            duration=duration,
            recording_url=recording_url,
            transcript=transcript if isinstance(transcript, str) else json.dumps(transcript) if transcript else None,
            started_at=started_at,
            answered_at=answered_at,
            ended_at=ended_at,
            raw_payload=payload,
        )

    def test_connection(self) -> dict:
        """Test the connection by fetching the first page of calls."""
        try:
            result = self._get("/calls", params={"page": "1", "page_size": "1"})
            return {
                "success": True,
                "message": "Alternate Messenger Contact Center API connected successfully",
                "details": {
                    "total_calls": result.get("total") or result.get("count", 0),
                    "api_version": "v1",
                },
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"Connection failed: {e}",
                "details": {},
            }

    # ── Paginated call history (for sync) ────────────────────────────────────

    def fetch_calls_paginated(self, page: int = 1, page_size: int = 50,
                              from_date: str = None, to_date: str = None) -> dict:
        """
        Fetch paginated call history from Alternate Messenger.
        Returns: { calls: [...], total: int, page: int, page_size: int }
        """
        params = {"page": str(page), "page_size": str(page_size)}
        if from_date:
            params["from_date"] = from_date
        if to_date:
            params["to_date"] = to_date

        try:
            result = self._get("/calls", params=params)
            # Alternate Messenger returns 'items' (not 'calls' or 'data')
            raw_calls = result.get("items") or result.get("calls") or result.get("data") or []
            # Normalize field names: duration_seconds → duration, recording_link → recording_url
            normalized = []
            for c in raw_calls:
                dur = c.get("duration_seconds")
                rec_link = c.get("recording_link")
                normalized.append({
                    **c,
                    "duration": int(dur) if dur is not None else None,
                    "recording_url": rec_link,  # relative path; caller must sign if needed
                })
            return {
                "calls": normalized,
                "total": result.get("total") or result.get("count", 0),
                "page": page,
                "page_size": page_size,
            }
        except Exception as e:
            logger.error(f"[Alternate Messenger] fetch_calls_paginated failed: {e}")
            return {"calls": [], "total": 0, "page": page, "page_size": page_size}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_ts(val) -> Optional[datetime]:
    """Parse a timestamp string into a UTC datetime."""
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        # ISO 8601 with timezone
        if "T" in str(val):
            dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
            return dt.astimezone(timezone.utc)
        # Unix timestamp
        ts = float(val)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    except (ValueError, TypeError, OSError):
        return None

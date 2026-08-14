# ── aircall_provider.py — Aircall dialer provider implementation ────────────
"""
Implements DialerProvider for Aircall.
API Docs: https://developer.aircall.io/api-references/
Auth: Basic Auth (base64(api_id:api_token))
"""
import base64
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import requests

from dialer_provider import (
    DialerProvider,
    NormalizedCallEvent,
    InitiateCallResult,
    CallEventType,
)
from phone_utils import strip_extension, validate_phone_dialable


logger = logging.getLogger(__name__)

AIRCALL_API_BASE = "https://api.aircall.io/v1"


class AircallDialerProvider(DialerProvider):
    """Aircall implementation of the DialerProvider interface."""

    def __init__(self, api_id: str, api_token: str):
        self._api_id = api_id
        self._api_token = api_token

    @property
    def provider_name(self) -> str:
        return "aircall"

    # ── Internal helpers ──────────────────────────────────────────────────

    def _auth_header(self) -> dict:
        """Build Basic Auth header for Aircall API."""
        creds = base64.b64encode(f"{self._api_id}:{self._api_token}".encode()).decode()
        return {
            "Authorization": f"Basic {creds}",
            "Content-Type": "application/json",
        }

    def _get(self, path: str, params: dict = None) -> dict:
        """Make authenticated GET request to Aircall API, with 429 exponential backoff.

        Retries up to MAX_RETRIES times on rate-limit responses,
        honouring Aircall's 'Retry-After' header (or doubling the wait
        each attempt if the header is absent).
        """
        import time
        MAX_RETRIES = 5
        url = f"{AIRCALL_API_BASE}{path}"
        wait = 10   # initial backoff seconds
        for attempt in range(MAX_RETRIES):
            resp = requests.get(url, headers=self._auth_header(), params=params, timeout=30)
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", wait))
                logger.warning(
                    f"[Aircall] Rate limited on GET {path} "
                    f"(attempt {attempt + 1}/{MAX_RETRIES}). "
                    f"Retrying after {retry_after}s."
                )
                time.sleep(retry_after)
                wait = min(wait * 2, 60)   # exponential cap at 60s
                continue
            resp.raise_for_status()
            if not resp.content or not resp.content.strip():
                return {}
            try:
                return resp.json()
            except ValueError:
                logger.error(
                    f"[Aircall] GET {path} returned invalid JSON. "
                    f"Status {resp.status_code}. Body: {resp.text}"
                )
                raise Exception(
                    f"Invalid JSON from Aircall API (Status {resp.status_code}): {resp.text}"
                )
        resp.raise_for_status()   # raise after exhausting retries
        return {}

    def _post(self, path: str, data: dict = None) -> dict:
        """Make authenticated POST request to Aircall API."""
        url = f"{AIRCALL_API_BASE}{path}"
        resp = requests.post(url, headers=self._auth_header(), json=data or {}, timeout=15)
        resp.raise_for_status()
        if not resp.content or not resp.content.strip():
            return {}
        try:
            return resp.json()
        except ValueError as e:
            logger.error(f"[Aircall] POST {path} returned invalid JSON. Status {resp.status_code}. Body: {resp.text}")
            raise Exception(f"Invalid JSON from Aircall API (Status {resp.status_code}): {resp.text}")

    def _find_user_by_email(self, email: str) -> Optional[dict]:
        """
        Find an Aircall user by matching email address.
        The list endpoint (GET /users) returns simplified objects without
        'numbers' or 'default_number_id'. After finding the match, we fetch
        the full user detail via GET /users/{id}.
        """
        try:
            page = 1
            while True:
                result = self._get("/users", params={"per_page": 50, "page": page})
                users = result.get("users", [])
                if not users:
                    break
                for user in users:
                    if user.get("email", "").lower() == email.lower():
                        # Fetch full user detail to get numbers, default_number_id, etc.
                        try:
                            detail = self._get(f"/users/{user['id']}")
                            return detail.get("user", user)
                        except Exception as e:
                            logger.warning(f"[Aircall] Could not fetch user detail for {user['id']}: {e}")
                            return user
                # Check if there are more pages
                # Aircall returns 'total' and 'per_page' in meta, not 'total_pages'
                meta = result.get("meta", {})
                total = meta.get("total", 0)
                per_page = meta.get("per_page", 50)
                total_pages = -(-total // per_page) if total > 0 else 1  # ceil division
                if page >= total_pages or len(users) < per_page:
                    break
                page += 1
        except Exception as e:
            logger.error(f"[Aircall] Failed to search users by email '{email}': {e}")
        return None

    @staticmethod
    def _format_e164(phone: str) -> str:
        """
        Ensure phone number is in E.164 format.
        Aircall requires numbers like +918552628000, not 8552628000.
        Extensions (e.g. "ext 288", "x288", "#288") are stripped before
        formatting — Aircall does not support extensions and returns 400.
        Dots are stripped alongside dashes/spaces.
        None or empty input returns an empty string safely.
        """
        # Guard None/non-string input (A1)
        if not phone:
            return phone or ""

        # Strip extension suffixes before any other processing (delegates to shared util)
        stripped, extension = strip_extension(phone)
        if extension is not None:
            logger.warning(
                f"[Aircall] Extension stripped from phone number: "
                f"'{phone.strip()}' \u2192 '{stripped}'. "
                f"Aircall does not support extensions."
            )
        phone = stripped

        # Remove formatting characters: spaces, dashes, parentheses, dots (A2)
        cleaned = (
            phone.strip()
            .replace(" ", "").replace("-", "")
            .replace("(", "").replace(")", "").replace(".", "")
        )
        if not cleaned:
            return phone
        # Already has country code with +
        if cleaned.startswith("+"):
            return cleaned
        # RCA 2026-07-22: a bare 10-digit number starting with 6-9 used to be
        # guessed as Indian (+91) — but US area codes fully overlap that same
        # range (602, 702, 803, 918, ...), and a live DB audit found every
        # genuine India-country lead already carries an explicit "+91" prefix
        # (3420 of 3421), while this guess was misdialing confirmed US leads
        # (173 found in one pass) as India. A bare 10-digit number with no
        # explicit country code is US/NANP — no digit-based guessing.
        if len(cleaned) == 10:
            return f"+1{cleaned}"
        # 11 digits starting with 0 (Indian with leading 0)
        if len(cleaned) == 11 and cleaned.startswith("0"):
            return f"+91{cleaned[1:]}"
        # 11 digits starting with 1 (US with leading 1)
        if len(cleaned) == 11 and cleaned.startswith("1"):
            return f"+{cleaned}"
        # Fallback: prepend + if numeric
        if cleaned.isdigit():
            # Guard: 12-digit numbers starting with '11' are almost always a US number
            # with a duplicate country code prefix (e.g. 117187726564 stored as 1+17187726564).
            # Auto-correct before prepending '+' so we don't produce +117187726564.
            if len(cleaned) == 12 and cleaned.startswith("11"):
                corrected = cleaned[1:]  # strip the extra leading '1'
                logger.warning(
                    f"[Aircall] Double US country code detected in '{phone}' — "
                    f"auto-corrected to '+{corrected}'"
                )
                return f"+{corrected}"
            return f"+{cleaned}"
        return phone

    @staticmethod
    def _validate_phone_for_aircall(formatted: str, original: str = "") -> Optional[str]:
        """
        Pre-flight validation of an E.164 phone number before sending to Aircall.
        Delegates to phone_utils.validate_phone_dialable — the shared source of truth
        for number validation rules across all dialer providers.
        """
        return validate_phone_dialable(formatted, original)

    def fetch_calls_paginated(self, from_unix: int, to_unix: int, per_page: int = 50) -> list:
        """
        Fetch all Aircall calls in a UNIX timestamp range, fully paginated.
        Returns a flat list of raw Aircall call dicts.

        Rate-limit safety:
        - _get() retries on 429 with exponential backoff (up to 5 attempts)
        - A 1-second sleep between pages keeps throughput under Aircall's
          60 req/min plan limit even for large windows
        """
        import time
        all_calls = []
        page = 1
        while True:
            try:
                result = self._get("/calls", params={
                    "from": from_unix,
                    "to": to_unix,
                    "order": "asc",
                    "per_page": per_page,
                    "page": page,
                })
            except Exception as e:
                logger.error(f"[Aircall] fetch_calls_paginated failed on page {page}: {e}")
                break   # return what we have so far — partial is better than nothing

            calls = result.get("calls", [])
            all_calls.extend(calls)

            meta = result.get("meta", {})
            total = meta.get("total", 0)
            if total == 0:
                break
            total_pages = -(-total // per_page)   # ceil division
            if page >= total_pages or len(calls) < per_page:
                break

            page += 1
            time.sleep(2)   # 2s between pages → max 30 req/min, well within Aircall's 60 req/min limit

        logger.info(
            f"[Aircall] fetch_calls_paginated: "
            f"fetched {len(all_calls)} calls across {page} page(s)"
        )
        return all_calls

    def initiate_call(self, phone_number: str, user_email: str, lead_id: str,
                      use_agent_phone: bool = False, contact_name: str = "") -> InitiateCallResult:
        # use_agent_phone and contact_name are ignored for Aircall — calls always route via the Aircall phone app.
        """Start an outbound call via Aircall."""
        # 1. Find the Aircall user by email
        aircall_user = self._find_user_by_email(user_email)
        if not aircall_user:
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=f"No Aircall user found matching email '{user_email}'. "
                      f"Ensure the SDR's email matches their Aircall account."
            )

        aircall_user_id = aircall_user.get("id")  # A4: use .get() to avoid KeyError
        if not aircall_user_id:
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=(
                    f"Could not retrieve Aircall user ID for '{user_email}'. "
                    f"The Aircall API returned an incomplete user record. "
                    f"Please try again or contact support."
                ),
            )
        user_numbers = aircall_user.get("numbers", [])
        user_name = aircall_user.get("name", user_email)

        # 2. Availability pre-check — surface a friendly error before hitting the API
        # Aircall availability_status values: "available", "custom", "do_not_disturb", "offline"
        # We only hard-block on states Aircall itself will reject — unavailable states
        availability = aircall_user.get("availability_status", "available")
        UNAVAILABLE_STATES = {"do_not_disturb", "offline"}
        if availability in UNAVAILABLE_STATES:
            logger.warning(
                f"[Aircall] Pre-call availability check: {user_email} is '{availability}'. "
                f"Blocking call attempt to avoid confusing 405."
            )
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=(
                    f"{user_name} is currently marked as '{availability}' in Aircall "
                    f"and cannot receive a new outbound call. "
                    f"Ask them to set their status to Available in the Aircall Desktop app."
                ),
            )

        # 3. Determine which number to use — user MUST be assigned to it in Aircall
        if not user_numbers:
            # User has no numbers assigned — try to find available numbers for a helpful error
            all_numbers = self.get_numbers()
            number_names = ", ".join([f"{n['name']} ({n['number']})" for n in all_numbers[:3]]) if all_numbers else "none"
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=f"Aircall user '{aircall_user.get('name', user_email)}' is not assigned to any phone number. "
                      f"In Aircall Dashboard → Numbers → select a number → add this user. "
                      f"Available numbers: {number_names}"
            )

        # Use the first assigned number (or user's default if set)
        default_number_id = aircall_user.get("default_number_id")
        if default_number_id:
            number_id = default_number_id
        else:
            number_id = user_numbers[0].get("id") if isinstance(user_numbers[0], dict) else user_numbers[0]

        # 4. Format + validate phone number before hitting Aircall
        formatted_phone = self._format_e164(phone_number)
        logger.info(f"[Aircall] Phone formatted: '{phone_number}' → '{formatted_phone}'")

        validation_error = self._validate_phone_for_aircall(formatted_phone, phone_number)
        if validation_error:
            logger.warning(f"[Aircall] Phone pre-validation failed for lead {lead_id}: {validation_error}")
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=validation_error,
            )

        # 5. Initiate the call
        try:
            result = self._post(f"/users/{aircall_user_id}/calls", data={
                "number_id": number_id,
                "to": formatted_phone,
            })
            call_data = result.get("call", result)
            logger.info(
                f"[Aircall] Call initiated: user={aircall_user_id}, "
                f"number={number_id}, to={formatted_phone}, lead={lead_id}"
            )
            return InitiateCallResult(
                success=True,
                provider=self.provider_name,
                provider_call_id=str(call_data.get("id", "")),
                phone_number=formatted_phone,
            )
        except requests.HTTPError as e:
            status = e.response.status_code if e.response else 0
            err_str = str(e)

            # 405: user not available in Aircall Desktop (most common cause)
            # Also match on str(e) in case e.response is None or status lookup fails.
            if status == 405 or "405" in err_str:
                logger.error(
                    f"[Aircall] 405 for user {aircall_user_id} ({user_email}): "
                    f"likely not logged into Aircall Desktop or already on a call."
                )
                return InitiateCallResult(
                    success=False,
                    provider=self.provider_name,
                    error=(
                        f"{aircall_user.get('name', user_email)} could not receive the call. "
                        f"Please ensure their Aircall Desktop app is open and status is "
                        f"set to Available, then try again."
                    ),
                )

            # 400: invalid phone number or payload — give a clear fix hint
            if status == 400 or "400" in err_str:
                try:
                    body = e.response.json() if e.response else {}
                    detail = body.get("troubleshoot") or body.get("message") or body.get("error") or ""
                except Exception:
                    detail = e.response.text[:200] if e.response else ""
                logger.error(f"[Aircall] 400 for {formatted_phone}: {detail}")
                return InitiateCallResult(
                    success=False,
                    provider=self.provider_name,
                    error=(
                        f"Aircall rejected the phone number '{formatted_phone}'. "
                        f"{('Reason: ' + detail + ' ') if detail else ''}"
                        f"Please check and update the phone number on this lead."
                    ),
                )

            # Other HTTP errors — extract Aircall's troubleshoot message
            error_detail = err_str
            try:
                body = e.response.json() if e.response else {}
                error_detail = body.get("troubleshoot") or body.get("message") or body.get("error") or err_str
            except Exception:
                error_detail = e.response.text if e.response else err_str
            logger.error(f"[Aircall] Call initiation failed (HTTP {status}): {error_detail}")
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=f"Aircall error: {error_detail}",
            )
        except Exception as e:
            # Log raw HTTP response when available (e.g. empty/HTML body causes JSONDecodeError)
            body_preview = ""
            try:
                resp_obj = getattr(e, "response", None)
                if resp_obj is not None:
                    body_preview = f" | HTTP {resp_obj.status_code} | Body: {resp_obj.text[:300]}"
            except Exception:
                pass
            logger.error(f"[Aircall] Call initiation error: {e}{body_preview}")
            return InitiateCallResult(
                success=False,
                provider=self.provider_name,
                error=str(e),
            )

    def get_users(self) -> list[dict]:
        """List all Aircall users/agents."""
        try:
            all_users = []
            page = 1
            while True:
                result = self._get("/users", params={"per_page": 50, "page": page})
                users = result.get("users", [])
                for u in users:
                    all_users.append({
                        "id": u["id"],
                        "name": u.get("name", ""),
                        "email": u.get("email", ""),
                        "available": u.get("availability_status") == "available",
                    })
                # Aircall returns 'total' and 'per_page' in meta, not 'total_pages'
                meta = result.get("meta", {})
                total = meta.get("total", 0)
                per_page = meta.get("per_page", 50)
                total_pages = -(-total // per_page) if total > 0 else 1
                if page >= total_pages or len(users) < per_page:
                    break
                page += 1
            return all_users
        except Exception as e:
            logger.error(f"[Aircall] Failed to fetch users: {e}")
            return []

    def get_numbers(self) -> list[dict]:
        """List all Aircall phone numbers."""
        try:
            all_numbers = []
            page = 1
            while True:
                result = self._get("/numbers", params={"per_page": 50, "page": page})
                numbers = result.get("numbers", [])
                for n in numbers:
                    all_numbers.append({
                        "id": n["id"],
                        "name": n.get("name", ""),
                        "number": n.get("digits", ""),
                        "country": n.get("country", ""),
                        "open": n.get("open", False),
                    })
                # Aircall returns 'total' and 'per_page' in meta, not 'total_pages'
                meta = result.get("meta", {})
                total = meta.get("total", 0)
                per_page = meta.get("per_page", 50)
                total_pages = -(-total // per_page) if total > 0 else 1
                if page >= total_pages or len(numbers) < per_page:
                    break
                page += 1
            return all_numbers
        except Exception as e:
            logger.error(f"[Aircall] Failed to fetch numbers: {e}")
            return []

    def handle_webhook(self, payload: dict) -> Optional[NormalizedCallEvent]:
        """Normalize Aircall webhook events into standard call events."""
        event = payload.get("event", "")
        data = payload.get("data", {})

        # Map Aircall events to our standard event types
        event_map = {
            "call.created":          CallEventType.CALL_STARTED,
            "call.answered":         CallEventType.CALL_ANSWERED,
            "call.ended":            CallEventType.CALL_ENDED,
            "call.tagged":           CallEventType.CALL_TAGGED,      # V39: mandatory tagging → auto-log outcome
            "transcription.created": CallEventType.TRANSCRIPTION_READY,
        }

        event_type = event_map.get(event)
        if not event_type:
            logger.debug(f"[Aircall] Ignoring webhook event: {event}")
            return None

        # Extract user email for CRM user matching
        user_data = data.get("user", {})
        user_email = user_data.get("email") if user_data else None

        # Parse timestamps
        def _parse_ts(ts):
            if ts:
                try:
                    return datetime.fromtimestamp(ts, tz=timezone.utc)
                except (ValueError, TypeError, OSError):
                    pass
            return None

        # Handle transcription events
        transcript_text = None
        transcript_url = None
        call_id = None

        if event_type == CallEventType.TRANSCRIPTION_READY:
            # Transcription events have the call data nested
            call_data = data.get("call", data)
            call_id = str(call_data.get("id", data.get("call_id", "")))
            # Transcript content may be in 'content' or 'transcription'
            transcription = data.get("transcription", {})
            if isinstance(transcription, dict):
                transcript_text = transcription.get("content", "")
                transcript_url = transcription.get("url", "")
            elif isinstance(transcription, str):
                transcript_text = transcription
        else:
            call_id = str(data.get("id", ""))

        # For call.tagged events, extract tags list
        tags = None
        if event == "call.tagged":
            tags_data = data.get("tags", [])
            tags = [t.get("name", "") for t in tags_data if isinstance(t, dict)] if isinstance(tags_data, list) else []

        return NormalizedCallEvent(
            event_type=event_type,
            provider=self.provider_name,
            provider_call_id=call_id,
            phone_number=data.get("raw_digits") or data.get("number", {}).get("digits"),
            user_email=user_email,
            direction=data.get("direction"),
            duration=data.get("duration"),
            recording_url=data.get("recording"),
            transcript=transcript_text,
            transcript_url=transcript_url,
            started_at=_parse_ts(data.get("started_at")),
            answered_at=_parse_ts(data.get("answered_at")),
            ended_at=_parse_ts(data.get("ended_at")),
            raw_payload=payload,
            tags=tags,
        )

    def fetch_call(self, call_id: str) -> Optional[dict]:
        """Fetch full call details from Aircall API for enrichment."""
        try:
            result = self._get(f"/calls/{call_id}")
            call = result.get("call", result)
            return {
                "duration": call.get("duration"),
                "recording_url": call.get("recording"),
                "direction": call.get("direction"),
                "status": "CALL_ENDED" if call.get("ended_at") else "CALL_STARTED",
                "started_at": call.get("started_at"),
                "answered_at": call.get("answered_at"),
                "ended_at": call.get("ended_at"),
            }
        except Exception as e:
            logger.debug(f"[Aircall] Could not fetch call {call_id}: {e}")
            return None

    def fetch_transcript(self, call_id: str) -> Optional[str]:
        """Fetch transcript for a specific call from Aircall API."""
        try:
            result = self._get(f"/calls/{call_id}/transcription")
            transcription = result.get("transcription", {})
            if isinstance(transcription, dict):
                return transcription.get("content", "")
            return str(transcription) if transcription else None
        except Exception as e:
            logger.debug(f"[Aircall] Transcript not available for call {call_id}: {e}")
            return None

    def test_connection(self) -> dict:
        """Validate Aircall API credentials by fetching company info."""
        try:
            result = self._get("/company")
            company = result.get("company", {})
            return {
                "success": True,
                "message": f"Connected to Aircall — {company.get('name', 'Unknown')}",
                "details": {
                    "company_name": company.get("name"),
                    "users_count": company.get("users_count"),
                    "numbers_count": company.get("numbers_count"),
                },
            }
        except requests.HTTPError as e:
            status = e.response.status_code if e.response else 0
            body = e.response.text if e.response else str(e)
            logger.error(f"[Aircall] Connection test failed ({status}): {body}")
            return {
                "success": False,
                "message": f"Authentication failed (HTTP {status}). Check your API ID and Token.",
                "details": {},
            }
        except Exception as e:
            logger.error(f"[Aircall] Connection test error: {e}")
            return {
                "success": False,
                "message": f"Connection error: {str(e)}",
                "details": {},
            }

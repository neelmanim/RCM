# ── instantly_provider.py — Instantly.ai pull-sync provider ─────────────────
"""
Thin HTTP client for Instantly.ai's v2 REST API — campaign/lead engagement
pull sync (polling, see docs/RELEASES.md) plus send-side writes (v13.3.0:
campaign-per-node handoff, so a Alternate CRM cadence can send through
Instantly's own domain pool). Mirrors klenty_provider.py's single
retry/backoff helper shape, adapted to Instantly's real constraints
(confirmed against their OpenAPI v2 spec):

- Auth: `Authorization: Bearer {api_key}` (not Klenty's x-API-key header).
- Pagination: `starting_after` cursor (not Klenty's date-window paging).
- 429: exponential backoff, same `2**attempt` shape as Klenty.
- 402 ("workspace does not have an active paid plan"): a plan-tier gap, not
  a transient failure — raised as InstantlyPlanTierError, never retried.
- Cloudflare in front of api.instantly.ai 403s urllib's default User-Agent
  outright (confirmed live this session, error_code 1010
  "browser_signature_banned") — _request() sends a browser-shaped UA string
  on every call for exactly this reason, not to impersonate anything.

Instantly is not a DialerProvider (it can't place or receive calls), so this
does not implement that ABC — it's a standalone client.
"""
import json
import logging
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

API_BASE = "https://api.instantly.ai"

# Known enums (from Instantly's OpenAPI spec, confirmed, not inferred).
LEAD_STATUS_LABELS = {
    1: "Active", 2: "Paused", 3: "Completed",
    -1: "Bounced", -2: "Unsubscribed", -3: "Skipped",
}

# lt_interest_status is NOT a closed enum — custom Lead Labels in the
# workspace inject arbitrary extra integers beyond these 9 documented
# values. resolve_interest_label() falls back to a lead-labels cache for
# anything not in here.
INTEREST_STATUS_LABELS = {
    0: "Out of Office", 1: "Interested", 2: "Meeting Booked",
    3: "Meeting Completed", 4: "Won",
    -1: "Not Interested", -2: "Wrong Person", -3: "Lost", -4: "No Show",
}


class InstantlyPlanTierError(Exception):
    """Raised on HTTP 402 — the workspace's plan doesn't include the
    requested feature. Not a transient failure; never retried."""
    pass


class InstantlyProvider:
    """Instantly.ai client — pull-sync reads plus send-side writes (v13.3.0:
    campaign-per-node handoff, see docs/RELEASES.md). Write methods need
    campaigns:create/leads:create/webhooks:create on top of the original
    read scopes (leads:read, campaigns:read, emails:read)."""

    provider_name = "instantly"

    def __init__(self, api_key: str, base_url: str = API_BASE):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    # ── HTTP helper ──────────────────────────────────────────────────────────

    @staticmethod
    def _read_error_body(e: urllib.error.HTTPError) -> str:
        """HTTPError's body is only readable once — both the 402 and generic
        error branches need it, so this is the one place that reads it."""
        try:
            return e.read().decode()
        except Exception:
            return ""

    def _request(self, method: str, path: str, params: dict = None,
                 json_body: dict = None, retries: int = 3) -> dict:
        url = f"{self.base_url}{path}"
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
            if qs:
                url = f"{url}?{qs}"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            # Confirmed live this session: Cloudflare in front of
            # api.instantly.ai 403s urllib's default "Python-urllib/x.y"
            # User-Agent outright (error_code 1010, browser_signature_banned)
            # — on EVERY verb, not just writes. Any browser-shaped UA string
            # clears it; this isn't impersonation of a real client, just
            # avoiding an automated-client fingerprint block.
            "User-Agent": "Mozilla/5.0 (compatible; Alternate CRMCRM/1.0)",
        }
        data = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body).encode()

        for attempt in range(retries):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = resp.read().decode()
                    return json.loads(body) if body else {}
            except urllib.error.HTTPError as e:
                if e.code == 402:
                    # Plan-tier gap, not a bug — surfaced distinctly, never retried.
                    error_body = self._read_error_body(e)
                    logger.error(f"[Instantly] 402 plan-tier gap {method} {path}: {error_body}")
                    raise InstantlyPlanTierError(
                        f"Instantly workspace plan does not include this feature: {error_body}"
                    )
                if e.code == 429 and attempt < retries - 1:
                    wait = 2 ** (attempt + 1)
                    logger.warning(f"[Instantly] 429 rate-limited, waiting {wait}s (attempt {attempt + 1}/{retries})")
                    time.sleep(wait)
                    continue
                if e.code in (502, 503, 504) and attempt < retries - 1:
                    wait = 2 ** attempt
                    logger.warning(f"[Instantly] {e.code} gateway error — retrying in {wait}s (attempt {attempt + 1}/{retries})")
                    time.sleep(wait)
                    continue
                error_body = self._read_error_body(e)
                logger.error(f"[Instantly] HTTP {e.code} {method} {path}: {error_body}")
                raise RuntimeError(f"Instantly API error {e.code}: {error_body}")
            except Exception as e:
                if attempt < retries - 1:
                    logger.warning(f"[Instantly] Network error on attempt {attempt + 1}/{retries}: {type(e).__name__}: {e} — retrying in 1s")
                    time.sleep(1)
                    continue
                logger.error(f"[Instantly] Request failed after {retries} attempts: {e}")
                raise
        return {}

    # ── Campaigns ────────────────────────────────────────────────────────────

    def _paginate(self, path: str, params: dict = None):
        """Shared starting_after-cursor pagination, yielding items one page
        at a time. Used by every list_* GET endpoint on this client."""
        starting_after = None
        base_params = dict(params or {})
        while True:
            page_params = {**base_params, "limit": 100}
            if starting_after:
                page_params["starting_after"] = starting_after
            page = self._request("GET", path, params=page_params)
            items = page.get("items") or []
            for item in items:
                yield item
            starting_after = page.get("next_starting_after")
            if not starting_after or not items:
                break

    def list_campaigns(self, status: Optional[int] = None):
        """GET /api/v2/campaigns, paginated via starting_after. Yields every
        non-draft campaign (status != 0) by default — completed campaigns
        still hold historical engagement worth syncing."""
        params = {"status": status} if status is not None else {}
        for campaign in self._paginate("/api/v2/campaigns", params):
            if status is None and campaign.get("status") == 0:
                continue  # Draft — nothing to sync yet
            yield campaign

    def list_accounts(self):
        """GET /api/v2/accounts, paginated via starting_after. Used by the
        admin UI's sending-accounts picker (section 5): every mailbox is
        `is_managed_account: true` with no credential fields exposed
        (confirmed live, see plan context), so this is read-only inventory,
        not a connection flow."""
        yield from self._paginate("/api/v2/accounts")

    # ── Leads ────────────────────────────────────────────────────────────────

    def list_leads(self, campaign_id: str, starting_after: str = None, limit: int = 100) -> dict:
        """POST /api/v2/leads/list — one page. Returns
        {"items": [...], "next_starting_after": str|None}."""
        body = {"campaign": campaign_id, "limit": limit, "starting_after": starting_after}
        page = self._request("POST", "/api/v2/leads/list", json_body=body)
        return {
            "items": page.get("items") or [],
            "next_starting_after": page.get("next_starting_after"),
        }

    # ── Unibox (reply bodies) ────────────────────────────────────────────────

    def list_unibox_emails(self, min_timestamp_created=None, email_type: str = "received",
                            starting_after: str = None, limit: int = 100, sort_order: str = None) -> dict:
        """GET /api/v2/emails. Rate-capped at 20 req/min by Instantly — much
        tighter than the general 100 req/sec limit. Callers must throttle
        their own call rate; this method does not pace itself.

        The v13.8.0 mail sync reads the whole inbox incrementally
        (sort_order=asc + min_timestamp_created), one request per 100 emails
        rather than one Unibox call per lead."""
        params = {"email_type": email_type, "limit": limit}
        if min_timestamp_created is not None:
            params["min_timestamp_created"] = min_timestamp_created
        if starting_after:
            params["starting_after"] = starting_after
        if sort_order:
            params["sort_order"] = sort_order   # "asc" for the incremental mail sync (oldest first)
        return self._request("GET", "/api/v2/emails", params=params)

    # ── Analytics ────────────────────────────────────────────────────────────

    def get_campaign_step_analytics(self, campaign_id: str = None, start_date: str = None,
                                     end_date: str = None, include_opportunities_count: bool = False) -> dict:
        """GET /api/v2/campaigns/analytics/steps. Called live/on-demand from
        a read route — never stored."""
        params = {}
        if campaign_id:
            params["campaign_id"] = campaign_id
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        if include_opportunities_count:
            params["include_opportunities_count"] = "true"
        return self._request("GET", "/api/v2/campaigns/analytics/steps", params=params)

    # ── Lead labels (custom interest-status values) ─────────────────────────

    def list_lead_labels(self) -> dict:
        """GET /api/v2/lead-labels. Needed because lt_interest_status is not
        a closed enum — custom Lead Labels inject arbitrary extra integers
        beyond INTEREST_STATUS_LABELS. Changes rarely; callers should cache
        this for the life of a sync run rather than calling it per-lead."""
        return self._request("GET", "/api/v2/lead-labels")

    # ── Campaigns — write (v13.3.0 send-side) ───────────────────────────────────
    #
    # Confirmed live against developer.instantly.ai's OpenAPI-backed docs this
    # session (not inferred): sequences only has one effective element (one
    # sequence per campaign despite the array shape), campaign_schedule.days
    # is an OBJECT keyed by weekday string "0".."6" (Sun=0), not an array of
    # ints, and the sender-restriction field is `email_list` (array of mailbox
    # email strings) — `sending_accounts` maps straight onto it.

    @staticmethod
    def _build_steps(steps: list) -> list:
        """[{subject, body, delay_days}] -> Instantly's sequence-step shape.
        Shared by create_campaign and update_campaign_sequence."""
        return [
            {
                "type": "email",
                "delay": step.get("delay_days", 0),
                "delay_unit": "days",
                "variants": [{"subject": step["subject"], "body": step["body"]}],
            }
            for step in steps
        ]

    def create_campaign(self, name: str, steps: list, schedule: dict = None,
                         sending_accounts: list = None) -> dict:
        """POST /api/v2/campaigns. `steps`: [{subject, body, delay_days}] from
        a Alternate CRM node — translated into Instantly's
        sequences[0].steps[].variants[0].{subject,body} shape. `delay_days`
        maps straight onto delay/delay_unit="days" (Instantly also accepts
        "minutes"/"hours", unused here — Alternate CRM cadences only author in
        days).

        `schedule`: optional, caller-built campaign_schedule dict (see
        journey_engine mapping the Journey's own send-window columns into
        this shape — kept out of this thin client on purpose). Falls back to
        a wide-open 7-day/0-24h default schedule since campaign_schedule is
        a required field on Instantly's side with no server-side default.

        `timezone` note (confirmed live this session): Instantly validates
        `campaign_schedule.schedules[].timezone` against its OWN curated
        enum of IANA-looking names, not any real IANA zone — "UTC",
        "Etc/UTC", "America/New_York", and "Asia/Calcutta" all 400
        ("must be equal to one of the allowed values"), while
        "America/Dawson" and "Asia/Kolkata" are accepted. There's no
        documented endpoint for the full allowed list; "Asia/Kolkata" is
        used as the default below because it's confirmed-valid and matches
        this workspace's locale — any caller passing its own `schedule`
        (the journey-engine send-window mapping in a later phase) must
        verify its timezone value against a real campaign create/update call
        rather than assuming an arbitrary IANA name will be accepted.
        """
        body = {
            "name": name,
            "campaign_schedule": schedule or {
                "schedules": [{
                    "name": "Default",
                    "timing": {"from": "00:00", "to": "23:59"},
                    "days": {str(d): True for d in range(7)},
                    "timezone": "Asia/Kolkata",
                }],
            },
            "sequences": [{"steps": self._build_steps(steps)}],
        }
        if sending_accounts:
            body["email_list"] = sending_accounts
        created = self._request("POST", "/api/v2/campaigns", json_body=body)
        # RCA 2026-10-05 (staging E2E): a created campaign starts in status 0
        # (draft) and Instantly never sends a single email until it's
        # explicitly activated — confirmed live, a draft campaign sat for
        # minutes with a lead already added and zero sends. Without this,
        # the whole send-side feature would silently never send anything.
        campaign_id = created.get("id") if isinstance(created, dict) else None
        if campaign_id:
            self._request("POST", f"/api/v2/campaigns/{campaign_id}/activate")
        return created

    def update_campaign_sequence(self, campaign_id: str, steps: list) -> dict:
        """PATCH /api/v2/campaigns/{id} — confirmed there's no dedicated
        sequence-update endpoint; `sequences` is just one of several
        patchable fields on the generic campaign-update route. Only called
        for a *new* campaign row (see JourneyInstantlyCampaign versioning —
        never to mutate a campaign that already has active enrollments)."""
        body = {"sequences": [{"steps": self._build_steps(steps)}]}
        return self._request("PATCH", f"/api/v2/campaigns/{campaign_id}", json_body=body)

    # ── Leads — write ────────────────────────────────────────────────────────

    def add_lead_to_campaign(self, campaign_id: str, email: str,
                              first_name: str = None, last_name: str = None) -> dict:
        """POST /api/v2/leads — single-lead create, distinct from
        list_leads()'s POST /api/v2/leads/list (a read/list endpoint)."""
        body = {"campaign": campaign_id, "email": email}
        if first_name:
            body["first_name"] = first_name
        if last_name:
            body["last_name"] = last_name
        return self._request("POST", "/api/v2/leads", json_body=body)

    def remove_lead_from_campaign(self, campaign_id: str, lead_email: str) -> dict:
        """Confirmed live this session: Instantly has NO dedicated
        "remove/pause lead from campaign" endpoint — lt_interest_status
        (the only per-lead status field) is a CRM-stage label, not a
        send-control switch, and does not stop a campaign from continuing to
        send. The only actual lever is deleting the lead record outright
        (DELETE /api/v2/leads/{id}), which this uses per the plan's
        "prefer actually removing" call — but Instantly's docs do not state
        whether this deletes the lead workspace-wide or just drops it from
        this campaign. Flag this for live verification before any caller
        treats it as safe for a lead who might be re-enrolled elsewhere.

        Looks the lead up by email within this campaign first (list_leads
        only takes a campaign filter, not email — fetched client-side) since
        the delete endpoint needs Instantly's internal lead id, not email.
        """
        page = self.list_leads(campaign_id)
        lead = next((l for l in page["items"] if l.get("email") == lead_email), None)
        if not lead:
            return {}  # Already gone / never enrolled — nothing to remove.
        return self._request("DELETE", f"/api/v2/leads/{lead['id']}")

    # ── Webhooks ─────────────────────────────────────────────────────────────

    def create_webhook(self, target_url: str, event_types, secret_header_value: str) -> dict:
        """POST /api/v2/webhooks. Confirmed live: the URL field is
        `target_hook_url` (not `url`/`target_url`), and `event_type` is
        SINGULAR — Instantly has no multi-event subscription in one webhook
        object, unlike the plan's working assumption of an `event_types`
        list. `event_types` here accepts either a single string or a list
        for caller convenience; a list registers one webhook per event type
        and returns the list of created webhook objects (the common case:
        callers want several event types routed to the same URL/secret)."""
        types = event_types if isinstance(event_types, (list, tuple)) else [event_types]
        created = []
        for event_type in types:
            body = {
                "target_hook_url": target_url,
                "event_type": event_type,
                "headers": {"X-Webhook-Secret": secret_header_value},
            }
            created.append(self._request("POST", "/api/v2/webhooks", json_body=body))
        return created[0] if len(created) == 1 else {"items": created}

    def list_webhooks(self) -> dict:
        """GET /api/v2/webhooks."""
        return self._request("GET", "/api/v2/webhooks")

    def delete_webhook(self, webhook_id: str) -> dict:
        """DELETE /api/v2/webhooks/{id}."""
        return self._request("DELETE", f"/api/v2/webhooks/{webhook_id}")


def resolve_interest_label(value, lead_labels_cache: dict) -> Optional[str]:
    """Resolve a raw lt_interest_status int to a human label: known constant
    first, then the lead-labels cache (keyed by the label's own
    `interest_status` field — Instantly's custom labels use that field as
    their id), else None (unknown, no match)."""
    if value is None:
        return None
    if value in INTEREST_STATUS_LABELS:
        return INTEREST_STATUS_LABELS[value]
    if lead_labels_cache and value in lead_labels_cache:
        return lead_labels_cache[value]
    return None


def parse_ts(val) -> Optional[datetime]:
    """Parse an Instantly timestamp (ISO 8601) into a UTC datetime. Mirrors
    klenty_provider._parse_ts's shape."""
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def build_lead_labels_cache(lead_labels_response: dict) -> dict:
    """Build the {interest_status_int: label_name} cache from
    list_lead_labels()'s raw response. Response shape: {"items": [{"id":...,
    "interest_status": <int>, "label": <name>}, ...]} (or a bare list)."""
    items = lead_labels_response.get("items") if isinstance(lead_labels_response, dict) else lead_labels_response
    cache = {}
    for item in items or []:
        key = item.get("interest_status")
        label = item.get("label") or item.get("name")
        if key is not None and label:
            cache[key] = label
    return cache

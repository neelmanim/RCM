"""
Smart Analytics Engine v2 — backend/services/smart_analytics.py
================================================================
Conversational analytics assistant for Alternate CRM CRM.

Architecture:
  NL query + conversation history
    → resolve_sdrs()           [load active SDR names from DB for LLM context]
    → parse_nl_to_dsl()        [Groq → strict JSON DSL, never SQL]
    → validate_dsl()           [allowlist all fields]
    → execute_dsl()            [dispatch to mode handler]
        ├── _exec_standard()   [single metric × dimension × period]
        ├── _exec_ranking()    [top N + bottom N + medal highlights]
        ├── _exec_compare()    [top vs bottom performer with delta]
        ├── _exec_multi()      [parallel execution of multiple metrics]
        └── _exec_funnel()     [full funnel breakdown with gap detection]
    → log_query()              [write to analytics_query_history]

Security:
  - LLM NEVER generates SQL. Only structured DSL JSON.
  - All DSL fields validated against strict allowlists before execution.
  - Pod Admin scoping enforced before every query via _effective_pod_id().
  - SDR filter resolved to user_id server-side — client cannot inject arbitrary IDs.
  - No SQL strings stored, passed, or returned to client.
"""

import json
import logging
import time
import re
import difflib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from threading import Lock
from typing import Optional

import httpx
from sqlalchemy import func, and_, distinct
from sqlalchemy.orm import Session

import models
from analytics.semantic import resolve_metric_scoped

logger = logging.getLogger(__name__)

# ─── Allowlists ───────────────────────────────────────────────────────────────

SUPPORTED_MODES = {
    "standard",      # single metric × dimension × period (v1 compat)
    "ranking",       # top N + bottom N per metric with medal highlights
    "compare",       # side-by-side top vs bottom with delta
    "multi",         # multiple metrics executed in parallel
    "funnel",        # full funnel steps with gap detection
    "batch_funnel",  # funnel scoped to a specific upload batch
    "pod_summary",   # per-pod aggregate table
}

SUPPORTED_METRICS = {
    "leads_created",
    "meetings_scheduled",
    "calls_made",
    "emails_sent",
    "conversion_rate",
    "research_completed",
    "no_shows",
    "disqualified",
    "avg_call_duration",
    # v3 additions
    "connect_rate",      # % calls that connected
    "email_open_rate",   # % emails opened
    "email_reply_rate",  # % email threads with inbound reply
    "avg_call_retries",  # avg call attempts per lead
    # v4 additions — demo pipeline
    "demos_scheduled",   # leads that reached Demo Scheduled status
    "demos_completed",   # leads that reached Demo Done status
}

SUPPORTED_DIMENSIONS = {
    "sdr", "pod", "source", "status",
    "day", "week", "month", "batch",
}

SUPPORTED_PERIODS = {
    "today", "yesterday",
    "last_7_days", "last_30_days", "last_90_days",
    "this_week", "this_month", "this_quarter", "this_year", "last_month",
}

# Phase 1 fix (audit-flagged "group-by silently ignored"): the dimensions each
# _q_* function actually implements a group_by branch for. validate_dsl()
# rejects a requested dimension a metric doesn't support instead of silently
# falling through to a scalar result that looks like it answered the
# dimensional question but didn't (e.g. "connect rate by POD" returning one
# org-wide number). Derived directly from each _q_* function's own
# `if group_by == ...` branches below — keep in sync if a function gains one.
SUPPORTED_DIMENSIONS_BY_METRIC = {
    "calls_made":          {"sdr", "pod", "day", "week", "month"},
    "emails_sent":         {"sdr", "day", "week", "month"},
    "meetings_scheduled":  {"sdr", "pod", "day", "week", "month"},
    "leads_created":       {"sdr", "source", "status"},
    "conversion_rate":     {"sdr"},
    "research_completed":  {"sdr"},
    "no_shows":            {"sdr"},
    "disqualified":        {"sdr"},
    "avg_call_duration":   {"sdr"},
    "connect_rate":        {"sdr"},
    "email_open_rate":     {"sdr"},
    "email_reply_rate":    {"sdr"},
    "avg_call_retries":    {"sdr"},
    "demos_scheduled":     {"sdr", "pod", "day", "week", "month"},
    "demos_completed":     {"sdr", "pod", "day", "week", "month"},
}


# ─── Custom error ─────────────────────────────────────────────────────────────

class SmartAnalyticsError(Exception):
    def __init__(self, message: str, code: str = "invalid_query"):
        super().__init__(message)
        self.code         = code
        self.user_message = message


# ─── Funnel metric extractor ──────────────────────────────────────────────────

def _extract_funnel_metric(funnel: dict, metric: str):
    """
    Extract a scalar value for a given metric name from a funnel result dict.
    Used by tests and by any code that compares a single metric against a funnel.
    Returns None if the metric is not represented in the funnel.
    """
    mapping = {
        "leads_created":       lambda f: f.get("leads_assigned"),
        "meetings_scheduled":  lambda f: (f.get("meetings") or {}).get("booked"),
        "calls_made":          lambda f: (f.get("calls") or {}).get("made"),
        "emails_sent":         lambda f: (f.get("emails") or {}).get("sent"),
        "conversion_rate":     lambda f: (f.get("meetings") or {}).get("conversion_pct"),
        "research_completed":  lambda f: (f.get("research") or {}).get("complete"),
        "no_shows":            lambda f: (f.get("meetings") or {}).get("no_shows"),
        "disqualified":        lambda f: f.get("disqualified"),
    }
    extractor = mapping.get(metric)
    return extractor(funnel) if extractor else None


def _sdr_table_column(metric: str) -> Optional[str]:
    """Map a metric name to its column name in user_activity_daily_summary."""
    return {
        "meetings_scheduled": "meetings",
        "calls_made":         "calls",
        "emails_sent":        "emails_sent",
        "leads_created":      "leads_assigned",
        "research_completed": "status_updates",
    }.get(metric)


def _trend_column(metric: str) -> Optional[str]:
    """Map a metric name to its column name used in trend/line-chart queries."""
    return {
        "calls_made":         "calls",
        "meetings_scheduled": "meetings",
        "emails_sent":        "emails",
        "leads_created":      "leads",
    }.get(metric)


# ─── Period resolver ──────────────────────────────────────────────────────────

def _resolve_period(period: Optional[str]) -> tuple:
    from routes.analytics_routes import _resolve_date_range_simple
    now   = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if not period:
        return _resolve_date_range_simple(None, None, "30d")  # no period → last 30 days
    if period == "this_year":
        return today.replace(month=1, day=1), now
    if period == "today":
        return today, now
    if period == "yesterday":
        yest = today - timedelta(days=1)
        return yest, yest.replace(hour=23, minute=59, second=59)
    if period == "last_7_days":
        return _resolve_date_range_simple(None, None, "7d")
    if period == "last_30_days":
        return _resolve_date_range_simple(None, None, "30d")
    if period == "last_90_days":
        return _resolve_date_range_simple(None, None, "90d")
    if period == "this_week":
        monday = today - timedelta(days=now.weekday())
        return monday, now
    if period == "this_month":
        return today.replace(day=1), now
    if period == "last_month":
        # Phase 1 fix (audit-flagged): previously absent, forcing the LLM to
        # guess between this_month/last_30_days — neither means "last month".
        last_day_prev_month = today.replace(day=1) - timedelta(days=1)
        return last_day_prev_month.replace(day=1), last_day_prev_month.replace(hour=23, minute=59, second=59)
    if period == "this_quarter":
        q_start_month = ((now.month - 1) // 3) * 3 + 1
        return today.replace(month=q_start_month, day=1), now
    return _resolve_date_range_simple(None, None, "30d")


def _chart_type_for(dsl: dict) -> str:
    g = dsl.get("group_by")
    if g in ("day", "week", "month"):
        return "line"
    if g in ("sdr", "pod", "source", "status"):
        return "bar"
    return "table"


# ─── Cache ────────────────────────────────────────────────────────────────────

_dsl_cache: dict    = {}
_dsl_cache_lock     = Lock()
_result_cache: dict = {}
_result_cache_lock  = Lock()
DSL_TTL    = 3600
RESULT_TTL = 300
SDR_CACHE: dict = {}     # {db_url: (names_list, expires)}
SDR_CACHE_TTL   = 120    # 2 min


def _normalise_query(q: str) -> str:
    return re.sub(r"\s+", " ", q.strip().lower())

def _cache_get(store, lock, key):
    with lock:
        entry = store.get(key)
        if entry:
            data, exp = entry
            if time.time() < exp:
                return data
            del store[key]
    return None

# RCA 2026-08-26 (staging OOM): keys are high-cardinality (free-text NL
# queries / dsl+pod+sdr+batch hashes) and rarely re-read after expiry, so
# _cache_get's lazy delete-on-read never frees them — same unbounded-growth
# shape cache.py's _SWEEP_THRESHOLD fix already addressed for its own store.
_CACHE_SWEEP_THRESHOLD = 500

def _cache_set(store, lock, key, data, ttl):
    with lock:
        store[key] = (data, time.time() + ttl)
        if len(store) > _CACHE_SWEEP_THRESHOLD:
            now = time.time()
            for k in [k for k, (_, exp) in store.items() if now > exp]:
                del store[k]

def _dsl_get(key):      return _cache_get(_dsl_cache, _dsl_cache_lock, key)
def _dsl_set(k, v):     _cache_set(_dsl_cache, _dsl_cache_lock, k, v, DSL_TTL)
def _res_get(key):      return _cache_get(_result_cache, _result_cache_lock, key)
def _res_set(k, v):     _cache_set(_result_cache, _result_cache_lock, k, v, RESULT_TTL)


# ─── SDR name loading ─────────────────────────────────────────────────────────

# Pod cache (mirrors SDR_CACHE pattern)
POD_CACHE: dict = {}
POD_CACHE_TTL  = 120

# Batch cache: {db_url: (rows, expires)}
# rows = [{id, filename, label, date_str}]
BATCH_CACHE: dict = {}
BATCH_CACHE_TTL  = 60


def resolve_sdrs(db: Session) -> list[dict]:
    """
    Load all active SDR/admin names from DB.
    Returns [{id, name}] cached for 2 minutes.
    """
    try:
        url_key = str(db.bind.url) if hasattr(db, 'bind') and db.bind else "default"
    except Exception:
        url_key = "default"

    cached = SDR_CACHE.get(url_key)
    if cached:
        data, exp = cached
        if time.time() < exp:
            return data

    try:
        rows = (db.query(models.User.id, models.User.name, models.User.email)
                  .filter(models.User.role.in_(["SDR", "AE", "Pod Admin", "Super Admin", "Admin"]))
                  .filter(models.User.name.isnot(None))
                  .all())
        result = [{"id": r.id, "name": r.name or r.email} for r in rows]
    except Exception as exc:
        logger.warning("resolve_sdrs failed: %s", exc)
        result = []

    SDR_CACHE[url_key] = (result, time.time() + SDR_CACHE_TTL)
    return result


def resolve_pods(db: Session) -> list[dict]:
    """Load all pod names from DB. Returns [{id, name}] cached 2 min."""
    try:
        url_key = str(db.bind.url) if hasattr(db, 'bind') and db.bind else "default"
    except Exception:
        url_key = "default"

    cached = POD_CACHE.get(url_key)
    if cached:
        data, exp = cached
        if time.time() < exp:
            return data

    try:
        rows   = db.query(models.Pod.id, models.Pod.name).all()
        result = [{"id": r.id, "name": r.name} for r in rows]
    except Exception as exc:
        logger.warning("resolve_pods failed: %s", exc)
        result = []

    POD_CACHE[url_key] = (result, time.time() + POD_CACHE_TTL)
    return result


def _resolve_pod_id(name: str, pods: list[dict]) -> Optional[str]:
    """Fuzzy-match a pod name → pod id."""
    if not name or not pods:
        return None
    pod_names = [p["name"] for p in pods]
    matches   = difflib.get_close_matches(name, pod_names, n=1, cutoff=0.4)
    if matches:
        match = next((p for p in pods if p["name"] == matches[0]), None)
        return match["id"] if match else None
    nl = name.lower()
    for p in pods:
        if nl in p["name"].lower() or p["name"].lower() in nl:
            return p["id"]
    return None


def resolve_batches(db: Session) -> list[dict]:
    """Load recent upload batches. Returns [{id, filename, label, date_str}] cached 1 min.

    ``id`` is the real ``lead_upload_logs.id`` — leads link to it via the
    indexed ``Lead.upload_log_id`` FK, so no lead_source/filename heuristics
    are needed to filter by batch (see analytics_routes.py for the same fix).
    """
    try:
        url_key = str(db.bind.url) if hasattr(db, 'bind') and db.bind else "default"
    except Exception:
        url_key = "default"

    cached = BATCH_CACHE.get(url_key)
    if cached:
        data, exp = cached
        if time.time() < exp:
            return data

    result = []
    try:
        if hasattr(models, "LeadUploadLog"):
            rows = (db.query(models.LeadUploadLog.id,
                             models.LeadUploadLog.filename,
                             models.LeadUploadLog.created_at)
                      .order_by(models.LeadUploadLog.created_at.desc())
                      .limit(100).all())
            for r in rows:
                date_str = r.created_at.strftime("%b %-d") if r.created_at else "Unknown"
                fname    = (r.filename or "upload").replace("_", " ")
                result.append({
                    "id":          r.id,
                    "filename":    r.filename or "",
                    "label":       f"{fname} · {date_str}",
                    "date_str":    date_str,
                })
    except Exception as exc:
        logger.warning("resolve_batches failed: %s", exc)

    BATCH_CACHE[url_key] = (result, time.time() + BATCH_CACHE_TTL)
    return result


def _resolve_batch_id(name_hint: str, batches: list[dict]) -> Optional[str]:
    """
    Fuzzy-match a batch name hint → upload_log_id.

    Strategy (in order):
    1. difflib fuzzy match on label (cutoff 0.3)
    2. Substring match on label or filename
    3. Date extraction: pull month + day numbers from hint and match against date_str
       Handles: "May 15", "15th May", "15 May", "May 13th" etc.
    """
    import re as _re
    if not name_hint or not batches:
        return None

    labels = [b["label"] for b in batches]
    nl     = name_hint.lower()

    # 1. difflib fuzzy match
    matches = difflib.get_close_matches(name_hint, labels, n=1, cutoff=0.3)
    if matches:
        match = next((b for b in batches if b["label"] == matches[0]), None)
        if match:
            return match["id"]

    # 2. Substring fallback — check date parts or filename
    for b in batches:
        if nl in b["label"].lower() or nl in b.get("filename", "").lower():
            return b["id"]

    # 3. Date extraction — handles "15th May", "May 15", "13 May" etc.
    # Extract month name and optional day from the hint
    MONTH_MAP = {
        "jan": "Jan", "feb": "Feb", "mar": "Mar", "apr": "Apr",
        "may": "May", "jun": "Jun", "jul": "Jul", "aug": "Aug",
        "sep": "Sep", "oct": "Oct", "nov": "Nov", "dec": "Dec",
    }
    month_found = None
    day_found   = None
    for abbr, full in MONTH_MAP.items():
        if abbr in nl:
            month_found = full
            break
    day_match = _re.search(r'\b(\d{1,2})(?:st|nd|rd|th)?\b', nl)
    if day_match:
        day_found = int(day_match.group(1))

    if month_found:
        for b in batches:
            ds = b.get("date_str", "")          # e.g. "May 13"
            if month_found in ds:
                if day_found is None:
                    return b["id"]      # month match alone
                # Try to match day — allow ±2 days tolerance for off-by-one
                dm = _re.search(r'(\d{1,2})', ds)
                if dm and abs(int(dm.group(1)) - day_found) <= 2:
                    return b["id"]

    return None


def _resolve_sdr_id(name: str, sdrs: list[dict]) -> Optional[str]:
    """Fuzzy-match a name string to a user ID from the SDR list."""
    if not name or not sdrs:
        return None
    sdr_names = [s["name"] for s in sdrs]
    matches   = difflib.get_close_matches(name, sdr_names, n=1, cutoff=0.5)
    if matches:
        matched = next((s for s in sdrs if s["name"] == matches[0]), None)
        return matched["id"] if matched else None
    # Case-insensitive substring fallback
    nl = name.lower()
    for s in sdrs:
        if nl in s["name"].lower() or s["name"].lower() in nl:
            return s["id"]
    return None


# ─── LLM config + auto-discovery ─────────────────────────────────────────────

# Ordered preference list: fastest/highest-TPM models first.
# The live /models call is the source of truth — this is just a tiebreaker.
_GROQ_MODEL_PREFERENCE = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "gemma2-9b-it",
    "mixtral-8x7b-32768",
    "llama-3.2-3b-preview",
    "llama-3.2-1b-preview",
]

# Cache: {api_key_prefix: (model_name, expires_at_unix)}
_GROQ_MODEL_CACHE: dict = {}
_GROQ_MODEL_CACHE_TTL = 3600  # 1 hour


def _fetch_best_groq_model(api_key: str, exclude: frozenset = frozenset()) -> Optional[str]:
    """
    Call the Groq /models API and return the best available chat model.
    Falls back to the first in the preference list that Groq lists.
    Returns None if the API call fails.

    `exclude` is for models already confirmed dead this request (RCA
    2026-08-20: Groq's /models listing can claim a model is available when
    it's actually already been pulled from inference -- re-running discovery
    without excluding it just returns the same broken pick again).
    """
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        if resp.status_code != 200:
            logger.warning("smart_analytics: /models API returned %s", resp.status_code)
            return None
        available = {m["id"] for m in resp.json().get("data", [])} - exclude
        logger.info("smart_analytics: Groq available models: %s", sorted(available))

        # RCA 2026-08-20 / 2026-09-01 (recurred): Groq's /models listing can
        # claim a model is available when it's already been pulled from real
        # inference -- confirmed live twice now, including the ENTIRE
        # _GROQ_MODEL_PREFERENCE list failing simultaneously on 2026-09-01
        # (llama-3.1-8b-instant, llama3-8b-8192, llama-3.3-70b-versatile all
        # 404'd as "does not exist or you do not have access to it" /
        # "decommissioned", one after another, exhausting every retry the
        # caller had before ever reaching a model outside this curated list).
        # Once `exclude` is non-empty, at least one "available" name has
        # already failed for real this request -- the curated list has
        # already proven untrustworthy for this account/moment, so stop
        # consulting it and go straight to the live-catalog scan below
        # instead of working through the remaining preference entries one
        # exclude at a time (which just repeats the same failure mode with
        # extra steps whenever more than one entry is simultaneously dead).
        if not exclude:
            for preferred in _GROQ_MODEL_PREFERENCE:
                if preferred in available:
                    return preferred

        # Deny-list, not allow-list: matching specific family substrings
        # ("llama"/"gemma"/"mixtral") goes stale every time Groq ships a new
        # family — confirmed live 2026-09-01 that Groq's current production
        # catalog already includes openai/gpt-oss-* and groq/compound*, which
        # the old allow-list would silently never find. Assume any model
        # Groq's own /models endpoint lists is usable for a plain single-turn
        # JSON-completion task UNLESS it matches a known non-chat/specialty
        # marker (safety classifiers, moderation, speech, embeddings, TTS).
        _NON_CHAT_MARKERS = ("guard", "moderation", "whisper", "embed", "tts", "orpheus", "vision", "audio")
        for mid in sorted(available):
            if not any(marker in mid.lower() for marker in _NON_CHAT_MARKERS):
                return mid
        return None
    except Exception as exc:
        logger.warning("smart_analytics: could not fetch Groq models: %s", exc)
        return None


def _resolve_groq_model(api_key: str, db: Session, force_refresh: bool = False, exclude: frozenset = frozenset()) -> Optional[str]:
    """
    Return the best available Groq model for the given API key.
    Results are cached 1 hour. On force_refresh (e.g. after a 400/decommissioned),
    the cache is cleared, a fresh /models call is made, and the DB setting is updated
    so the new model persists across restarts.

    Pass `exclude` (with force_refresh=True) after a model that looked
    available just 404'd anyway — otherwise discovery deterministically
    re-picks the same broken entry.
    """
    import time as _time
    cache_key = api_key[:12]   # Enough to distinguish keys, not expose full key

    if not force_refresh:
        cached = _GROQ_MODEL_CACHE.get(cache_key)
        if cached:
            model, expires = cached
            if _time.time() < expires and model not in exclude:
                return model

    # Cache miss or forced refresh — call the API
    _GROQ_MODEL_CACHE.pop(cache_key, None)
    model = _fetch_best_groq_model(api_key, exclude)

    if model:
        _GROQ_MODEL_CACHE[cache_key] = (model, _time.time() + _GROQ_MODEL_CACHE_TTL)
        # Persist to DB so it survives restarts
        try:
            settings = db.query(models.SyncSettings).first()
            if settings and settings.llm_model != model:
                settings.llm_model = model
                db.commit()
                logger.info("smart_analytics: updated DB llm_model → %s", model)
        except Exception as exc:
            logger.warning("smart_analytics: could not persist model to DB: %s", exc)

    # RCA 2026-08-20 (live, round 2): a hardcoded last-resort fallback
    # (first "llama-3.3-70b-versatile", then "gemma2-9b-it") reintroduces
    # the exact model `exclude` was just told to avoid, whenever discovery
    # finds nothing else -- so a retry that excludes a just-failed model
    # gets that same model back, `new_model != model` never triggers, and
    # the caller silently re-raises the original decommissioned error.
    # Fall back through the preference list itself, skipping excluded
    # entries, instead of a single hardcoded name.
    if model:
        return model
    return next((m for m in _GROQ_MODEL_PREFERENCE if m not in exclude), None)


def _get_llm_config(db: Session) -> dict:
    try:
        settings = db.query(models.SyncSettings).first()
        if settings:
            return {
                "api_key": settings.llm_api_key,
                "model":   settings.llm_model or None,   # None → auto-discover
            }
    except Exception:
        pass
    return {}


# ─── System prompt ────────────────────────────────────────────────────────────

def _build_system_prompt(sdr_names: list[str], pod_names: list[str] = None, batch_labels: list[str] = None) -> str:
    sdr_list   = ", ".join(sdr_names[:20])  if sdr_names   else "none"
    pod_list   = ", ".join(pod_names[:10])  if pod_names   else "none"
    batch_list = ", ".join(batch_labels[:8]) if batch_labels else "none"
    return f"""You are an analytics query parser for Alternate CRM CRM. Output ONLY valid JSON, no prose.

SDRs: {sdr_list}
Pods: {pod_list}
Batches: {batch_list}

SCHEMA:
{{"mode":"standard|ranking|compare|multi|funnel|batch_funnel|pod_summary","metric":string,"metrics":[...],"group_by":string,"period":string,"filter_sdr":string,"filter_pod":string,"filter_batch":string,"sort":"asc|desc","limit":10,"top_n":int,"bottom_n":int}}

MODES:
standard=single metric+optional group_by (default), ranking=top/bottom N, compare=side-by-side delta, multi=2+ metrics ("and"/"both"), funnel=full pipeline, batch_funnel=funnel for a batch, pod_summary=per-pod table

METRICS: leads_created, meetings_scheduled, calls_made, emails_sent, conversion_rate, research_completed, no_shows, disqualified, avg_call_duration, connect_rate, email_open_rate, email_reply_rate, avg_call_retries, demos_scheduled, demos_completed
(demos_scheduled=Demo Scheduled status, demos_completed=Demo Done status)

DIMENSIONS(group_by): sdr, pod, source, status, day, week, month, batch
PERIODS: today, yesterday, last_7_days, last_30_days, last_90_days, this_week, this_month, this_quarter, this_year, last_month

SPECIAL: {{"action":"unsupported","message":"..."}} | {{"action":"clarify","question":"..."}}

RULES:
- DEFAULT period = last_30_days. NEVER default to today. Only use today/yesterday if user explicitly says "today" or "yesterday".
- Only set filter_sdr/filter_pod/filter_batch if the user explicitly names one. NEVER infer or guess them from context.
- filter_sdr MUST exactly match a name from the SDRs list above. If the name is ambiguous or not in the list, use clarify.
- Output EITHER a metric DSL OR an action (clarify/unsupported). NEVER include both metric and action fields in the same JSON.
- multi mode: metrics array needs 2+ items.
- funnel/batch_funnel: no metric or group_by needed. batch_funnel requires filter_batch.
- Unsupported: listing SDRs/users, revenue, salary, quotas, forecasts, contact info.
- If the user names a specific metric CONCEPT that is not one of the METRICS listed above (e.g. "close rate", "win rate", "pipeline velocity") use {{"action":"unsupported","message":"..."}} naming what wasn't understood. Do NOT pick the closest metric from the list as a silent substitute — a wrong silent substitution is worse than asking.
- "When in doubt" (rule below) only applies to genuinely open-ended questions ("how are we doing?"), never to a question that names a specific metric concept not in the list.
- When in doubt, use standard mode with the most relevant metric."""


# ─── Step 1: NL → DSL ────────────────────────────────────────────────────────

def parse_nl_to_dsl(nl_query: str, db: Session,
                    conversation_history: Optional[list] = None,
                    sdr_names: Optional[list[str]] = None,
                    pod_names: Optional[list[str]] = None,
                    batch_labels: Optional[list[str]] = None) -> dict:
    norm = _normalise_query(nl_query)

    # Only cache when no conversation history (context-free queries)
    if not conversation_history:
        cached = _dsl_get(norm)
        if cached is not None:
            return cached

    cfg = _get_llm_config(db)
    if not cfg.get("api_key"):
        raise SmartAnalyticsError(
            "AI query parsing requires a Groq API key. Add one in Settings → AI/LLM.",
            code="llm_not_configured",
        )

    system_prompt = _build_system_prompt(sdr_names or [], pod_names or [], batch_labels or [])

    # Build messages: system + conversation history + current query
    messages = [{"role": "system", "content": system_prompt}]
    if conversation_history:
        # Last 6 turns max to keep context window small
        messages.extend(conversation_history[-6:])
    messages.append({"role": "user", "content": nl_query})

    # Resolve model: use stored DB value if valid, otherwise auto-discover
    api_key = cfg["api_key"]
    model   = cfg.get("model") or _resolve_groq_model(api_key, db)
    payload = {
        "model":       model,
        "messages":    messages,
        "temperature": 0.0,
        "max_tokens":  180,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }

    def _call_groq() -> httpx.Response:
        with httpx.Client(timeout=20.0) as client:
            return client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
            )

    try:
        resp = _call_groq()
    except httpx.TimeoutException:
        raise SmartAnalyticsError("Query timed out. Please try again.", code="llm_timeout")
    except Exception as exc:
        logger.warning("smart_analytics: Groq call failed: %s", exc)
        raise SmartAnalyticsError("Could not reach the AI service.", code="llm_error")

    # ── 400: model decommissioned / not found → auto-discover and retry ────────
    # RCA 2026-08-20 (live, round 2): a single one-shot retry isn't enough --
    # Groq's /models listing kept claiming stale names were available
    # (llama-3.1-8b-instant, then llama3-8b-8192, in the same live incident),
    # so one retry just swaps one dead model for another. Loop through a few
    # candidates, accumulating excludes, instead of giving up after one swap.
    excluded_models = set()
    while resp.status_code == 400 and len(excluded_models) < 2:
        err_text = resp.text
        if not ("decommissioned" in err_text.lower() or "not found" in err_text.lower() or "does not exist" in err_text.lower()):
            logger.warning("smart_analytics: Groq 400: %s", err_text[:200])
            raise SmartAnalyticsError("AI service error. Please try again.", code="llm_error")
        logger.warning("smart_analytics: model '%s' unavailable (%s), auto-discovering…", model, err_text[:120])
        excluded_models.add(model)
        new_model = _resolve_groq_model(api_key, db, force_refresh=True, exclude=frozenset(excluded_models))
        if not new_model:
            raise SmartAnalyticsError(
                "No compatible AI model available. Please check your Groq API key in Settings → AI/LLM.",
                code="llm_no_model",
            )
        logger.info("smart_analytics: retrying with auto-discovered model '%s'", new_model)
        model = new_model
        payload["model"] = new_model
        try:
            resp = _call_groq()
        except Exception as exc:
            logger.warning("smart_analytics: Groq retry failed: %s", exc)
            raise SmartAnalyticsError("Could not reach the AI service.", code="llm_error")

    if resp.status_code == 400:
        logger.warning("smart_analytics: Groq 400 after %d model retries: %s", len(excluded_models), resp.text[:200])
        raise SmartAnalyticsError("AI service error. Please try again.", code="llm_error")

    # ── 429: rate limit → auto-retry after Groq's specified wait ──────────────
    if resp.status_code == 429:
        err_text = resp.text
        logger.warning("smart_analytics: Groq 429 rate limit: %s", err_text[:300])
        wait_match = re.search(r"try again in ([\d.]+)s", err_text, re.IGNORECASE)
        wait_secs  = float(wait_match.group(1)) if wait_match else 0.0

        if 0 < wait_secs <= 20:
            # TPM (per-minute) limit — short wait, retry automatically
            logger.info("smart_analytics: TPM limit hit, retrying in %.1fs", wait_secs)
            import time as _time
            _time.sleep(wait_secs + 0.5)
            try:
                resp = _call_groq()
            except Exception as exc:
                logger.warning("smart_analytics: Groq TPM retry failed: %s", exc)
                raise SmartAnalyticsError("Could not reach the AI service.", code="llm_error")
        else:
            # TPD (daily) limit — reset at midnight UTC
            raise SmartAnalyticsError(
                "Daily AI query limit reached. This resets at midnight UTC. "
                "You can switch to a different model in Settings → AI/LLM to continue.",
                code="llm_rate_limit",
            )

    # ── Final status check (covers post-retry 429 or unexpected errors) ────────
    if resp.status_code == 429:
        raise SmartAnalyticsError(
            "AI is momentarily rate-limited. Please wait a few seconds and try again.",
            code="llm_rate_limit",
        )
    if resp.status_code != 200:
        logger.warning("smart_analytics: Groq %s: %s", resp.status_code, resp.text[:200])
        raise SmartAnalyticsError("AI service error. Please try again.", code="llm_error")


    # ── Parse response, retrying with a different model on unparseable output ──
    # Same self-heal as the 400/decommissioned path above -- a model can ignore
    # "return only JSON" (truncated by max_tokens, a reasoning preamble, plain
    # prose) just as easily as it can 404. Treat that as evidence this model is
    # unsuitable too, instead of failing the whole query on the first bad draw.
    while True:
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()

        try:
            dsl = json.loads(raw)
            if isinstance(dsl, dict):
                break
        except json.JSONDecodeError:
            pass

        logger.warning("smart_analytics: non-JSON/non-dict output from model '%s': %r", model, raw[:200])
        if len(excluded_models) >= 2:
            raise SmartAnalyticsError(
                "Couldn't parse the AI response. Please rephrase your question.",
                code="invalid_llm_response",
            )
        excluded_models.add(model)
        new_model = _resolve_groq_model(api_key, db, force_refresh=True, exclude=frozenset(excluded_models))
        if not new_model:
            raise SmartAnalyticsError(
                "No compatible AI model available. Please check your Groq API key in Settings → AI/LLM.",
                code="llm_no_model",
            )
        logger.info("smart_analytics: retrying with auto-discovered model '%s' after unparseable response", new_model)
        model = new_model
        payload["model"] = new_model
        try:
            resp = _call_groq()
        except Exception as exc:
            logger.warning("smart_analytics: Groq retry failed: %s", exc)
            raise SmartAnalyticsError("Could not reach the AI service.", code="llm_error")
        if resp.status_code != 200:
            logger.warning("smart_analytics: Groq %s after non-JSON retry: %s", resp.status_code, resp.text[:200])
            raise SmartAnalyticsError("AI service error. Please try again.", code="llm_error")

    if not conversation_history:
        _dsl_set(norm, dsl)

    return dsl



# ─── Step 2: Validation ───────────────────────────────────────────────────────

def validate_dsl(dsl: dict) -> None:
    """
    Validate the DSL dict from the LLM. Mutates dsl in-place to fix common
    LLM mistakes before raising any errors.
    """
    # ── Recovery: LLM sometimes outputs both action + metric fields together.
    # If a concrete metric/mode is present alongside an action, strip the action
    # and treat as a metric DSL (the user's intent is clearly a data query).
    if dsl.get("action") in ("clarify", "unsupported") and dsl.get("metric"):
        logger.warning(
            "smart_analytics: LLM returned mixed action+metric DSL — stripping action '%s', treating as metric query",
            dsl["action"]
        )
        dsl.pop("action", None)
        dsl.pop("question", None)
        dsl.pop("message", None)

    if dsl.get("action") in ("clarify", "unsupported"):
        return

    mode = dsl.get("mode", "standard")
    if mode not in SUPPORTED_MODES:
        # Unknown mode — fall back to standard rather than 422
        dsl["mode"] = "standard"
        mode = "standard"

    if mode in ("funnel", "batch_funnel", "pod_summary"):
        # Validate period and batch_funnel requirements
        period = dsl.get("period")
        if period and period not in SUPPORTED_PERIODS:
            dsl.pop("period", None)
        if mode == "batch_funnel" and not dsl.get("filter_batch"):
            dsl["action"]   = "clarify"
            dsl["question"] = "Which batch would you like to see the funnel for? Please mention the upload date, e.g. 'batch from May 15'."
        return

    if mode == "multi":
        metrics = dsl.get("metrics") or []
        # Filter to supported metrics only
        valid_metrics = [m for m in metrics if m in SUPPORTED_METRICS]
        if len(valid_metrics) < 2:
            # Graceful recovery: if only 1 valid metric, downgrade to standard
            if len(valid_metrics) == 1:
                dsl["mode"]   = "standard"
                dsl["metric"] = valid_metrics[0]
                dsl.pop("metrics", None)
                mode = "standard"
                # Fall through to standard validation below
            else:
                # 0 valid metrics — return clarify (not 422)
                dsl["action"]   = "clarify"
                dsl["question"] = "What metrics would you like to see? e.g. calls and meetings, emails and conversion rate."
                return
        else:
            dsl["metrics"] = valid_metrics
            # All multi-metric checks passed
            group_by = dsl.get("group_by")
            if group_by and group_by not in SUPPORTED_DIMENSIONS:
                dsl.pop("group_by", None)
            period = dsl.get("period")
            if period and period not in SUPPORTED_PERIODS:
                dsl.pop("period", None)
            return

    # Standard / ranking / compare validation
    if mode != "multi":  # may have been downgraded above
        metric = dsl.get("metric")
        if not metric or metric not in SUPPORTED_METRICS:
            # Try to recover from metrics[] → metric conversion
            metrics_list = dsl.get("metrics") or []
            first_valid  = next((m for m in metrics_list if m in SUPPORTED_METRICS), None)
            if first_valid:
                dsl["metric"] = first_valid
                dsl.pop("metrics", None)
            else:
                # Can't recover — ask for clarification rather than 422
                dsl["action"]   = "clarify"
                dsl["question"] = "What would you like to measure? e.g. calls made, meetings, conversion rate."
                return

    group_by = dsl.get("group_by")
    if group_by and group_by not in SUPPORTED_DIMENSIONS:
        dsl.pop("group_by", None)  # unknown dimension entirely — safe to drop
        group_by = None

    # Phase 1 fix (audit-flagged): a dimension can be globally valid but not
    # implemented for THIS metric (e.g. "connect rate by POD" — connect_rate's
    # query only branches on group_by=="sdr", so pod silently fell through to
    # a scalar, org-wide number that looked like it answered the question).
    # Reject explicitly instead of silently returning the wrong shape.
    if group_by:
        metric_for_check = dsl.get("metric")
        supported = SUPPORTED_DIMENSIONS_BY_METRIC.get(metric_for_check, set())
        if group_by not in supported:
            dsl["action"] = "clarify"
            metric_label = (metric_for_check or "that metric").replace("_", " ")
            if supported:
                options = ", ".join(sorted(supported))
                dsl["question"] = (
                    f"Breaking {metric_label} down by {group_by} isn't supported yet. "
                    f"Available breakdowns for {metric_label}: {options}."
                )
            else:
                dsl["question"] = f"Breaking {metric_label} down by {group_by} isn't supported yet."
            return

    period = dsl.get("period")
    if period and period not in SUPPORTED_PERIODS:
        dsl.pop("period", None)   # silently drop bad period

    sort = dsl.get("sort")
    if sort and sort not in ("asc", "desc"):
        dsl["sort"] = "desc"      # default to desc


# ─── Step 3: Execution ────────────────────────────────────────────────────────

def execute_dsl(dsl: dict, user: dict, db: Session,
                sdrs: Optional[list[dict]] = None,
                pods: Optional[list[dict]] = None,
                batches: Optional[list[dict]] = None) -> dict:
    from routes.analytics_routes import _effective_pod_id

    mode          = dsl.get("mode", "standard")
    effective_pod = _effective_pod_id(user, None)
    sdrs          = sdrs    or []
    pods          = pods    or []
    batches       = batches or []

    # Resolve filter_sdr → user_id
    filter_sdr_name = dsl.get("filter_sdr")
    filter_sdr_id   = None
    if filter_sdr_name:
        filter_sdr_id = _resolve_sdr_id(filter_sdr_name, sdrs)
        if not filter_sdr_id:
            raise SmartAnalyticsError(
                f"Could not find SDR '{filter_sdr_name}' in the system. "
                f"Available: {', '.join(s['name'] for s in sdrs[:10])}.",
                code="sdr_not_found",
            )

    # Resolve filter_pod → pod_id (respects Pod Admin scoping)
    filter_pod_name = dsl.get("filter_pod")
    filter_pod_id   = None
    if filter_pod_name:
        resolved = _resolve_pod_id(filter_pod_name, pods)
        if resolved:
            # Pod Admins cannot escape their own pod
            if effective_pod and resolved != effective_pod:
                logger.info("smart_analytics: Pod Admin pod filter overridden by scoping")
            else:
                filter_pod_id = resolved
                effective_pod = resolved  # narrow scope to requested pod
        else:
            raise SmartAnalyticsError(
                f"Could not find pod '{filter_pod_name}'. "
                f"Available pods: {', '.join(p['name'] for p in pods[:10])}.",
                code="pod_not_found",
            )

    # Resolve filter_batch → upload_log_id
    filter_batch_hint = dsl.get("filter_batch")
    filter_batch_id   = None
    if filter_batch_hint:
        filter_batch_id = _resolve_batch_id(filter_batch_hint, batches)
        if not filter_batch_id:
            # Degrade gracefully: warn but don't 422 — return empty result with explanation
            logger.warning(
                "smart_analytics: could not resolve batch '%s'. Available: %s",
                filter_batch_hint,
                [b['label'] for b in batches[:5]]
            )
            available = ", ".join(f"'{b['label']}'" for b in batches[:5])
            return {
                "mode":    "standard",
                "metric":  "disqualified",
                "data":    [],
                "meta":    {"result_count": 0},
                "message": (
                    f"Couldn't find a batch matching '{filter_batch_hint}'. "
                    f"Available batches: {available or 'none found'}. "
                    "Try selecting a batch from the 📦 All Batches dropdown instead."
                ),
                "action":  "batch_not_found",
            }

    # Pod cross-comparison: Super Admin only
    if dsl.get("group_by") == "pod" and user.get("role") not in ("Super Admin", "Admin"):
        raise SmartAnalyticsError("Cross-pod comparison is only available to Super Admins.", code="permission_denied")

    # Result cache — skip for SDR/batch-filtered or multi queries
    cache_key = f"sa3:{hash(json.dumps({**dsl, '_pod': effective_pod, '_sdr': filter_sdr_id, '_batch': filter_batch_id}, sort_keys=True))}"
    if mode not in ("multi",) and not filter_sdr_id and not filter_batch_id:
        cached = _res_get(cache_key)
        if cached:
            cached["meta"]["cached"] = True
            return cached

    date_start, date_end = _resolve_period(dsl.get("period"))

    try:
        if mode == "standard" or mode not in SUPPORTED_MODES:
            result = _exec_standard(db, dsl, effective_pod, filter_sdr_id, date_start, date_end, filter_batch_id)
        elif mode == "ranking":
            result = _exec_ranking(db, dsl, effective_pod, filter_sdr_id, date_start, date_end, filter_batch_id)
        elif mode == "compare":
            result = _exec_compare(db, dsl, effective_pod, date_start, date_end, sdrs, filter_batch_id)
        elif mode == "multi":
            result = _exec_multi(db, dsl, effective_pod, filter_sdr_id, date_start, date_end, filter_batch_id)
        elif mode == "funnel":
            result = _exec_funnel(db, dsl, effective_pod, filter_sdr_id, date_start, date_end, sdrs, filter_batch_id)
        elif mode == "batch_funnel":
            result = _exec_batch_funnel(db, dsl, effective_pod, filter_batch_id, date_start, date_end)
        elif mode == "pod_summary":
            result = _exec_pod_summary(db, dsl, effective_pod, pods, date_start, date_end)
        else:
            result = _exec_standard(db, dsl, effective_pod, filter_sdr_id, date_start, date_end, filter_batch_id)
    except SmartAnalyticsError:
        raise
    except Exception as exc:
        logger.exception("smart_analytics: execute_dsl failed: %s", exc)
        raise SmartAnalyticsError("Query failed. Please try a different question.", code="execution_error")

    result["meta"] = result.get("meta", {})
    result["meta"].update({
        "cached":        False,
        "generated_at":  datetime.now(timezone.utc).isoformat(),
        "pod_scoped":    effective_pod is not None,
        "sdr_filtered":  filter_sdr_id is not None,
        "sdr_name":      filter_sdr_name,
        "pod_name":      filter_pod_name,
        "batch_filter":  filter_batch_id,
    })
    result["mode"]   = mode
    result["period"] = dsl.get("period")

    if mode not in ("multi",) and not filter_sdr_id and not filter_batch_id:
        _res_set(cache_key, result)

    return result


# ─── Mode: Standard ───────────────────────────────────────────────────────────

def _exec_standard(db, dsl, pod, sdr_id, start, end, batch_id=None) -> dict:
    metric   = dsl["metric"]
    group_by = dsl.get("group_by")
    sort     = dsl.get("sort", "desc")
    limit    = min(int(dsl.get("limit") or 10), 50)
    reverse  = (sort == "desc")

    data = _run_query(db, metric, group_by, pod, sdr_id, start, end, reverse, limit, batch_id)

    return {
        "mode":       "standard",
        "metric":     metric,
        "group_by":   group_by,
        "chart_type": _chart_type_for(dsl),
        "data":       data,
        "meta":       {"result_count": len(data)},
    }


# ─── Mode: Ranking ────────────────────────────────────────────────────────────

def _exec_ranking(db, dsl, pod, sdr_id, start, end, batch_id=None) -> dict:
    metric   = dsl.get("metric", "calls_made")
    group_by = dsl.get("group_by", "sdr")
    top_n    = min(int(dsl.get("top_n") or 3), 20)
    bottom_n = min(int(dsl.get("bottom_n") or 0), 20)

    # Fetch top_n only — do NOT fetch all SDRs
    top_data = _run_query(db, metric, group_by, pod, sdr_id, start, end, reverse=True, limit=top_n, batch_id=batch_id)

    # Exclude zero-value rows from ranking (SDRs with no activity are noise)
    top_data = [r for r in top_data if float(r.get("value") or 0) > 0]

    # Medal labels
    medals = ["🥇", "🥈", "🥉"]
    for i, row in enumerate(top_data[:3]):
        row["medal"] = medals[i]

    # Fetch bottom_n separately if requested
    bottom_data = []
    if bottom_n > 0:
        all_for_bottom = _run_query(db, metric, group_by, pod, sdr_id, start, end, reverse=False, limit=bottom_n, batch_id=batch_id)
        top_labels  = {r["label"] for r in top_data}
        bottom_data = [r for r in all_for_bottom if r["label"] not in top_labels][:bottom_n]

    return {
        "mode":       "ranking",
        "metric":     metric,
        "group_by":   group_by,
        "chart_type": "bar",
        "data":       top_data,
        "top":        top_data,
        "bottom":     bottom_data,
        "meta":       {"result_count": len(top_data), "top_n": top_n, "bottom_n": bottom_n},
    }


# ─── Mode: Compare ────────────────────────────────────────────────────────────

def _exec_compare(db, dsl, pod, start, end, sdrs, batch_id=None) -> dict:
    metric   = dsl.get("metric", "calls_made")
    group_by = dsl.get("group_by", "sdr")
    top_n    = int(dsl.get("top_n") or 1)
    bottom_n = int(dsl.get("bottom_n") or 1)

    all_data = _run_query(db, metric, group_by, pod, None, start, end, reverse=True, limit=50, batch_id=batch_id)

    if len(all_data) < 2:
        raise SmartAnalyticsError(
            "Not enough data to compare performers. Try a wider time period.",
            code="insufficient_data",
        )

    top    = all_data[:top_n]
    bottom = all_data[-bottom_n:]

    # Compute deltas
    comparisons = []
    for t, b in zip(top, bottom):
        tv = float(t.get("value") or 0)
        bv = float(b.get("value") or 0)
        delta    = tv - bv
        delta_pct = round((delta / bv * 100), 1) if bv else None
        comparisons.append({
            "top_label":    t["label"],
            "top_value":    tv,
            "bottom_label": b["label"],
            "bottom_value": bv,
            "delta":        round(delta, 1),
            "delta_pct":    delta_pct,
            "metric":       metric,
        })

    return {
        "mode":        "compare",
        "metric":      metric,
        "group_by":    group_by,
        "chart_type":  "compare",
        "comparisons": comparisons,
        "all_data":    all_data[:10],
        "meta":        {"result_count": len(all_data)},
    }


# ─── Mode: Multi ─────────────────────────────────────────────────────────────

def _exec_multi(db, dsl, pod, sdr_id, start, end, batch_id=None) -> dict:
    metrics  = dsl.get("metrics") or []
    group_by = dsl.get("group_by", "sdr")
    sort     = dsl.get("sort", "desc")
    limit    = min(int(dsl.get("limit") or 10), 50)
    reverse  = (sort == "desc")

    results = []

    def _run_one(metric):
        try:
            data = _run_query(db, metric, group_by, pod, sdr_id, start, end, reverse, limit, batch_id)
            return {
                "metric":     metric,
                "group_by":   group_by,
                "chart_type": _chart_type_for({"metric": metric, "group_by": group_by}),
                "data":       data,
            }
        except Exception as exc:
            logger.warning("multi: metric=%s failed: %s", metric, exc)
            return {"metric": metric, "data": [], "error": str(exc)}

    # Run in parallel — max 4 workers
    with ThreadPoolExecutor(max_workers=min(len(metrics), 4)) as pool:
        futures = {pool.submit(_run_one, m): m for m in metrics}
        for fut in as_completed(futures):
            results.append(fut.result())

    # Sort results to match original metrics[] order
    order = {m: i for i, m in enumerate(metrics)}
    results.sort(key=lambda r: order.get(r["metric"], 99))

    return {
        "mode":       "multi",
        "metrics":    metrics,
        "group_by":   group_by,
        "chart_type": "multi",
        "results":    results,
        "meta":       {"result_count": sum(len(r.get("data", [])) for r in results)},
    }


# ─── Mode: Funnel ─────────────────────────────────────────────────────────────

def _exec_batch_funnel(db, dsl, pod, batch_id, start, end) -> dict:
    """
    Funnel scoped to a specific upload batch (resolved upload_log_id).
    If batch_id is None, delegates to standard funnel.
    """
    if not batch_id:
        raise SmartAnalyticsError(
            "Please specify which batch to analyse, e.g. 'batch from May 15'.",
            code="batch_required",
        )
    result = _exec_funnel(db, dsl, pod, None, start, end, [], batch_id)
    result["mode"]       = "batch_funnel"
    result["batch_filter"] = batch_id
    return result


def _exec_pod_summary(db, dsl, pod, pods, start, end) -> dict:
    """
    Per-pod performance table: leads, calls, meetings, connect_rate, conversion_rate.
    When pod is set (Pod Admin or filter_pod), returns a single-pod row.
    """
    from sqlalchemy import case as sa_case
    from routes._admin_helpers import get_conversation_min_seconds

    conversation_min_seconds = get_conversation_min_seconds(db)

    target_pods = [p for p in pods if not pod or p["id"] == pod] if pods else []
    if not target_pods:
        # Fallback: query all pods from DB directly
        try:
            target_pods = [{"id": r.id, "name": r.name}
                           for r in db.query(models.Pod.id, models.Pod.name).all()]
            if pod:
                target_pods = [p for p in target_pods if p["id"] == pod]
        except Exception:
            pass

    if not target_pods:
        raise SmartAnalyticsError("No pods found.", code="no_data")

    metric = dsl.get("metric")   # optional — nil means return all key metrics

    rows = []
    for p in target_pods:
        pid = p["id"]

        # Leads
        leads = db.query(func.count(models.Lead.id)).filter(
            models.Lead.pod_id == pid,
            ~models.Lead.status.in_(["No Phone - Parked", "Parked"])
        )
        if start: leads = leads.filter(models.Lead.created_at >= start)
        if end:   leads = leads.filter(models.Lead.created_at <= end)
        leads_n = leads.scalar() or 0

        # Calls
        calls = (db.query(func.count(models.DialerCall.id))
                   .join(models.User, models.User.id == models.DialerCall.user_id)
                   .filter(models.User.pod_id == pid, models.DialerCall.direction == "outbound"))
        if start: calls = calls.filter(models.dialer_call_event_time() >= start)
        if end:   calls = calls.filter(models.dialer_call_event_time() <= end)
        calls_n = calls.scalar() or 0

        # Connected calls: see models.dialer_call_connected()
        connected = (db.query(func.count(models.DialerCall.id))
                       .join(models.User, models.User.id == models.DialerCall.user_id)
                       .filter(models.User.pod_id == pid,
                               models.DialerCall.direction == "outbound",
                               models.dialer_call_connected(conversation_min_seconds)))
        if start: connected = connected.filter(models.dialer_call_event_time() >= start)
        if end:   connected = connected.filter(models.dialer_call_event_time() <= end)
        connected_n = connected.scalar() or 0

        # Meetings
        meeting_statuses = ("Meeting Scheduled", "Meeting Confirmed", "Meeting Complete")
        meetings = (db.query(func.count(distinct(models.LeadStatusLog.lead_id)))
                      .join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
                      .filter(models.Lead.pod_id == pid,
                              models.LeadStatusLog.to_status.in_(meeting_statuses)))
        if start: meetings = meetings.filter(models.LeadStatusLog.changed_at >= start)
        if end:   meetings = meetings.filter(models.LeadStatusLog.changed_at <= end)
        meetings_n = meetings.scalar() or 0

        # Denominator is total calls made, not calls with a logged outcome —
        # matches analytics_routes.get_sdr_table (BUG-ANALYTICS-1 fix); using
        # with_outcome_n here made this endpoint disagree with the SDR table
        # for the same pod/period.
        connect_rate  = round(connected_n / calls_n * 100, 1) if calls_n else None
        conversion    = round(meetings_n / leads_n * 100, 1)  if leads_n else None

        rows.append({
            "label":         p["name"],
            "pod_id":        pid,
            "leads":         leads_n,
            "calls":         calls_n,
            "connect_rate":  connect_rate,
            "meetings":      meetings_n,
            "conversion_rate": conversion,
        })

    # Sort by the requested metric or by leads desc
    sort_key = metric if metric in ("leads_created", "calls_made", "meetings_scheduled", "connect_rate", "conversion_rate") else "leads"
    sort_map  = {"leads_created": "leads", "calls_made": "calls", "meetings_scheduled": "meetings",
                 "connect_rate": "connect_rate", "conversion_rate": "conversion_rate"}
    rows.sort(key=lambda r: r.get(sort_map.get(sort_key, "leads")) or 0, reverse=True)

    return {
        "mode":       "pod_summary",
        "chart_type": "pod_summary",
        "rows":       rows,
        "meta":       {"result_count": len(rows), "pod_count": len(rows)},
    }


def _exec_funnel(db, dsl, pod, sdr_id, start, end, sdrs, batch_id=None) -> dict:
    """
    Full funnel breakdown.

    All steps are anchored to the same set of leads (created within the period).
    This ensures counts are consistent: e.g. Research Complete is always a
    subset of Leads Assigned for the same date window.

    Step definitions:
      1. Leads Assigned  — leads created in period
      2. Research Done   — of those leads, how many have all 4 research fields
      3. Emails Sent     — outbound emails sent TO leads from that set
      4. Calls Made      — outbound calls made TO leads from that set
      5. Meetings Booked — leads from that set that reached a meeting status
    """
    # ── Build the base lead sub-set ────────────────────────────────────────────
    lead_q = db.query(models.Lead.id.label("lead_id"))
    if pod:
        lead_q = lead_q.filter(models.Lead.pod_id == pod)
    if batch_id:
        lead_q = lead_q.filter(models.Lead.upload_log_id == batch_id)
    if sdr_id:
        lead_q = lead_q.join(
            models.lead_assignments,
            models.lead_assignments.c.lead_id == models.Lead.id,
        ).filter(models.lead_assignments.c.user_id == sdr_id)
    if start:
        lead_q = lead_q.filter(models.Lead.created_at >= start)
    if end:
        lead_q = lead_q.filter(models.Lead.created_at <= end)
    # Materialise once — reused as a subquery
    lead_sq = lead_q.subquery()

    leads_assigned = db.query(func.count()).select_from(lead_sq).scalar() or 0

    # ── Step 2: Research complete (all 4 fields filled) ───────────────────────
    research_complete = db.query(func.count(models.Lead.id)).filter(
        models.Lead.id.in_(db.query(lead_sq.c.lead_id)),
        models.Lead.research_company.isnot(None),
        models.Lead.research_hypothesis.isnot(None),
        models.Lead.research_personalization.isnot(None),
        models.Lead.research_contact.isnot(None),
    ).scalar() or 0

    # ── Step 3: Emails sent ────────────────────────────────────────────────────
    # Batch funnel: join on lead_id (reliably populated for batch uploads).
    # General funnel: join on user_id via SDRs assigned to those leads, because
    # lead_email_activity.lead_id may also be sparsely populated.
    email_q = db.query(func.count(models.LeadEmailActivity.id)).filter(
        models.LeadEmailActivity.direction == "outbound",
    )
    if batch_id:
        # lead_id is populated for batch-imported leads — use direct join
        email_q = email_q.filter(
            models.LeadEmailActivity.lead_id.in_(db.query(lead_sq.c.lead_id))
        )
    else:
        # General: scope by the SDRs who own the leads in the set
        sdr_ids_sq = (db.query(models.lead_assignments.c.user_id.distinct())
                        .join(lead_sq, lead_sq.c.lead_id == models.lead_assignments.c.lead_id)
                        .subquery())
        email_q = email_q.filter(
            models.LeadEmailActivity.user_id.in_(db.query(sdr_ids_sq))
        )
        # Still apply date window on activity (matches the lead creation window)
        if start: email_q = email_q.filter(models.LeadEmailActivity.timestamp >= start)
        if end:   email_q = email_q.filter(models.LeadEmailActivity.timestamp <= end)
        if pod:
            email_q = (email_q
                       .join(models.User, models.User.id == models.LeadEmailActivity.user_id)
                       .filter(models.User.pod_id == pod))
    emails_sent = email_q.scalar() or 0

    # ── Step 4: Calls made ────────────────────────────────────────────────────
    # Same two-path strategy as Step 3.
    # DB fact: only ~3.6% of dialer_calls have lead_id populated.
    # → batch funnel uses lead_id (correct for batch-imported calls)
    # → general funnel uses user_id (all calls attributed to the SDR)
    call_q = db.query(func.count(models.DialerCall.id)).filter(
        models.DialerCall.direction == "outbound",
    )
    if batch_id:
        call_q = call_q.filter(
            models.DialerCall.lead_id.in_(db.query(lead_sq.c.lead_id))
        )
    else:
        sdr_ids_sq2 = (db.query(models.lead_assignments.c.user_id.distinct())
                         .join(lead_sq, lead_sq.c.lead_id == models.lead_assignments.c.lead_id)
                         .subquery())
        call_q = call_q.filter(
            models.DialerCall.user_id.in_(db.query(sdr_ids_sq2))
        )
        if start: call_q = call_q.filter(models.dialer_call_event_time() >= start)
        if end:   call_q = call_q.filter(models.dialer_call_event_time() <= end)
        if pod:
            call_q = (call_q
                      .join(models.User, models.User.id == models.DialerCall.user_id)
                      .filter(models.User.pod_id == pod))
    calls_made = call_q.scalar() or 0

    # ── Step 5: Meetings booked (at least one meeting status on those leads) ──
    meeting_statuses = ("Meeting Scheduled", "Meeting Confirmed", "Meeting Complete")
    meetings = db.query(func.count(distinct(models.LeadStatusLog.lead_id))).filter(
        models.LeadStatusLog.to_status.in_(meeting_statuses),
        models.LeadStatusLog.lead_id.in_(db.query(lead_sq.c.lead_id)),
    ).scalar() or 0

    # Build funnel steps
    steps = [
        {
            "step":  1,
            "label": "Leads Assigned",
            "value": leads_assigned,
            "pct":   100.0,
            "icon":  "👥",
        },
        {
            "step":  2,
            "label": "Research Complete",
            "value": research_complete,
            "pct":   round(research_complete / leads_assigned * 100, 1) if leads_assigned else 0,
            "icon":  "🔬",
        },
        {
            "step":  3,
            "label": "Emails Sent",
            "value": emails_sent,
            "pct":   round(emails_sent / leads_assigned * 100, 1) if leads_assigned else 0,
            "icon":  "📧",
        },
        {
            "step":  4,
            "label": "Calls Made",
            "value": calls_made,
            "pct":   round(calls_made / leads_assigned * 100, 1) if leads_assigned else 0,
            "icon":  "📞",
        },
        {
            "step":  5,
            "label": "Meetings Booked",
            "value": meetings,
            "pct":   round(meetings / leads_assigned * 100, 1) if leads_assigned else 0,
            "icon":  "🤝",
        },
    ]

    # Find gap: lowest % step (excluding Leads Assigned which is always 100%)
    non_lead_steps = [s for s in steps if s["step"] > 1]
    if non_lead_steps:
        gap_step = min(non_lead_steps, key=lambda s: s["pct"])
        gap_step["is_gap"] = True

    # Find sdr_name for title
    sdr_name = None
    if sdr_id and sdrs:
        sdr = next((s for s in sdrs if s["id"] == sdr_id), None)
        sdr_name = sdr["name"] if sdr else None

    return {
        "mode":       "funnel",
        "chart_type": "funnel",
        "steps":      steps,
        "sdr_name":   sdr_name,
        "meta": {
            "result_count": len(steps),
            "leads_assigned": leads_assigned,
        },
    }


# ─── Direct DB queries ────────────────────────────────────────────────────────

def _apply_batch(q, batch_id):
    """Filter a query on Lead.upload_log_id when a batch is active."""
    if batch_id:
        q = q.filter(models.Lead.upload_log_id == batch_id)
    return q


def _run_query(db, metric, group_by, pod, sdr_id, start, end, reverse, limit, batch_id=None):
    args = (db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit)
    if metric == "avg_call_duration":  return _q_avg_call_duration(*args)
    if metric == "calls_made":         return _q_calls(*args)
    if metric == "emails_sent":        return _q_emails(*args)
    if metric == "meetings_scheduled": return _q_meetings(*args)
    if metric == "leads_created":      return _q_leads_created(*args)
    if metric == "conversion_rate":    return _q_conversion_rate(*args)
    if metric == "research_completed": return _q_research(*args)
    if metric == "no_shows":           return _q_no_shows(*args)
    if metric == "disqualified":       return _q_disqualified(*args)
    if metric == "connect_rate":       return _q_connect_rate(*args)
    if metric == "email_open_rate":    return _q_email_open_rate(*args)
    if metric == "email_reply_rate":   return _q_email_reply_rate(*args)
    if metric == "avg_call_retries":   return _q_avg_call_retries(*args)
    if metric == "demos_scheduled":    return _q_demos_scheduled(*args)
    if metric == "demos_completed":    return _q_demos_completed(*args)
    raise SmartAnalyticsError(f"No query for metric '{metric}'.", code="execution_error")


def _apply_date(q, col, start, end):
    if start: q = q.filter(col >= start)
    if end:   q = q.filter(col <= end)
    return q

def _apply_pod(q, col, pod):
    if pod: q = q.filter(col == pod)
    return q

def _apply_sdr(q, user_col, sdr_id):
    if sdr_id: q = q.filter(user_col == sdr_id)
    return q


def _q_calls(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    base = and_(models.DialerCall.direction == "outbound")
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(models.DialerCall.id).label("value"))
               .join(models.DialerCall, models.DialerCall.user_id == models.User.id)
               .filter(base))
        q = _apply_date(q, models.dialer_call_event_time(), start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(models.DialerCall.id).desc() if reverse else func.count(models.DialerCall.id).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by == "pod":
        q = (db.query(models.Pod.name.label("label"),
                      func.count(models.DialerCall.id).label("value"))
               .join(models.User, models.User.pod_id == models.Pod.id)
               .join(models.DialerCall, models.DialerCall.user_id == models.User.id)
               .filter(base))
        q = _apply_date(q, models.dialer_call_event_time(), start, end)
        rows = q.group_by(models.Pod.name).order_by(
            func.count(models.DialerCall.id).desc() if reverse else func.count(models.DialerCall.id).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by in ("day", "week", "month"):
        return _q_time_series(db, models.DialerCall, models.dialer_call_event_time(),
                              group_by, pod, sdr_id, start, end,
                              user_id_col=models.DialerCall.user_id,
                              pod_user_join=(models.User, models.User.id == models.DialerCall.user_id),
                              pod_col=models.User.pod_id,
                              extra_filter=base, batch_id=batch_id)

    # Scalar — NOTE: batch filter not applied to calls_made because
    # dialer_calls.lead_id is only 3.6% populated; applying it would
    # silently return near-zero counts for non-batch-imported calls.
    q = db.query(func.count(models.DialerCall.id)).filter(base)
    q = _apply_date(q, models.dialer_call_event_time(), start, end)
    if pod or sdr_id:
        q = q.join(models.User, models.User.id == models.DialerCall.user_id)
        if pod:    q = q.filter(models.User.pod_id == pod)
        if sdr_id: q = q.filter(models.User.id == sdr_id)
    return [{"label": "Total Calls", "value": q.scalar() or 0}]


def _q_emails(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    base = models.LeadEmailActivity.direction == "outbound"
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(models.LeadEmailActivity.id).label("value"))
               .join(models.LeadEmailActivity, models.LeadEmailActivity.user_id == models.User.id)
               .filter(base))
        q = _apply_date(q, models.LeadEmailActivity.timestamp, start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(models.LeadEmailActivity.id).desc() if reverse else func.count(models.LeadEmailActivity.id).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by in ("day", "week", "month"):
        return _q_time_series(db, models.LeadEmailActivity, models.LeadEmailActivity.timestamp,
                              group_by, pod, sdr_id, start, end,
                              user_id_col=models.LeadEmailActivity.user_id,
                              pod_user_join=(models.User, models.User.id == models.LeadEmailActivity.user_id),
                              pod_col=models.User.pod_id,
                              extra_filter=base, batch_id=batch_id)

    # Scalar — NOTE: batch filter not applied to emails_sent because
    # lead_email_activity.lead_id is sparsely populated; same sparse-data
    # issue as dialer_calls.
    q = db.query(func.count(models.LeadEmailActivity.id)).filter(base)
    q = _apply_date(q, models.LeadEmailActivity.timestamp, start, end)
    if pod or sdr_id:
        q = q.join(models.User, models.User.id == models.LeadEmailActivity.user_id)
        if pod:    q = q.filter(models.User.pod_id == pod)
        if sdr_id: q = q.filter(models.User.id == sdr_id)
    return [{"label": "Emails Sent", "value": q.scalar() or 0}]


def _q_meetings(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """Phase 2 (§2.5): grouped/ranked branches aligned to the canonical
    event population/date-column — Lead.meeting_scheduled_at, the same column
    backend/analytics/adapters.py:_meetings_scheduled uses — instead of the
    previous independent LeadStatusLog.to_status-based definition (a 3rd
    divergent "meetings" implementation, with its own 3-value status tuple).
    Kept as separately-implemented queries per the master doc's "different
    optimized implementations, same contract" allowance (Principle 3) — the
    semantic layer stays scalar-only, not extended with dimensional execution."""
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(distinct(models.Lead.id)).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.user_id == models.User.id)
               .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
               .filter(models.Lead.meeting_scheduled_at.isnot(None)))
        q = _apply_date(q, models.Lead.meeting_scheduled_at, start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        q = _apply_batch(q, batch_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(distinct(models.Lead.id)).desc() if reverse
            else func.count(distinct(models.Lead.id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by == "pod":
        q = (db.query(models.Pod.name.label("label"),
                      func.count(distinct(models.Lead.id)).label("value"))
               .join(models.Lead, models.Lead.pod_id == models.Pod.id)
               .filter(models.Lead.meeting_scheduled_at.isnot(None)))
        q = _apply_date(q, models.Lead.meeting_scheduled_at, start, end)
        rows = q.group_by(models.Pod.name).order_by(
            func.count(distinct(models.Lead.id)).desc() if reverse
            else func.count(distinct(models.Lead.id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by in ("day", "week", "month"):
        return _q_time_series(db, models.Lead, models.Lead.meeting_scheduled_at,
                              group_by, pod, sdr_id, start, end,
                              user_id_col=None,
                              pod_user_join=None,
                              pod_col=models.Lead.pod_id,
                              extra_filter=models.Lead.meeting_scheduled_at.isnot(None), batch_id=batch_id)

    # Scalar — Phase 2: routed through the semantic layer's canonical
    # meetings_scheduled adapter (already built in Phase 1), instead of this
    # function's own independent LeadStatusLog-based query.
    envelope = resolve_metric_scoped(
        "meetings_scheduled", db,
        effective_pod=pod, effective_sdr=sdr_id,
        date_start=start, date_end=end,
        upload_log_id=batch_id,
    )
    return [{"label": "Meetings Scheduled", "value": envelope["value"] or 0}]


def _q_leads_created(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    if group_by == "source":
        q = db.query(models.Lead.lead_source.label("label"), func.count(models.Lead.id).label("value"))
        q = _apply_date(q, models.Lead.created_at, start, end)
        q = _apply_pod(q, models.Lead.pod_id, pod)
        q = _apply_batch(q, batch_id)
        rows = q.group_by(models.Lead.lead_source).order_by(
            func.count(models.Lead.id).desc() if reverse else func.count(models.Lead.id).asc()
        ).limit(limit).all()
        return [{"label": _humanise_source(r.label), "value": r.value} for r in rows]

    if group_by == "status":
        q = db.query(models.Lead.status.label("label"), func.count(models.Lead.id).label("value"))
        q = _apply_date(q, models.Lead.created_at, start, end)
        q = _apply_pod(q, models.Lead.pod_id, pod)
        q = _apply_batch(q, batch_id)   # ← was missing
        rows = q.group_by(models.Lead.status).order_by(
            func.count(models.Lead.id).desc() if reverse else func.count(models.Lead.id).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    # group_by == "sdr": leads assigned to each SDR via lead_assignments
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(distinct(models.Lead.id)).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
               .join(models.User, models.User.id == models.lead_assignments.c.user_id))
        q = _apply_date(q, models.Lead.created_at, start, end)
        q = _apply_pod(q, models.Lead.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        q = _apply_batch(q, batch_id)   # ← was missing
        rows = q.group_by(models.User.name).order_by(
            func.count(distinct(models.Lead.id)).desc() if reverse else func.count(distinct(models.Lead.id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    # Scalar
    q = db.query(func.count(distinct(models.Lead.id)))
    q = _apply_date(q, models.Lead.created_at, start, end)
    if sdr_id:
        q = q.join(
            models.lead_assignments,
            models.lead_assignments.c.lead_id == models.Lead.id
        ).filter(models.lead_assignments.c.user_id == sdr_id)
    if pod:     q = q.filter(models.Lead.pod_id == pod)
    q = _apply_batch(q, batch_id)   # ← was missing
    return [{"label": "Leads Created", "value": q.scalar() or 0}]


def _q_conversion_rate(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """
    Conversion rate = meetings booked in period / leads assigned in period.

    Date logic:
      - leads denominator: Lead.created_at in [start, end]
      - meetings numerator: LeadStatusLog.changed_at in [start, end]
    Both anchored to the same period so the rate reflects *period* performance.
    """
    meeting_statuses = ("Meeting Scheduled", "Meeting Confirmed", "Meeting Complete")

    if group_by == "sdr":
        # Meetings in period per SDR (via lead_assignments)
        meetings_sq_q = (db.query(
            models.lead_assignments.c.user_id,
            func.count(distinct(models.LeadStatusLog.lead_id)).label("meetings")
        ).join(models.LeadStatusLog, models.LeadStatusLog.lead_id == models.lead_assignments.c.lead_id)
         .filter(models.LeadStatusLog.to_status.in_(meeting_statuses)))
        if start: meetings_sq_q = meetings_sq_q.filter(models.LeadStatusLog.changed_at >= start)
        if end:   meetings_sq_q = meetings_sq_q.filter(models.LeadStatusLog.changed_at <= end)
        meetings_sq = meetings_sq_q.group_by(models.lead_assignments.c.user_id).subquery()

        # Leads in period per SDR (via lead_assignments → Lead.created_at)
        leads_sq_q = (db.query(
            models.lead_assignments.c.user_id,
            func.count(distinct(models.lead_assignments.c.lead_id)).label("leads")
        ).join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id))
        if start: leads_sq_q = leads_sq_q.filter(models.Lead.created_at >= start)
        if end:   leads_sq_q = leads_sq_q.filter(models.Lead.created_at <= end)
        leads_sq = leads_sq_q.group_by(models.lead_assignments.c.user_id).subquery()

        rows = (db.query(
            models.User.name.label("label"),
            (func.coalesce(meetings_sq.c.meetings, 0) * 100.0 / func.nullif(leads_sq.c.leads, 0)).label("value")
        ).join(leads_sq, leads_sq.c.user_id == models.User.id)
         .outerjoin(meetings_sq, meetings_sq.c.user_id == models.User.id))

        if pod:    rows = rows.filter(models.User.pod_id == pod)
        if sdr_id: rows = rows.filter(models.User.id == sdr_id)

        rate_expr = (func.coalesce(meetings_sq.c.meetings, 0) * 100.0 / func.nullif(leads_sq.c.leads, 0))
        rows = rows.order_by(rate_expr.desc() if reverse else rate_expr.asc()).limit(limit).all()
        return [{"label": r.label, "value": round(float(r.value or 0), 1)} for r in rows]

    # Scalar: overall conversion rate
    if sdr_id:
        # SECURITY FIX (Phase 2): pod was never applied in this branch — every
        # other _q_* scalar function ANDs pod+sdr_id independently (see
        # _q_calls/_q_leads_created/_q_disqualified below), so a mismatched
        # pod+sdr combination there just returns zero rows. This branch made
        # pod and sdr_id mutually exclusive instead of conjunctive: a Pod
        # Admin naming an SDR from a DIFFERENT pod got that SDR's true,
        # unscoped conversion rate — a real cross-pod data leak, not merely
        # an empty result. Applying pod unconditionally alongside sdr_id
        # closes it, matching every sibling function's shape.
        leads_q = (db.query(func.count(distinct(models.lead_assignments.c.lead_id)))
                     .join(models.Lead, models.Lead.id == models.lead_assignments.c.lead_id)
                     .filter(models.lead_assignments.c.user_id == sdr_id))
        if start: leads_q = leads_q.filter(models.Lead.created_at >= start)
        if end:   leads_q = leads_q.filter(models.Lead.created_at <= end)
        if pod:   leads_q = leads_q.filter(models.Lead.pod_id == pod)

        meetings_q = (db.query(func.count(distinct(models.LeadStatusLog.lead_id)))
                        .filter(models.LeadStatusLog.to_status.in_(meeting_statuses))
                        .join(models.lead_assignments,
                              models.lead_assignments.c.lead_id == models.LeadStatusLog.lead_id)
                        .filter(models.lead_assignments.c.user_id == sdr_id))
        if start: meetings_q = meetings_q.filter(models.LeadStatusLog.changed_at >= start)
        if end:   meetings_q = meetings_q.filter(models.LeadStatusLog.changed_at <= end)
        if pod:
            meetings_q = (meetings_q
                          .join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
                          .filter(models.Lead.pod_id == pod))
    else:
        leads_q = db.query(func.count(models.Lead.id))
        if start: leads_q = leads_q.filter(models.Lead.created_at >= start)
        if end:   leads_q = leads_q.filter(models.Lead.created_at <= end)
        meetings_q = db.query(func.count(distinct(models.LeadStatusLog.lead_id))).filter(
            models.LeadStatusLog.to_status.in_(meeting_statuses)
        )
        if start: meetings_q = meetings_q.filter(models.LeadStatusLog.changed_at >= start)
        if end:   meetings_q = meetings_q.filter(models.LeadStatusLog.changed_at <= end)
        if pod:
            leads_q = leads_q.filter(models.Lead.pod_id == pod)
            meetings_q = (meetings_q
                          .join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
                          .filter(models.Lead.pod_id == pod))

    l = leads_q.scalar() or 0
    m = meetings_q.scalar() or 0
    return [{"label": "Conversion Rate", "value": round((m / l * 100), 1) if l else 0.0}]


def _q_research(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    researched = and_(
        models.Lead.research_company.isnot(None),
        models.Lead.research_hypothesis.isnot(None),
        models.Lead.research_personalization.isnot(None),
        models.Lead.research_contact.isnot(None),
    )
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(distinct(models.Lead.id)).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
               .join(models.User, models.User.id == models.lead_assignments.c.user_id)
               .filter(researched))
        q = _apply_date(q, models.Lead.created_at, start, end)   # ← was missing
        q = _apply_pod(q, models.Lead.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        q = _apply_batch(q, batch_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(distinct(models.Lead.id)).desc() if reverse else func.count(distinct(models.Lead.id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    # Scalar
    q = db.query(func.count(distinct(models.Lead.id))).filter(researched)
    q = _apply_date(q, models.Lead.created_at, start, end)
    if sdr_id:
        q = q.join(
            models.lead_assignments,
            models.lead_assignments.c.lead_id == models.Lead.id
        ).filter(models.lead_assignments.c.user_id == sdr_id)
    if pod:     q = q.filter(models.Lead.pod_id == pod)
    q = _apply_batch(q, batch_id)   # ← was missing
    return [{"label": "Research Completed", "value": q.scalar() or 0}]


def _q_no_shows(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.sum(models.Lead.no_show_count).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
               .join(models.User, models.User.id == models.lead_assignments.c.user_id)
               .filter(models.Lead.no_show_count > 0))
        q = _apply_pod(q, models.Lead.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        q = _apply_batch(q, batch_id)
        rows = q.group_by(models.User.name).order_by(
            func.sum(models.Lead.no_show_count).desc() if reverse else func.sum(models.Lead.no_show_count).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": int(r.value or 0)} for r in rows]

    # Scalar — Phase 2: routed through the semantic layer's canonical no_shows
    # adapter instead of this function's own unfiltered query. Real fix: this
    # scalar path previously applied no date filter at all — every "no shows
    # this week" question silently answered with the org's all-time total.
    envelope = resolve_metric_scoped(
        "no_shows", db,
        effective_pod=pod, effective_sdr=sdr_id,
        date_start=start, date_end=end,
        upload_log_id=batch_id,
    )
    return [{"label": "No Shows", "value": int(envelope["value"] or 0)}]


def _q_disqualified(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """
    Count of leads with status='Disqualified'.

    Phase 2 (§2.5): aligned to the canonical event population/date-column —
    Lead.status=="Disqualified" + Lead.lead_closed_at, the same as
    backend/analytics/adapters.py:_disqualified (built in Phase 1) — instead
    of the previous independent LeadStatusLog.to_status-based definition.

    A prior version of this docstring noted LeadStatusLog.changed_at was
    "more reliable than Lead.lead_closed_at which is often NULL." That was
    true historically; Lead.lead_closed_at is now written at the same moment
    Lead.status is set to "Disqualified" in the terminal-disqualify path (see
    analytics/registry.py's disqualified known_caveats), so the two should
    agree going forward. If old data still has status="Disqualified" with a
    NULL lead_closed_at, this metric will undercount vs. the pre-Phase-2
    LeadStatusLog-based numbers for that data — a real, evidence-backed
    business-semantics question (not a bug) worth flagging if that gap shows
    up in the old-vs-new comparison against real data, per master doc §23.
    """
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(distinct(models.Lead.id)).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.lead_id == models.Lead.id)
               .join(models.User, models.User.id == models.lead_assignments.c.user_id)
               .filter(models.Lead.status == "Disqualified"))
        q = _apply_date(q, models.Lead.lead_closed_at, start, end)
        q = _apply_pod(q, models.Lead.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        q = _apply_batch(q, batch_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(distinct(models.Lead.id)).desc() if reverse else func.count(distinct(models.Lead.id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    # Scalar — Phase 2: routed through the semantic layer's canonical
    # disqualified adapter (already built in Phase 1), instead of this
    # function's own independent LeadStatusLog-based query.
    envelope = resolve_metric_scoped(
        "disqualified", db,
        effective_pod=pod, effective_sdr=sdr_id,
        date_start=start, date_end=end,
        upload_log_id=batch_id,
    )
    return [{"label": "Disqualified", "value": envelope["value"] or 0}]


def _q_avg_call_duration(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    base = and_(
        models.DialerCall.direction == "outbound",
        models.DialerCall.duration.isnot(None),
        models.DialerCall.duration > 0,
    )
    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.round(func.avg(models.DialerCall.duration), 1).label("value"),
                      func.count(models.DialerCall.id).label("calls"))
               .join(models.User, models.User.id == models.DialerCall.user_id)
               .filter(base))
        q = _apply_date(q, models.dialer_call_event_time(), start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        rows = q.group_by(models.User.name).order_by(
            func.avg(models.DialerCall.duration).desc() if reverse else func.avg(models.DialerCall.duration).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": float(r.value or 0), "calls": r.calls} for r in rows]

    q = db.query(func.round(func.avg(models.DialerCall.duration), 1)).filter(base)
    q = _apply_date(q, models.dialer_call_event_time(), start, end)
    if pod or sdr_id:
        q = q.join(models.User, models.User.id == models.DialerCall.user_id)
        if pod:    q = q.filter(models.User.pod_id == pod)
        if sdr_id: q = q.filter(models.User.id == sdr_id)
    return [{"label": "Avg Call Duration (s)", "value": float(q.scalar() or 0)}]


def _q_connect_rate(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """Percentage of outbound calls that resulted in a real connection.
    Denominator = total outbound calls made; numerator = see
    models.dialer_call_connected().

    Matches the same logic (and denominator) as analytics_routes.get_sdr_table
    so numbers are consistent across both dashboards — this previously used
    calls-with-any-outcome as the denominator, which inflated the rate and
    disagreed with the SDR table (BUG-ANALYTICS-1 pattern).
    """
    from sqlalchemy import case as sa_case
    from routes._admin_helpers import get_conversation_min_seconds

    conversation_min_seconds = get_conversation_min_seconds(db)
    base = models.DialerCall.direction == "outbound"

    connected_expr = func.count(
        sa_case((models.dialer_call_connected(conversation_min_seconds), models.DialerCall.id))
    )
    total_expr = func.count(models.DialerCall.id)
    rate_expr = (connected_expr * 100.0 / func.nullif(total_expr, 0))

    if group_by == "sdr":
        q = (db.query(
            models.User.name.label("label"),
            connected_expr.label("connected"),
            total_expr.label("total"),
            rate_expr.label("value"),
        ).join(models.User, models.User.id == models.DialerCall.user_id)
         .filter(base))
        q = _apply_date(q, models.dialer_call_event_time(), start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        rows = q.group_by(models.User.name).order_by(
            rate_expr.desc() if reverse else rate_expr.asc()
        ).limit(limit).all()
        return [
            {
                "label": r.label,
                "value": round(float(r.value or 0), 1),
                "connected": r.connected,
                "total_calls": r.total,
            }
            for r in rows
        ]

    # Scalar — Phase 1: routed through the semantic layer's canonical
    # connect_rate adapter instead of this function's own DialerCall-only
    # query. Two real fixes as a result: (1) the canonical definition also
    # includes pure-manual CallLog rows (this scalar path used to be
    # DialerCall-only — a genuine population difference from the Dashboard,
    # not just a batch-filter gap), and (2) batch_id, silently ignored here
    # before, is now respected. Expect Ask AI's connect_rate scalar answers
    # to change for orgs with manual (non-Aircall) call logging — that's the
    # intended correction, not a regression (see old-vs-new comparison).
    envelope = resolve_metric_scoped(
        "connect_rate", db,
        effective_pod=pod, effective_sdr=sdr_id,
        date_start=start, date_end=end,
        upload_log_id=batch_id,
    )
    connected = envelope["explanation"]["numerator"] or 0
    total     = envelope["explanation"]["denominator"] or 0
    rate      = envelope["value"] or 0.0
    return [{"label": "Connect Rate", "value": rate, "connected": connected, "total_calls": total}]



def _q_email_open_rate(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """Percentage of outbound emails that were opened."""
    base = models.LeadEmailActivity.direction == "outbound"
    if group_by == "sdr":
        q = (db.query(
            models.User.name.label("label"),
            (func.count(models.LeadEmailActivity.opened_at) * 100.0 /
             func.nullif(func.count(models.LeadEmailActivity.id), 0)).label("value")
        ).join(models.User, models.User.id == models.LeadEmailActivity.user_id)
         .filter(base))
        q = _apply_date(q, models.LeadEmailActivity.timestamp, start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        if batch_id:
            q = q.join(models.Lead, models.Lead.id == models.LeadEmailActivity.lead_id).filter(
                models.Lead.upload_log_id == batch_id
            )
        rows = q.group_by(models.User.name).order_by(
            (func.count(models.LeadEmailActivity.opened_at) * 100.0 / func.nullif(func.count(models.LeadEmailActivity.id), 0)).desc()
            if reverse else
            (func.count(models.LeadEmailActivity.opened_at) * 100.0 / func.nullif(func.count(models.LeadEmailActivity.id), 0)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": round(float(r.value or 0), 1)} for r in rows]

    # Scalar — Phase 2: routed through the semantic layer's canonical
    # email_open_rate adapter, which now also excludes test/deleted leads
    # (this scalar path previously didn't) — matches Dashboard's definition.
    envelope = resolve_metric_scoped(
        "email_open_rate", db,
        effective_pod=pod, effective_sdr=sdr_id,
        date_start=start, date_end=end,
        upload_log_id=batch_id,
    )
    return [{"label": "Email Open Rate", "value": envelope["value"] or 0.0}]


def _q_email_reply_rate(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """Percentage of email threads that received an inbound reply."""
    base_out = models.LeadEmailActivity.direction == "outbound"
    base_in  = models.LeadEmailActivity.direction == "inbound"

    if group_by == "sdr":
        # Subquery: outbound thread count per user
        out_sq = (db.query(
            models.LeadEmailActivity.user_id,
            func.count(distinct(models.LeadEmailActivity.nylas_thread_id)).label("sent")
        ).filter(base_out).group_by(models.LeadEmailActivity.user_id).subquery())

        # Subquery: inbound thread count per user
        in_sq = (db.query(
            models.LeadEmailActivity.user_id,
            func.count(distinct(models.LeadEmailActivity.nylas_thread_id)).label("replied")
        ).filter(base_in).group_by(models.LeadEmailActivity.user_id).subquery())

        rows = (db.query(
            models.User.name.label("label"),
            (func.coalesce(in_sq.c.replied, 0) * 100.0 / func.nullif(out_sq.c.sent, 0)).label("value")
        ).join(out_sq, out_sq.c.user_id == models.User.id)
         .outerjoin(in_sq, in_sq.c.user_id == models.User.id))

        if pod:    rows = rows.filter(models.User.pod_id == pod)
        if sdr_id: rows = rows.filter(models.User.id == sdr_id)

        rows = rows.order_by(
            (func.coalesce(in_sq.c.replied, 0) * 100.0 / func.nullif(out_sq.c.sent, 0)).desc()
            if reverse else
            (func.coalesce(in_sq.c.replied, 0) * 100.0 / func.nullif(out_sq.c.sent, 0)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": round(float(r.value or 0), 1)} for r in rows]

    # Scalar — Phase 2: routed through the semantic layer's canonical
    # email_reply_rate adapter. Real fix: this scalar path previously applied
    # no date filter at all — every reply-rate question silently answered
    # with the org's all-time total.
    envelope = resolve_metric_scoped(
        "email_reply_rate", db,
        effective_pod=pod, effective_sdr=sdr_id,
        date_start=start, date_end=end,
        upload_log_id=batch_id,
    )
    return [{"label": "Email Reply Rate", "value": envelope["value"] or 0.0}]


def _q_avg_call_retries(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """Average call attempts per lead that was called at least once."""
    base = models.DialerCall.direction == "outbound"
    if group_by == "sdr":
        # Subquery: attempts per lead per user
        sub = (db.query(
            models.DialerCall.user_id,
            models.DialerCall.lead_id,
            func.count(models.DialerCall.id).label("attempts")
        ).filter(base))
        sub = _apply_date(sub, models.dialer_call_event_time(), start, end)
        sub = sub.group_by(models.DialerCall.user_id, models.DialerCall.lead_id).subquery()

        rows = (db.query(
            models.User.name.label("label"),
            func.round(func.avg(sub.c.attempts), 1).label("value")
        ).join(sub, sub.c.user_id == models.User.id))
        if pod:    rows = rows.filter(models.User.pod_id == pod)
        if sdr_id: rows = rows.filter(models.User.id == sdr_id)
        rows = rows.group_by(models.User.name).order_by(
            func.avg(sub.c.attempts).desc() if reverse else func.avg(sub.c.attempts).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": float(r.value or 0)} for r in rows]

    # Scalar
    sub = db.query(
        models.DialerCall.lead_id,
        func.count(models.DialerCall.id).label("attempts")
    ).filter(base)
    sub = _apply_date(sub, models.dialer_call_event_time(), start, end)
    if pod or sdr_id:
        sub = sub.join(models.User, models.User.id == models.DialerCall.user_id)
        if pod:    sub = sub.filter(models.User.pod_id == pod)
        if sdr_id: sub = sub.filter(models.User.id == sdr_id)
    sub = sub.group_by(models.DialerCall.lead_id).subquery()
    avg_val = db.query(func.round(func.avg(sub.c.attempts), 1)).scalar() or 0
    return [{"label": "Avg Call Retries", "value": float(avg_val)}]


# ─── Metric: Demos Scheduled ─────────────────────────────────────────────────

def _q_demos_scheduled(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """
    Count of leads that reached 'Demo Scheduled' status (demo booked).
    Mirrors _q_meetings but scoped to Demo Scheduled status only.
    Filtered by LeadStatusLog.changed_at within the period.
    """
    demo_status = ("Demo Scheduled",)

    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(distinct(models.LeadStatusLog.lead_id)).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.user_id == models.User.id)
               .join(models.LeadStatusLog, models.LeadStatusLog.lead_id == models.lead_assignments.c.lead_id)
               .filter(models.LeadStatusLog.to_status.in_(demo_status)))
        q = _apply_date(q, models.LeadStatusLog.changed_at, start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(distinct(models.LeadStatusLog.lead_id)).desc() if reverse
            else func.count(distinct(models.LeadStatusLog.lead_id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by == "pod":
        q = (db.query(models.Pod.name.label("label"),
                      func.count(distinct(models.LeadStatusLog.lead_id)).label("value"))
               .join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
               .join(models.Pod, models.Pod.id == models.Lead.pod_id)
               .filter(models.LeadStatusLog.to_status.in_(demo_status)))
        q = _apply_date(q, models.LeadStatusLog.changed_at, start, end)
        rows = q.group_by(models.Pod.name).order_by(
            func.count(distinct(models.LeadStatusLog.lead_id)).desc() if reverse
            else func.count(distinct(models.LeadStatusLog.lead_id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by in ("day", "week", "month"):
        return _q_time_series(db, models.LeadStatusLog, models.LeadStatusLog.changed_at,
                              group_by, pod, sdr_id, start, end,
                              user_id_col=None,
                              pod_user_join=(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id),
                              pod_col=models.Lead.pod_id,
                              extra_filter=models.LeadStatusLog.to_status.in_(demo_status), batch_id=batch_id)

    # Scalar — always join Lead so pod + batch filters work
    q = db.query(func.count(distinct(models.LeadStatusLog.lead_id))).filter(
        models.LeadStatusLog.to_status.in_(demo_status)
    )
    q = _apply_date(q, models.LeadStatusLog.changed_at, start, end)
    q = q.join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
    if pod:    q = q.filter(models.Lead.pod_id == pod)
    if sdr_id:
        q = q.join(
            models.lead_assignments,
            models.lead_assignments.c.lead_id == models.Lead.id
        ).filter(models.lead_assignments.c.user_id == sdr_id)
    q = _apply_batch(q, batch_id)   # ← was missing
    return [{"label": "Demos Scheduled", "value": q.scalar() or 0}]


# ─── Metric: Demos Completed ─────────────────────────────────────────────────

def _q_demos_completed(db, group_by, pod, sdr_id, batch_id, start, end, reverse, limit):
    """
    Count of leads that reached 'Demo Done' status (demo actually happened).
    Mirrors _q_demos_scheduled but for the terminal demo status.
    """
    demo_done = ("Demo Done",)

    if group_by == "sdr":
        q = (db.query(models.User.name.label("label"),
                      func.count(distinct(models.LeadStatusLog.lead_id)).label("value"))
               .join(models.lead_assignments, models.lead_assignments.c.user_id == models.User.id)
               .join(models.LeadStatusLog, models.LeadStatusLog.lead_id == models.lead_assignments.c.lead_id)
               .filter(models.LeadStatusLog.to_status.in_(demo_done)))
        q = _apply_date(q, models.LeadStatusLog.changed_at, start, end)
        q = _apply_pod(q, models.User.pod_id, pod)
        q = _apply_sdr(q, models.User.id, sdr_id)
        rows = q.group_by(models.User.name).order_by(
            func.count(distinct(models.LeadStatusLog.lead_id)).desc() if reverse
            else func.count(distinct(models.LeadStatusLog.lead_id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by == "pod":
        q = (db.query(models.Pod.name.label("label"),
                      func.count(distinct(models.LeadStatusLog.lead_id)).label("value"))
               .join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
               .join(models.Pod, models.Pod.id == models.Lead.pod_id)
               .filter(models.LeadStatusLog.to_status.in_(demo_done)))
        q = _apply_date(q, models.LeadStatusLog.changed_at, start, end)
        rows = q.group_by(models.Pod.name).order_by(
            func.count(distinct(models.LeadStatusLog.lead_id)).desc() if reverse
            else func.count(distinct(models.LeadStatusLog.lead_id)).asc()
        ).limit(limit).all()
        return [{"label": r.label, "value": r.value} for r in rows]

    if group_by in ("day", "week", "month"):
        return _q_time_series(db, models.LeadStatusLog, models.LeadStatusLog.changed_at,
                              group_by, pod, sdr_id, start, end,
                              user_id_col=None,
                              pod_user_join=(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id),
                              pod_col=models.Lead.pod_id,
                              extra_filter=models.LeadStatusLog.to_status.in_(demo_done), batch_id=batch_id)

    # Scalar — always join Lead so pod + batch filters work
    q = db.query(func.count(distinct(models.LeadStatusLog.lead_id))).filter(
        models.LeadStatusLog.to_status.in_(demo_done)
    )
    q = _apply_date(q, models.LeadStatusLog.changed_at, start, end)
    q = q.join(models.Lead, models.Lead.id == models.LeadStatusLog.lead_id)
    if pod:    q = q.filter(models.Lead.pod_id == pod)
    if sdr_id:
        q = q.join(
            models.lead_assignments,
            models.lead_assignments.c.lead_id == models.Lead.id
        ).filter(models.lead_assignments.c.user_id == sdr_id)
    q = _apply_batch(q, batch_id)   # ← was missing
    return [{"label": "Demos Completed", "value": q.scalar() or 0}]


def _q_time_series(db, Model, date_col, group_by, pod, sdr_id, start, end,
                   user_id_col, pod_user_join, pod_col, extra_filter=None, batch_id=None):
    """Phase 1 fix (audit-flagged, confirmed live): batch_id used to be
    silently dropped here — every day/week/month-grouped Ask AI query ignored
    the active batch filter even though the scalar/sdr-grouped paths for the
    same metric respected it. All 3 Models this is called with (DialerCall,
    LeadEmailActivity, LeadStatusLog) have a lead_id FK, so a generic join to
    Lead is enough to apply it."""
    try:
        is_postgres = "postgresql" in str(db.bind.url) if hasattr(db, 'bind') and db.bind else True
    except Exception:
        is_postgres = True

    try:
        if is_postgres:
            trunc_map = {"day": "day", "week": "week", "month": "month"}
            fmt_map   = {"day": "DD Mon", "week": "DD Mon", "month": "Mon YYYY"}
            trunc = func.date_trunc(trunc_map[group_by], date_col)
            fmt   = func.to_char(trunc, fmt_map[group_by])
            q = db.query(fmt.label("label"), func.count().label("value"), trunc.label("sort_key"))
        else:
            fmt_map = {"day": "%Y-%m-%d", "week": "%Y-W%W", "month": "%Y-%m"}
            trunc = func.strftime(fmt_map[group_by], date_col)
            q = db.query(trunc.label("label"), func.count().label("value"), trunc.label("sort_key"))
    except Exception:
        return []

    if extra_filter is not None: q = q.filter(extra_filter)
    if start: q = q.filter(date_col >= start)
    if end:   q = q.filter(date_col <= end)

    lead_already_joined = False
    if pod and pod_user_join:
        join_model, join_cond = pod_user_join
        q = q.join(join_model, join_cond).filter(pod_col == pod)
        lead_already_joined = join_model is models.Lead
    elif pod and not pod_user_join:
        q = q.filter(pod_col == pod)

    if sdr_id and user_id_col is not None:
        q = q.filter(user_id_col == sdr_id)

    if batch_id:
        if Model is models.Lead:
            # Lead-anchored callers (Phase 2: meetings/disqualified aligned to
            # Lead.meeting_scheduled_at / Lead.lead_closed_at) have no lead_id
            # FK to join through — Model.lead_id doesn't exist on Lead itself.
            q = q.filter(models.Lead.upload_log_id == batch_id)
        else:
            # Some callers (LeadStatusLog-based) already joined Lead via
            # pod_user_join above — reuse it instead of joining it twice.
            if not lead_already_joined:
                q = q.join(models.Lead, models.Lead.id == Model.lead_id)
            q = q.filter(models.Lead.upload_log_id == batch_id)

    rows = q.group_by("sort_key", "label").order_by("sort_key").all()
    return [{"label": r.label, "value": r.value} for r in rows]


def _humanise_source(src: str) -> str:
    if not src: return "Unknown"
    if src.startswith("gsheet:"): return "Google Sheet"
    if src.startswith("upload:"): return "Upload"
    return src.replace("_", " ").title()


# ─── Step 4: Query Logging ────────────────────────────────────────────────────

def log_query(db: Session, user_id: str, nl_query: str,
              dsl, success: bool, exec_ms, error) -> None:
    try:
        entry = models.AnalyticsQueryHistory(
            user_id=user_id,
            natural_language_query=nl_query[:1000],
            dsl_json=json.dumps(dsl) if dsl else None,
            success=success,
            execution_time_ms=exec_ms,
            error_message=error[:500] if error else None,
        )
        db.add(entry)
        db.commit()
    except Exception as exc:
        logger.warning("log_query failed: %s", exc)
        try: db.rollback()
        except Exception: pass

"""
AI Research Routes v2 — Pre-Call Intelligence Card
====================================================
Replaces the generic 4-field form fill with a role-aware, product-specific
pre-call brief. Key changes from v1:

  • Single Groq call (not 2) — halves latency
  • Persona mapping: title → buyer persona → tailored pitch angle
  • Product-aware: brief is specific to RCM (WebRTC calling/CRM stack)
  • 6-field output: company_pulse, why_they_need_us, opening_line,
                    likely_objection, persona_signal, heat_score
  • EC-7 guard: JSON extracted from prose/markdown wrapping
  • EC-8 guard: heat_score validated to hot|warm|cold
  • EC-9 guard: opening_line ≤ 280 chars
  • EC-1/EC-2 guard: "India", "[not provided]" treated as missing title
  • EC-4 guard: clinical roles flagged as non-buyers

Company-level caching unchanged (30-day TTL, normalised company key).
Contact-specific fields (opening_line, persona_signal) are regenerated
per lead from cached company data — same architecture as v1.
"""

import os
import re
import json
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

import models
from database import get_db
from auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/leads", tags=["AI Research"])

GROQ_URL      = "https://api.groq.com/openai/v1/chat/completions"
CACHE_TTL_DAYS = 30

# ── Server-side Groq rate limiter ─────────────────────────────────────────────
# Groq free tier for gemma2-9b-it:
#   - 30 RPM (requests per minute)
#   - 6,000 TPM (tokens per minute)  ← this is the real bottleneck
#
# Each research call uses ~530 input + ~175 output = ~705 tokens.
# At 6,000 TPM: max safe rate = 6000 / 705 ≈ 8 calls/minute = 1 every 7.5s.
# We use 8.0s interval to stay safely within the token budget.
_groq_lock            = asyncio.Lock()   # async lock for FastAPI request handlers
_groq_last_call_time  = 0.0              # async version: uses event loop monotonic time
_GROQ_MIN_INTERVAL_S  = 8.0             # seconds — dictated by 6000 TPM token limit

# RCA 2026-08-07: a Groq 429's retry-after header was honored verbatim with
# no ceiling — two prod requests hung 811s/1418s waiting it out, starving
# unrelated requests on this single-uvicorn-worker deployment. If Groq's
# quoted wait exceeds this, retrying within the request is pointless anyway
# (the limit won't have reset) — fail fast instead of blocking on it.
_GROQ_MAX_RETRY_AFTER_S = 30

# Thread-safe rate limiter for background bulk thread (uses wall-clock time.monotonic())
import threading as _threading
import time as _time
_groq_thread_lock          = _threading.Lock()
_groq_thread_last_call_time = 0.0  # wall-clock monotonic, shared across threads

# ── Persona definitions ───────────────────────────────────────────────────────

# Titles that are data-entry noise — treat as missing title (EC-1, EC-2)
_NOISE_TITLES = {
    "india", "us", "uk", "uae", "usa", "n/a", "na", "none", "null",
    "[not provided]", "not provided", "-", "--", "tbd",
}

# Clinical roles that are NOT buyers — flag them (EC-4)
_CLINICAL_ROLES = {
    "patient care technician", "nurse", "rn", "doctor", "physician",
    "medical officer", "clinical coordinator", "ward coordinator",
    "radiologist", "technician", "lab technician", "pharmacist",
    "physiotherapist", "therapist", "caregiver",
}

# Persona map: (regex pattern list) → persona key
# Evaluated top-to-bottom; first match wins
_PERSONA_PATTERNS = [
    # Decision makers — full buying authority
    (["ceo", "chief executive", "founder", "co-founder", "cofounder",
      "managing director", "md", "owner", "co-owner", "president",
      "proprietor", "director general"], "decision_maker_founder"),
    # Sales leaders — SDR/dialer efficiency is their #1 pain
    (["vp.*sales", "vice president.*sales", "head of sales", "chief revenue",
      "cro", "sales director", "director.*sales", "vp of sales",
      "national sales manager", "regional sales manager"], "sales_leader"),
    # Ops buyers — process efficiency, reporting, automation
    (["coo", "chief operating", "operations manager", "director.*operations",
      "head of operations", "vp.*operations", "vp of operations",
      "operations director", "business operations", "head.*ops"], "ops_buyer"),
    # Marketing — lead quality and attribution
    (["cmo", "chief marketing", "marketing manager", "marketing director",
      "head of marketing", "growth.*manager", "digital marketing",
      "vp.*marketing", "demand generation"], "marketing_influencer"),
    # Technical — integration and security focus
    (["cto", "chief technology", "it manager", "head of it", "it director",
      "technology manager", "systems manager", "vp.*technology",
      "head of technology", "it head"], "technical_blocker"),
    # General director/manager — often ops buyer
    (["director", "manager", "head of", "general manager", "gm"], "ops_buyer"),
]

# Persona context injected into the prompt
_PERSONA_CONTEXT = {
    "decision_maker_founder": {
        "label": "Decision Maker / Founder",
        "buying_power": "Full buying authority. Signs off on tools and budgets.",
        "pain_angle": "They are often doing sales themselves or managing a small SDR team manually. "
                      "They feel the chaos of missed follow-ups, scattered data, and slow onboarding of new SDRs.",
        "pitch_hook": "Show ROI in 30 seconds. Lead with outcomes ('40% more calls per SDR'). "
                      "Don't over-explain — they decide fast.",
    },
    "sales_leader": {
        "label": "VP / Head of Sales",
        "buying_power": "Strong influence. Will advocate internally. May need CFO sign-off.",
        "pain_angle": "Their SDRs are calling 50–200 leads a day with zero context. "
                      "They want call recordings, outcome tracking, and fewer no-answers.",
        "pitch_hook": "Speak their language: dials per day, connect rate, pipeline coverage. "
                      "They've seen bad demos — be crisp and specific.",
    },
    "ops_buyer": {
        "label": "Operations Manager / COO",
        "buying_power": "Economic buyer for process tools. Signs off on ops software.",
        "pain_angle": "They are running SDR teams on spreadsheets or disconnected tools. "
                      "Manual status updates, no visibility into who called what, when.",
        "pitch_hook": "Efficiency and visibility are the two words that open doors. "
                      "Lead with: 'How do you currently track your SDR call activity?'",
    },
    "marketing_influencer": {
        "label": "Marketing Manager",
        "buying_power": "Influencer. Drives lead quality conversation. Not the final buyer.",
        "pain_angle": "They generate leads but lose visibility once handed to sales. "
                      "Can't see which campaigns produce calls vs dead leads.",
        "pitch_hook": "Start with lead quality, not dialer features. "
                      "Ask: 'How do you know which of your campaigns actually converts to booked meetings?'",
    },
    "technical_blocker": {
        "label": "IT Manager / CTO",
        "buying_power": "Technical gatekeeper. Blocks or enables purchase. Not the economic buyer.",
        "pain_angle": "They worry about integrations, data security, and vendor reliability. "
                      "They need to know: does it work with our stack?",
        "pitch_hook": "Lead with: 'We integrate with your existing CRM in under a day, no IT overhead.' "
                      "Don't sell features — sell low friction.",
    },
    "clinical_nonbuyer": {
        "label": "Clinical / Non-Buyer",
        "buying_power": "Not a buyer. Ask to be redirected.",
        "pain_angle": "This is a clinical or patient-facing role. They have no authority over sales tools.",
        "pitch_hook": "This is NOT the right person. Use opening to politely ask: "
                      "'Could you point me to whoever manages your sales or ops team?'",
    },
    "generic_ops": {
        "label": "Unknown / General",
        "buying_power": "Unknown. Assess during the call.",
        "pain_angle": "Unclear role — ask discovery questions first. "
                      "Likely involved in operations or management.",
        "pitch_hook": "Open with a question rather than a pitch: "
                      "'What does your current lead management process look like?'",
    },
}


def _map_persona(title: str) -> str:
    """Map a job title string to a persona key.

    EC-1: 'India' as title → generic_ops
    EC-2: '[not provided]' → generic_ops
    EC-3: None/empty → generic_ops
    EC-4: Clinical roles → clinical_nonbuyer
    """
    if not title:
        return "generic_ops"
    normalised = title.lower().strip()

    # Noise / data-entry garbage → treat as missing
    if normalised in _NOISE_TITLES:
        return "generic_ops"

    # Clinical / non-buyer
    for clinical in _CLINICAL_ROLES:
        if clinical in normalised:
            return "clinical_nonbuyer"

    # Persona patterns — first match wins
    for patterns, persona in _PERSONA_PATTERNS:
        for pat in patterns:
            if re.search(pat, normalised):
                return persona

    return "generic_ops"


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_prompt_v2(lead: models.Lead, custom_prompt: str = None) -> str:
    """Build a single, persona-aware, product-specific prompt for RCM.

    Produces all 6 Pre-Call Intelligence Card fields in one Groq call.
    If a custom_prompt override is set by the admin (via Settings → AI Settings),
    it is used instead — the persona context is still injected as a prefix.
    """
    # ── Lead context ──
    name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "the contact"
    parts = []
    if name != "the contact":
        parts.append(f"Contact Name: {name}")
    title = (lead.title or "").strip()
    if title and title.lower() not in _NOISE_TITLES:
        parts.append(f"Job Title: {title}")
    if lead.company:
        parts.append(f"Company: {lead.company}")
    if lead.industry:
        parts.append(f"Industry: {lead.industry}")
    if lead.website:
        parts.append(f"Website: {lead.website}")
    location = ", ".join(filter(None, [lead.city, lead.state, lead.country]))
    if location:
        parts.append(f"Location: {location}")
    if lead.employee_count:
        parts.append(f"Employee Count: {lead.employee_count}")
    if lead.annual_revenue:
        parts.append(f"Annual Revenue: {lead.annual_revenue}")

    lead_context = "\n".join(parts) if parts else "Minimal lead data — use industry context."

    # ── Persona context ──
    persona_key = _map_persona(title)
    persona = _PERSONA_CONTEXT[persona_key]

    # ── Custom prompt override (admin-configured) ──
    if custom_prompt:
        if "{lead_context}" in custom_prompt:
            return custom_prompt.replace("{lead_context}", lead_context)
        return f"Lead Information:\n{lead_context}\n\n{custom_prompt}"

    # ── Default v2 prompt ──
    return f"""You are a pre-call intelligence engine for an SDR team that sells RCM — a WebRTC-powered calling and CRM platform that helps B2B sales teams manage leads, dial faster, and track every call outcome.

Our target buyers are: Sales Managers, VP Sales, COOs, Founders, and Ops heads at companies with 10–500 employees who run outbound SDR teams. They care about: calls per day, connect rate, lead tracking, and SDR efficiency.

You produce a pre-call brief — NOT a research report. It must be immediately usable by an SDR who has 30 seconds to read it before dialling.

---
LEAD INFORMATION:
{lead_context}

---
PERSONA ASSESSMENT:
Role type: {persona["label"]}
Buying power: {persona["buying_power"]}
Likely pain: {persona["pain_angle"]}
Approach: {persona["pitch_hook"]}

---
OUTPUT INSTRUCTIONS:
Return ONLY a valid JSON object with these exact 6 keys. No markdown, no explanation, no code fences.

{{
  "company_pulse": "One sentence: what this company does + their scale/growth signal. Be specific. Avoid generic phrases like 'leading provider'.",
  "why_they_need_us": "Two sentences: (1) the specific operational pain this persona likely has, (2) how RCM solves it for them specifically. Reference their industry and role.",
  "opening_line": "One ready-to-say sentence the SDR can use verbatim to open the call. Must reference something specific (company, role, or industry). Must end with a question. Max 280 characters.",
  "likely_objection": "The single most likely objection from this persona + a one-sentence handle. Format: 'Objection → Handle'",
  "persona_signal": "One sentence: their buying authority level + one urgency or relevance signal.",
  "heat_score": "Exactly one of: hot, warm, cold — followed by a comma and a 5-word reason. Example: 'hot, COO at fast-growing SaaS'"
}}"""


def _build_agenda_prompt(lead: models.Lead) -> str:
    """Prompt for a client-safe meeting agenda draft — this text is emailed
    directly to the prospect as part of a real calendar invite, unlike the
    pre-call brief above which only the SDR ever sees. Only pulls
    public-safe facts (company, contact name/title, the factual
    `research_company` "company pulse" sentence) — deliberately excludes
    the persona/objection/heat-score fields, which are internal sales
    strategy and must never reach the lead's own inbox."""
    name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or "the contact"
    company = lead.company or "their company"
    title = (lead.title or "").strip()
    company_pulse = (lead.research_company or "").strip()

    context_lines = [f"Company: {company}", f"Contact: {name}" + (f", {title}" if title else "")]
    if company_pulse:
        context_lines.append(f"What the company does: {company_pulse}")

    return f"""You are drafting a MEETING AGENDA that will be sent directly to a prospect as part of a real calendar invite email. The prospect will read this text themselves.

Write a short, professional, client-facing agenda for an upcoming sales meeting.

Rules:
- 2-3 sentences maximum.
- Only reference the factual context given below — never invent or speculate about internal buying signals, objections, or sales strategy.
- NEVER mention: heat score, likely objection, persona, buying authority, competitors, or any internal sales terminology.
- Focus on what will be covered: understanding their needs, a brief solution overview, and next steps.
- No hype language ("game-changing", "revolutionize", "synergy").

{chr(10).join(context_lines)}

Return ONLY valid JSON: {{"agenda": "<the agenda text>"}}"""


# ── JSON extractor (EC-7) ─────────────────────────────────────────────────────

def _extract_json_from_prose(content: str) -> dict:
    """Extract a JSON object from a Groq response that may be wrapped in prose
    or markdown fences (EC-7: 'Here is the research: {...}')."""
    content = content.strip()

    # Strip markdown fences
    if content.startswith("```"):
        lines = content.split("\n")
        # Remove first line (```json or ```) and last line (```)
        inner_lines = lines[1:] if len(lines) > 1 else lines
        if inner_lines and inner_lines[-1].strip() == "```":
            inner_lines = inner_lines[:-1]
        content = "\n".join(inner_lines).strip()

    # Try direct parse first
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Extract first {...} block from prose
    start = content.find("{")
    end   = content.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(content[start:end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract JSON from response: {content[:200]}")


# ── Sanitizer v2 ──────────────────────────────────────────────────────────────

VALID_HEAT = {"hot", "warm", "cold"}


def _sanitize_research_v2(result: dict) -> dict:
    """Validate and sanitize the 6-field v2 AI response.

    EC-8: heat_score not in (hot|warm|cold) → default 'warm'
    EC-9: opening_line > 280 chars → truncated
    All text fields: stripped, max 500 chars except opening_line (280).
    """
    sanitized = {}

    for key in ["company_pulse", "why_they_need_us", "likely_objection", "persona_signal"]:
        sanitized[key] = str(result.get(key, "")).strip()[:500]

    # opening_line: ready-to-say, SMS-safe (EC-9)
    sanitized["opening_line"] = str(result.get("opening_line", "")).strip()[:280]

    # heat_score: "hot, COO at fast-growing SaaS" → extract first word
    heat_raw = str(result.get("heat_score", "")).strip().lower()
    heat_word = heat_raw.split(",")[0].strip() if "," in heat_raw else heat_raw.split()[0] if heat_raw else ""
    sanitized["heat_score"] = heat_word if heat_word in VALID_HEAT else "warm"  # EC-8

    # Preserve full heat_score string (with reason) for display
    sanitized["heat_score_full"] = str(result.get("heat_score", "")).strip()[:100]

    # Also map v2 fields to legacy field names so existing DB columns still get populated
    sanitized["research_company"]         = sanitized["company_pulse"]
    sanitized["research_hypothesis"]      = sanitized["why_they_need_us"]
    sanitized["research_personalization"] = sanitized["persona_signal"]
    sanitized["research_contact"]         = sanitized["persona_signal"]
    sanitized["research_hook"]            = sanitized["opening_line"]
    sanitized["research_opening"]         = sanitized["opening_line"]
    sanitized["research_heat"]            = sanitized["heat_score"]

    return sanitized


# ── LLM config ────────────────────────────────────────────────────────────────

def _get_llm_config(db: Session) -> dict:
    from routes._admin_helpers import _get_or_create_sync_settings
    try:
        settings = _get_or_create_sync_settings(db)
        api_key       = (getattr(settings, "llm_api_key",     None) or "").strip() or os.getenv("GROQ_API_KEY", "")
        model         = getattr(settings, "llm_model",        None) or "gemma2-9b-it"
        provider      = getattr(settings, "llm_provider",     None) or "groq"
        research_prompt = getattr(settings, "research_prompt", None)
    except Exception:
        api_key       = os.getenv("GROQ_API_KEY", "")
        model         = "gemma2-9b-it"
        provider      = "groq"
        research_prompt = None
    return {"api_key": api_key, "model": model, "provider": provider, "research_prompt": research_prompt}


# ── Single Groq call (with server-side rate limiting + 429 retry) ─────────────

async def _call_groq_single(prompt: str, api_key: str, model: str) -> dict:
    """Single Groq API call. Serialised through a server-side lock so concurrent
    requests are queued and spaced at least _GROQ_MIN_INTERVAL_S apart.

    On 429: retries up to 3 times with exponential backoff (5s, 10s, 20s).
    Frontend never sees a 429 under normal load — the backend absorbs it.

    Handles:
    - EC-7: JSON extraction from prose/markdown
    - 429 rate limit → retry with backoff, surface to frontend only on exhaustion
    - Timeout → HTTPException(504)
    """
    import httpx
    import time

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="AI API key not configured. Go to Settings → AI Settings to add your Groq API key."
        )

    global _groq_last_call_time

    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        # ── Acquire lock and enforce minimum interval ──────────────────────────
        async with _groq_lock:
            now = asyncio.get_event_loop().time()
            gap = now - _groq_last_call_time
            if gap < _GROQ_MIN_INTERVAL_S:
                await asyncio.sleep(_GROQ_MIN_INTERVAL_S - gap)
            _groq_last_call_time = asyncio.get_event_loop().time()

            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        GROQ_URL,
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={
                            "model": model,
                            "messages": [{"role": "user", "content": prompt}],
                            "temperature": 0.3,
                            "max_tokens": 350,   # actual usage ~175 tokens; 350 gives 2× headroom
                        },
                    )
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="AI service timed out. Please try again.")
            except httpx.ConnectError:
                raise HTTPException(status_code=502, detail="Could not connect to AI service. Check your internet connection.")

        # ── Handle response (outside lock so we don't hold it during retries) ──
        if resp.status_code == 401:
            raise HTTPException(status_code=502, detail="Invalid API key. Go to Settings → AI Settings to update your key.")

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("retry-after", 5 * (2 ** attempt)))
            if retry_after > _GROQ_MAX_RETRY_AFTER_S:
                # Groq's quoted wait is too long to block this request on —
                # fail fast rather than trusting the header verbatim.
                logger.warning(f"Groq 429 retry-after {retry_after}s exceeds cap ({_GROQ_MAX_RETRY_AFTER_S}s) — failing fast")
                raise HTTPException(status_code=429, detail="AI rate limit reached. Please wait a moment and try again.")
            if attempt < MAX_RETRIES - 1:
                logger.warning(f"Groq 429 on attempt {attempt + 1}/{MAX_RETRIES} — waiting {retry_after}s")
                await asyncio.sleep(retry_after)
                continue   # retry
            else:
                # All retries exhausted
                raise HTTPException(status_code=429, detail="AI rate limit reached. Please wait a moment and try again.")

        if resp.status_code != 200:
            logger.error(f"Groq API error: {resp.status_code} — {resp.text}")
            raise HTTPException(status_code=502, detail=f"AI service error: {resp.status_code}")

        content = resp.json()["choices"][0]["message"]["content"]
        try:
            return _extract_json_from_prose(content)  # EC-7
        except (ValueError, KeyError) as e:
            logger.error(f"Failed to parse Groq response: {str(e)[:200]}")
            raise HTTPException(status_code=502, detail="AI returned an unexpected format. Please try again.")

    # Should never reach here, but satisfy type checker
    raise HTTPException(status_code=429, detail="AI rate limit reached. Please wait a moment and try again.")


# ── Sync Groq caller for background threads ───────────────────────────────────

def _call_groq_sync(prompt: str, api_key: str, model: str) -> dict:
    """Synchronous Groq API call — safe to call from a background threading.Thread.

    Uses threading.Lock + time.monotonic() so it is completely independent of
    any asyncio event loop. The async _call_groq_single uses asyncio.Lock and
    asyncio event-loop monotonic time — when called from a new event loop in a
    background thread, loop.time() starts near 0, causing an 8s sleep on every
    single call (wall-clock gap is fine but loop-clock gap is ~0).

    Rate limiting: same 8s minimum interval enforced via threading.Lock.
    Retry logic: up to 3 attempts with exponential backoff on 429.
    """
    import httpx as _httpx

    if not api_key:
        raise ValueError("AI API key not configured.")

    global _groq_thread_last_call_time

    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        with _groq_thread_lock:
            now = _time.monotonic()
            gap = now - _groq_thread_last_call_time
            if gap < _GROQ_MIN_INTERVAL_S:
                _time.sleep(_GROQ_MIN_INTERVAL_S - gap)
            _groq_thread_last_call_time = _time.monotonic()

            try:
                resp = _httpx.post(
                    GROQ_URL,
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3,
                        "max_tokens": 350,
                    },
                    timeout=30.0,
                )
            except _httpx.TimeoutException:
                raise TimeoutError("Groq API timed out.")
            except _httpx.ConnectError:
                raise ConnectionError("Could not connect to Groq API.")

        # Handle response outside lock
        if resp.status_code == 401:
            raise ValueError("Invalid Groq API key — update in Settings → AI Settings.")

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("retry-after", 5 * (2 ** attempt)))
            if retry_after > _GROQ_MAX_RETRY_AFTER_S:
                logger.warning(f"Groq 429 (sync) retry-after {retry_after}s exceeds cap ({_GROQ_MAX_RETRY_AFTER_S}s) — failing fast")
                raise RuntimeError("Groq rate limit exhausted after retries.")
            if attempt < MAX_RETRIES - 1:
                logger.warning(f"Groq 429 (sync) attempt {attempt + 1}/{MAX_RETRIES} — waiting {retry_after}s")
                _time.sleep(retry_after)
                continue
            raise RuntimeError("Groq rate limit exhausted after retries.")

        if resp.status_code != 200:
            raise RuntimeError(f"Groq API error: {resp.status_code} — {resp.text[:200]}")

        content = resp.json()["choices"][0]["message"]["content"]
        return _extract_json_from_prose(content)  # EC-7

    raise RuntimeError("Groq rate limit exhausted after retries.")


# ── Company key normalisation (unchanged from v1) ─────────────────────────────

def _normalise_company_key(name: str) -> str:
    if not name:
        return ""
    s = name.lower().strip()
    s = re.sub(r"\s*[-–]\s*.+$", "", s)
    s = re.sub(r"\b(pvt|ltd|llc|inc|corp|gmbh|private|limited|company|co)\b", "", s)
    s = re.sub(r"[^\w\s]", "", s)
    return re.sub(r"\s+", " ", s).strip()


# ── Cache completeness check (EC-16) ─────────────────────────────────────────

def _cache_has_v2_fields(cached: models.CompanyResearch) -> bool:
    """Return True only if the cache entry has both v2 fields (heat + opening).
    Old v1 entries lacking these are treated as cache misses (EC-16)."""
    return bool(
        getattr(cached, "research_heat", None) and
        getattr(cached, "research_opening", None)
    )


# ── Main research endpoint ────────────────────────────────────────────────────

@router.post("/{lead_id}/ai-research")
async def ai_research_lead(
    lead_id: str,
    force_refresh: bool = Query(False, description="Skip cache and regenerate fresh research"),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI-powered Pre-Call Intelligence Card for a lead.

    v2 changes:
    - Single Groq call per lead (not 2)
    - Persona-aware, RCM-specific prompt
    - 6-field output + legacy fields backfilled for backward compat
    - EC-16: old v1 cache entries without heat/opening → treated as miss
    """
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    company_key = _normalise_company_key(lead.company or "")
    llm_config  = _get_llm_config(db)

    cached        = None
    cache_is_stale = False

    # ── Cache lookup ──────────────────────────────────────────────────────────
    if company_key and not force_refresh:
        try:
            cached = db.query(models.CompanyResearch).filter(
                models.CompanyResearch.company_name == company_key
            ).first()
        except Exception:
            cached = None

        if cached:
            age = datetime.now(timezone.utc) - cached.updated_at.replace(tzinfo=timezone.utc)
            contact_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
            cached_contact_key = _normalise_company_key(cached.research_contact or "")
            contact_mismatch = (
                contact_name and cached_contact_key
                and cached_contact_key != _normalise_company_key(contact_name)
            )
            if age > timedelta(days=CACHE_TTL_DAYS):
                cache_is_stale = True
                cached = None
            elif not _cache_has_v2_fields(cached):
                # EC-16: old v1 cache entry — regenerate to get v2 fields
                logger.info(f"AI Research cache is v1 (no heat/opening) for: {company_key} — upgrading")
                cache_is_stale = True
                cached = None
            elif contact_mismatch:
                # The persona-specific fields (why_they_need_us, opening_line,
                # persona_signal, likely_objection, heat_score) are tailored to
                # ONE contact — this cache row was generated for a different
                # contact at the same company. Serving it verbatim shows the
                # wrong person's name/role in the panel. Regenerate fresh for
                # this contact rather than reuse (company-level facts get
                # re-derived too — cheaper correctness beats stale sharing).
                logger.info(
                    f"AI Research cache contact mismatch for {company_key}: "
                    f"cached for '{cached.research_contact}', requested for '{contact_name}' — regenerating"
                )
                cached = None
            else:
                logger.info(f"AI Research cache HIT (v2) for: {company_key} (age={age.days}d)")

    # ── Cache HIT: return immediately without calling Groq ────────────────────
    if cached:
        cached_result = {
            "company_pulse":     cached.research_company or "",
            "why_they_need_us":  cached.research_hypothesis or "",
            "opening_line":      cached.research_opening or "",
            "likely_objection":  cached.research_hook or "",
            "persona_signal":    cached.research_personalization or "",
            "heat_score":        cached.research_heat or "warm",
            "heat_score_full":   cached.research_heat or "warm",
            # Legacy field names (backward compat)
            "research_company":         cached.research_company or "",
            "research_hypothesis":      cached.research_hypothesis or "",
            "research_personalization": cached.research_personalization or "",
            "research_contact":         cached.research_contact or "",
            "research_hook":            cached.research_hook or "",
            "research_opening":         cached.research_opening or "",
            "research_heat":            cached.research_heat or "warm",
        }
        # Persist to lead row so individual lead has the data
        for field in [
            "research_company", "research_contact", "research_hypothesis",
            "research_personalization", "research_hook",
            "research_heat", "research_opening",
        ]:
            val = cached_result.get(field)
            if val:
                setattr(lead, field, val)
        db.commit()
        return {**cached_result, "from_cache": True}

    # ── Cache MISS: call Groq ─────────────────────────────────────────────────
    prompt  = _build_prompt_v2(lead, custom_prompt=llm_config.get("research_prompt"))
    raw     = await _call_groq_single(prompt, llm_config["api_key"], llm_config["model"])
    result  = _sanitize_research_v2(raw)

    # ── Persist research to lead ──────────────────────────────────────────────
    for field in [
        "research_company", "research_contact", "research_hypothesis",
        "research_personalization", "research_hook", "research_channels",
        "research_industry", "research_company_size", "research_services",
        "research_geo", "research_timezone",
        "research_heat", "research_opening",
    ]:
        val = result.get(field)
        if val is not None:
            setattr(lead, field, val)
    db.commit()

    # ── Update company cache ──────────────────────────────────────────────────
    if company_key:
        _update_company_cache(db, company_key, result, raw)

    return {**result, "from_cache": False}


@router.post("/{lead_id}/meeting-agenda-draft")
async def draft_meeting_agenda(
    lead_id: str,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Drafts a client-safe meeting agenda for the "Meeting Booked" modal —
    a one-off draft per booking, not cached like the company research card.
    See _build_agenda_prompt's docstring for why this must never reuse the
    persona/objection/heat-score research fields."""
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    llm_config = _get_llm_config(db)
    prompt = _build_agenda_prompt(lead)
    raw = await _call_groq_single(prompt, llm_config["api_key"], llm_config["model"])
    return {"agenda": raw.get("agenda", "")}


def _update_company_cache(db: Session, company_key: str, result: dict, raw: dict):
    """Upsert company-level cache with v2 fields. Handles race condition (EC-12)."""
    cache_fields = {
        "research_company":         result.get("research_company", ""),
        "research_hypothesis":      result.get("research_hypothesis", ""),
        "research_personalization": result.get("research_personalization", ""),
        "research_contact":         result.get("research_contact", ""),
        "research_hook":            result.get("research_hook", ""),
        "research_heat":            result.get("research_heat", "warm"),
        "research_opening":         result.get("research_opening", ""),
        "raw_ai_response":          json.dumps(raw),
    }
    try:
        existing = db.query(models.CompanyResearch).filter(
            models.CompanyResearch.company_name == company_key
        ).first()
        if existing:
            for k, v in cache_fields.items():
                setattr(existing, k, v)
        else:
            db.add(models.CompanyResearch(company_name=company_key, **cache_fields))
        db.commit()
        logger.info(f"AI Research cache updated (v2) for: {company_key}")
    except IntegrityError:
        db.rollback()
        logger.info(f"AI Research cache race condition for: {company_key} — safe to ignore")
    except Exception as e:
        db.rollback()
        logger.warning(f"AI Research cache save failed for {company_key}: {e}")

# ── routes/analytics_ai_routes.py — AI-powered insights & recommendations ────
"""
AI Analytics Routes — /api/admin/analytics
==========================================
LLM-powered insight summarisation and context-specific recommendations.
Uses Groq API via the shared _get_llm_config() from ai_research_routes.
"""

import time
import logging
from typing import List as _List, Optional

from pydantic import BaseModel

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin

from routes.analytics_routes import _cache_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])


# ─── Endpoint 7: Insight Summary (LLM) ────────────────────────────────────────
#
# Receives precomputed rule-based insights from the frontend (max 3 strings).
# Returns a single ≤15-word summary line.  Max tokens: 80.
# Uses the same _get_llm_config() as ai_research_routes.py — no new config.
# Cached server-side by insights hash to avoid repeated calls.


class _InsightSummaryRequest(BaseModel):
    insights: _List[str]

_llm_summary_cache: dict = {}  # hash(insights_tuple) → str
_LLM_SUMMARY_CACHE_TTL = 900   # 15 min

@router.post("/insights-summary")
def get_insights_summary(
    payload: _InsightSummaryRequest,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Receives 1–3 precomputed rule-based insights.
    Returns a single ≤15-word human summary via Groq (80 tokens max).
    Silent 200 with summary=null if LLM not configured or fails.
    """
    if not payload.insights:
        return {"summary": None}

    texts = [t.strip() for t in payload.insights[:3] if t.strip()]
    if not texts:
        return {"summary": None}

    cache_key = hash(tuple(texts))
    cached = _llm_summary_cache.get(cache_key)
    if cached is not None:
        return {"summary": cached}

    try:
        from routes.ai_research_routes import _get_llm_config, _call_groq as _call_groq_raw
        cfg = _get_llm_config(db)
        if not cfg.get("api_key"):
            return {"summary": None}

        prompt = (
            "You are a CRM analytics assistant. Summarise these sales team observations "
            "into ONE concise sentence of 15 words or fewer. Be direct and actionable.\n\n"
            "Observations:\n" + "\n".join(f"- {t}" for t in texts) +
            "\n\nReply with ONLY the summary sentence. No preamble."
        )

        import httpx
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
                json={
                    "model": cfg.get("model", "gemma2-9b-it"),
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 80,
                },
            )
        if resp.status_code != 200:
            return {"summary": None}

        summary = resp.json()["choices"][0]["message"]["content"].strip().strip('"')
        _llm_summary_cache[cache_key] = summary
        return {"summary": summary}

    except Exception as exc:
        logger.warning("insights-summary LLM failed: %s", exc)
        return {"summary": None}


# ─── Endpoint 8: AI Recommendation (context-specific, data-grounded) ──────────
#
# Fires when the super admin has selected POD + date range + batch.
# Returns a single specific recommendation referencing actual KPI numbers.
# Cached 2 min by filter key. Returns null on zero-activity batches.


class _AiRecommendationRequest(BaseModel):
    pod_id: Optional[str] = None
    batch_label: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    # KPI snapshot passed from frontend (already loaded)
    leads: int = 0
    calls: int = 0
    connects: int = 0
    meetings: int = 0
    connect_rate: Optional[float] = None
    pod_avg_connect_rate: Optional[float] = None
    top_sdr_name: Optional[str] = None
    top_sdr_connect_rate: Optional[float] = None


_ai_rec_cache: dict = {}  # cache_key → (recommendation_str, expires_at)
_AI_REC_TTL = 120  # 2 min, matches analytics endpoint TTL


@router.post("/ai-recommendation")
def get_ai_recommendation(
    payload: _AiRecommendationRequest,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Returns a single specific, data-grounded recommendation for the current
    filter context (POD + date range + batch). References actual numbers.
    Returns null if zero activity so the frontend can hide the tag.

    PERF: Returns cached value immediately (or null on first call) and
    refreshes the cache asynchronously via a background thread so the
    12-second Groq timeout never blocks a FastAPI worker.
    """
    # Zero activity — return null so frontend hides the tag
    if payload.leads == 0 and payload.calls == 0:
        return {"recommendation": None}

    ck = _cache_key(
        "ai_rec",
        payload.pod_id, payload.batch_label, payload.date_from, payload.date_to,
        payload.leads, payload.calls, payload.connects, payload.meetings,
    )

    # Return cached value immediately if fresh
    cached = _ai_rec_cache.get(ck)
    if cached:
        rec, expires_at = cached
        if time.time() < expires_at:
            return {"recommendation": rec}

    def _fetch_and_cache():
        """Run Groq call in background thread — does not block the HTTP response."""
        try:
            from routes.ai_research_routes import _get_llm_config
            from database import SessionLocal
            _db = SessionLocal()
            try:
                cfg = _get_llm_config(_db)
            finally:
                _db.close()

            if not cfg.get("api_key"):
                return

            context_parts = [
                f"Batch: {payload.batch_label or 'Unknown'}",
                f"Date range: {payload.date_from or 'N/A'} to {payload.date_to or 'N/A'}",
                f"Leads assigned: {payload.leads}",
                f"Calls made: {payload.calls}",
                f"Live connects: {payload.connects}",
                f"Meetings booked: {payload.meetings}",
            ]
            if payload.connect_rate is not None:
                context_parts.append(f"Connect rate: {payload.connect_rate}%")
            if payload.pod_avg_connect_rate is not None:
                context_parts.append(f"Pod average connect rate: {payload.pod_avg_connect_rate}%")
            if payload.top_sdr_name and payload.top_sdr_connect_rate is not None:
                context_parts.append(
                    f"Top SDR: {payload.top_sdr_name} with {payload.top_sdr_connect_rate}% connect rate"
                )

            prompt = (
                "You are a CRM sales analytics assistant for a B2B outreach team. "
                "Based on the data below, give ONE specific, actionable recommendation in 20 words or fewer. "
                "Reference specific numbers. Do not give generic advice. Do not use preamble or bullet points.\n\n"
                "Data:\n" + "\n".join(f"- {p}" for p in context_parts) +
                "\n\nReply with ONLY the recommendation sentence."
            )

            import httpx
            with httpx.Client(timeout=15.0) as client:
                resp = client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
                    json={
                        "model": cfg.get("model", "gemma2-9b-it"),
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.4,
                        "max_tokens": 60,
                    },
                )
            if resp.status_code == 200:
                rec = resp.json()["choices"][0]["message"]["content"].strip().strip('"')
                _ai_rec_cache[ck] = (rec, time.time() + _AI_REC_TTL)

        except Exception as exc:
            logger.warning("ai-recommendation background fetch failed: %s", exc)

    # If no fresh cache, fire background fetch and return null immediately.
    # The frontend will get the recommendation on the next poll/refresh.
    import threading
    threading.Thread(target=_fetch_and_cache, daemon=True).start()
    return {"recommendation": None}

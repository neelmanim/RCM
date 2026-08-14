"""
Growth Intelligence Routes — Compute pipeline metrics and generate AI-powered
insights using the configured Groq LLM.

Returns computed KPIs (velocity, conversion, efficiency) alongside AI-generated
strategic recommendations.  Results are cached for 15 minutes via cache.py
(Redis → in-memory) to avoid hammering the LLM on every page load.

RCA 2026-06-17: replaced unbounded module-level _cache dict with cache.py
to prevent memory leaks on the 512MB Render Starter instance.
"""

import os
import json
import time
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
from models import TERMINAL_STATUSES, ACTIVE_STATUSES
from database import get_db
from auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Growth Intelligence"])

# ── Cache (15 min TTL) ───────────────────────────────────────────────────────
# RCA 2026-06-17: replaced unbounded module-level _cache dict with cache.py.
# cache.py uses Redis (Upstash) → in-memory with proper TTL eviction.
# The old dict had no size limit and leaked on the 512MB Render Starter.
CACHE_TTL = 900  # 15 minutes
_GI_NS = "growth_intelligence"  # namespace in cache.py

try:
    from cache import get_cached as _get_cached, set_cached as _set_cached
    _USE_CACHE_PY = True
except ImportError:
    _USE_CACHE_PY = False


def _cache_key(user_id: str, role: str) -> str:
    """Scope cache by role: admins share one view; SDRs get per-user insights."""
    if role in ("Admin", "Super Admin"):
        return "growth_admin"
    return f"growth_{user_id}"


# ── Metrics computation ──────────────────────────────────────────────────────

def _compute_metrics(db: Session, user: dict) -> dict:
    """Compute pipeline health metrics from DB data."""
    role = user.get("role", "SDR")
    user_id = user.get("sub")

    # Base query scoped by role
    base = db.query(models.Lead)
    if role in ("SDR", "AE"):
        base = base.join(models.Lead.assigned_users).filter(models.User.id == user_id)
    elif role == "Pod Admin":
        admin_user = db.query(models.User).filter(models.User.id == user_id).first()
        if admin_user and admin_user.pod_id:
            pod_sdr_ids = [u.id for u in db.query(models.User).filter(
                models.User.pod_id == admin_user.pod_id
            ).all()]
            base = base.join(models.Lead.assigned_users).filter(models.User.id.in_(pod_sdr_ids))

    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    seven_days_ago = now - timedelta(days=7)

    # Total leads
    total = base.count()

    # Status counts
    status_counts = {}
    for s in [st.value for st in models.Status]:
        status_counts[s] = base.filter(models.Lead.status == s).count()

    # 30-day active leads (created or updated in last 30 days)
    recent_leads = base.filter(
        models.Lead.created_at >= thirty_days_ago
    ).count()

    # Meetings scheduled (all time + last 30 days)
    meetings_total = status_counts.get("Meeting Scheduled", 0)
    meetings_30d = base.filter(
        models.Lead.status == "Meeting Scheduled",
        models.Lead.status_changed_at >= thirty_days_ago
    ).count()

    # Conversion rate
    conversion_rate = round((meetings_total / total * 100), 1) if total > 0 else 0

    # Velocity: leads moving through pipeline in last 7 days
    leads_moved_7d = base.filter(
        models.Lead.status_changed_at >= seven_days_ago,
    ).count()

    # Research completion rate
    researched = base.filter(
        models.Lead.research_company.isnot(None),
        models.Lead.research_company != ""
    ).count()
    research_rate = round((researched / total * 100), 1) if total > 0 else 0

    # Active vs terminal
    active_count = sum(status_counts.get(s, 0) for s in ACTIVE_STATUSES if s in status_counts)
    terminal_count = sum(status_counts.get(s, 0) for s in TERMINAL_STATUSES if s in status_counts)

    # Disqualified / declined / unreachable
    disqualified = status_counts.get("Disqualified", 0)
    customer_declined = status_counts.get("Customer Declined", 0)
    unreachable = status_counts.get("Unreachable", 0)

    # Call stats (30 days) — dialer_calls (Aircall/Klenty/RCM) + manual call_logs.
    # Previously CallLog-only and checked outcome against ["connected", "meeting_booked",
    # "interested", "callback"] — values nothing in the system ever writes (real outcomes
    # are Title Case, e.g. "Call Back Later", "Meeting Scheduled"), so this always read 0%.
    from routes.analytics_routes import CONNECT_OUTCOMES
    conn_outcomes = list(CONNECT_OUTCOMES)

    cl_base = db.query(models.CallLog).filter(models.CallLog.called_at >= thirty_days_ago)
    dc_base = db.query(models.DialerCall).filter(
        models.DialerCall.direction == "outbound",
        models.dialer_call_event_time() >= thirty_days_ago,
    )
    if role in ("SDR", "AE"):
        cl_base = cl_base.filter(models.CallLog.user_id == user_id)
        dc_base = dc_base.filter(models.DialerCall.user_id == user_id)

    total_calls_30d = cl_base.count() + dc_base.count()
    connected_calls_30d = (
        cl_base.filter(models.CallLog.outcome.in_(conn_outcomes)).count()
        + dc_base.filter(models.dialer_call_connected(conn_outcomes)).count()
    )
    connect_rate = round((connected_calls_30d / total_calls_30d * 100), 1) if total_calls_30d > 0 else 0

    return {
        "total_leads": total,
        "active_leads": active_count,
        "terminal_leads": terminal_count,
        "new_leads_30d": recent_leads,
        "meetings_total": meetings_total,
        "meetings_30d": meetings_30d,
        "conversion_rate": conversion_rate,
        "leads_moved_7d": leads_moved_7d,
        "research_completion_rate": research_rate,
        "total_calls_30d": total_calls_30d,
        "connect_rate_30d": connect_rate,
        "disqualified": disqualified,
        "customer_declined": customer_declined,
        "unreachable": unreachable,
        "status_counts": status_counts,
    }


# ── AI Insight Generation ────────────────────────────────────────────────────

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def _get_llm_config(db: Session) -> dict:
    """Read LLM configuration from SyncSettings, fall back to env vars."""
    from routes.admin_routes import _get_or_create_sync_settings
    try:
        settings = _get_or_create_sync_settings(db)
        api_key = (settings.llm_api_key if hasattr(settings, 'llm_api_key') else None) or os.getenv("GROQ_API_KEY", "")
        model = (settings.llm_model if hasattr(settings, 'llm_model') else None) or "gemma2-9b-it"
    except Exception:
        api_key = os.getenv("GROQ_API_KEY", "")
        model = "gemma2-9b-it"
    return {"api_key": api_key, "model": model}


async def _generate_ai_insights(metrics: dict, api_key: str, model: str) -> dict:
    """Call Groq LLM to generate strategic insights from pipeline metrics."""
    import httpx

    if not api_key:
        return _fallback_insights(metrics)

    prompt = f"""You are an expert sales operations analyst. Analyze these CRM pipeline metrics and generate exactly 4 strategic insights.

Pipeline Metrics (last 30 days):
- Total Leads: {metrics['total_leads']}
- Active Leads: {metrics['active_leads']}
- New Leads (30d): {metrics['new_leads_30d']}
- Meetings Booked: {metrics['meetings_total']} (30-day: {metrics['meetings_30d']})
- Conversion Rate: {metrics['conversion_rate']}%
- Lead Velocity (moved in 7d): {metrics['leads_moved_7d']}
- Research Completion: {metrics['research_completion_rate']}%
- Calls Made (30d): {metrics['total_calls_30d']}
- Connect Rate: {metrics['connect_rate_30d']}%
- Disqualified: {metrics['disqualified']}
- Customer Declined: {metrics['customer_declined']}
- Unreachable: {metrics['unreachable']}

Return ONLY a valid JSON object with exactly this structure:
{{
  "insights": [
    {{
      "title": "Short title (max 6 words)",
      "description": "One actionable sentence about this metric trend",
      "metric_value": "The key number (e.g. '12.5%' or '47')",
      "trend": "up" or "down" or "neutral",
      "category": "velocity" or "conversion" or "efficiency" or "health"
    }}
  ],
  "headline": "One sentence executive summary of pipeline health",
  "health_score": A number 1-100 rating overall pipeline health
}}

Focus on:
1. Lead velocity / throughput
2. Conversion efficiency
3. Research-to-calling pipeline health
4. Overall team productivity

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation."""

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "max_tokens": 600,
                },
            )

        if resp.status_code != 200:
            logger.warning(f"Groq API returned {resp.status_code} for growth intelligence")
            return _fallback_insights(metrics)

        content = resp.json()["choices"][0]["message"]["content"].strip()

        # Clean markdown fences
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

        return json.loads(content)

    except Exception as e:
        logger.warning(f"AI insight generation failed: {e}")
        return _fallback_insights(metrics)


def _fallback_insights(metrics: dict) -> dict:
    """Generate deterministic insights when AI is not available."""
    insights = []

    # Velocity insight
    velocity = metrics["leads_moved_7d"]
    insights.append({
        "title": "Pipeline Velocity",
        "description": f"{velocity} leads advanced stages in the last 7 days" if velocity > 0
                       else "No leads moved through pipeline this week — check SDR activity",
        "metric_value": str(velocity),
        "trend": "up" if velocity > 5 else ("neutral" if velocity > 0 else "down"),
        "category": "velocity",
    })

    # Conversion insight
    conv = metrics["conversion_rate"]
    insights.append({
        "title": "Conversion Rate",
        "description": f"{conv}% of leads converted to meetings — "
                       + ("strong performance" if conv >= 5 else "room for improvement"),
        "metric_value": f"{conv}%",
        "trend": "up" if conv >= 5 else ("neutral" if conv >= 2 else "down"),
        "category": "conversion",
    })

    # Research completion
    research = metrics["research_completion_rate"]
    insights.append({
        "title": "Research Readiness",
        "description": f"{research}% of leads have completed research — "
                       + ("pipeline well-prepared" if research >= 60 else "many leads need research before calling"),
        "metric_value": f"{research}%",
        "trend": "up" if research >= 60 else ("neutral" if research >= 30 else "down"),
        "category": "efficiency",
    })

    # Connect rate
    connect = metrics["connect_rate_30d"]
    insights.append({
        "title": "Call Connect Rate",
        "description": f"{connect}% of calls resulted in a connection — "
                       + ("above average" if connect >= 15 else "consider adjusting call timing"),
        "metric_value": f"{connect}%",
        "trend": "up" if connect >= 15 else ("neutral" if connect >= 8 else "down"),
        "category": "health",
    })

    # Simple health score
    health = min(100, max(10,
        int(conv * 3 + research * 0.3 + connect * 0.5 + min(velocity, 20) * 1.5)
    ))

    return {
        "insights": insights,
        "headline": f"Pipeline at {health}% health — {metrics['active_leads']} active leads, {metrics['meetings_30d']} meetings this month",
        "health_score": health,
    }


# ── API Endpoint ─────────────────────────────────────────────────────────────

@router.get("/growth-intelligence")
async def get_growth_intelligence(
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns computed pipeline metrics + AI-generated strategic insights.
    Cached for 15 minutes per user/role scope.
    """
    key = _cache_key(user.get("sub", ""), user.get("role", "SDR"))

    # Check cache (via cache.py — Redis → in-memory, bounded TTL)
    if _USE_CACHE_PY:
        cached = _get_cached(_GI_NS, key)
        if cached is not None:
            logger.info(f"[growth-intelligence] cache hit for {key}")
            return cached

    # Compute metrics
    metrics = _compute_metrics(db, user)

    # Generate AI insights
    llm_config = _get_llm_config(db)
    ai_insights = await _generate_ai_insights(metrics, llm_config["api_key"], llm_config["model"])

    result = {
        "metrics": metrics,
        "ai": ai_insights,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Store in cache.py (Redis + in-memory, TTL-managed, no unbounded growth)
    if _USE_CACHE_PY:
        _set_cached(_GI_NS, key, result, ttl=CACHE_TTL)

    return result

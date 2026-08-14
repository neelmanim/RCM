"""Growth Intelligence — pipeline metrics + AI-powered strategic insights."""
import os, json, time, logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from middleware import get_current_user
from models import Lead, User, CallLog, SyncSettings, Status, TERMINAL_STATUSES, ACTIVE_STATUSES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Growth Intelligence"])

_cache: dict = {}
CACHE_TTL = 900
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def _compute_metrics(db, user):
    role = user.get("role", "SDR"); uid = user.get("sub")
    base = db.query(Lead)
    if role == "SDR":
        base = base.join(Lead.assigned_users).filter(User.id == uid)
    elif role == "Pod Admin":
        au = db.query(User).filter(User.id == uid).first()
        if au and au.pod_id:
            ids = [u.id for u in db.query(User).filter(User.pod_id == au.pod_id).all()]
            base = base.join(Lead.assigned_users).filter(User.id.in_(ids))

    now = datetime.now(timezone.utc)
    d30 = now - timedelta(days=30); d7 = now - timedelta(days=7)
    total = base.count()
    sc = {s.value: base.filter(Lead.status == s.value).count() for s in Status}
    meetings = sc.get("Meeting Scheduled", 0)
    m30 = base.filter(Lead.status == "Meeting Scheduled", Lead.status_changed_at >= d30).count()
    conv = round(meetings / total * 100, 1) if total else 0
    v7 = base.filter(Lead.status_changed_at >= d7).count()
    researched = base.filter(Lead.research_company.isnot(None), Lead.research_company != "").count()
    rr = round(researched / total * 100, 1) if total else 0
    active = sum(sc.get(s, 0) for s in ACTIVE_STATUSES if s in sc)
    terminal = sum(sc.get(s, 0) for s in TERMINAL_STATUSES if s in sc)

    cb = db.query(CallLog).filter(CallLog.called_at >= d30)
    if role == "SDR": cb = cb.filter(CallLog.user_id == uid)
    tc = cb.count()
    cc = cb.filter(CallLog.outcome.in_(["connected", "meeting_booked", "interested", "callback"])).count()

    return {"total_leads": total, "active_leads": active, "terminal_leads": terminal, "new_leads_30d": base.filter(Lead.created_at >= d30).count(), "meetings_total": meetings, "meetings_30d": m30, "conversion_rate": conv, "leads_moved_7d": v7, "research_completion_rate": rr, "total_calls_30d": tc, "connect_rate_30d": round(cc / tc * 100, 1) if tc else 0, "disqualified": sc.get("Disqualified", 0), "customer_declined": sc.get("Customer Declined", 0), "unreachable": sc.get("Unreachable", 0), "status_counts": sc}


def _fallback_insights(m):
    v = m["leads_moved_7d"]; c = m["conversion_rate"]; r = m["research_completion_rate"]; cr = m["connect_rate_30d"]
    insights = [
        {"title": "Pipeline Velocity", "description": f"{v} leads advanced in 7d" if v else "No movement this week", "metric_value": str(v), "trend": "up" if v > 5 else ("neutral" if v else "down"), "category": "velocity"},
        {"title": "Conversion Rate", "description": f"{c}% to meetings — " + ("strong" if c >= 5 else "needs work"), "metric_value": f"{c}%", "trend": "up" if c >= 5 else "down", "category": "conversion"},
        {"title": "Research Readiness", "description": f"{r}% researched — " + ("well prepared" if r >= 60 else "gaps remain"), "metric_value": f"{r}%", "trend": "up" if r >= 60 else "down", "category": "efficiency"},
        {"title": "Call Connect Rate", "description": f"{cr}% connected — " + ("above avg" if cr >= 15 else "try different timing"), "metric_value": f"{cr}%", "trend": "up" if cr >= 15 else "down", "category": "health"},
    ]
    h = min(100, max(10, int(c * 3 + r * 0.3 + cr * 0.5 + min(v, 20) * 1.5)))
    return {"insights": insights, "headline": f"Pipeline at {h}% — {m['active_leads']} active, {m['meetings_30d']} meetings this month", "health_score": h}


async def _generate_ai(metrics, api_key, model):
    import httpx
    if not api_key: return _fallback_insights(metrics)
    prompt = f"""Analyze these CRM pipeline metrics, return ONLY valid JSON with 4 insights:
Total Leads: {metrics['total_leads']}, Active: {metrics['active_leads']}, New(30d): {metrics['new_leads_30d']}, Meetings: {metrics['meetings_total']}(30d: {metrics['meetings_30d']}), Conversion: {metrics['conversion_rate']}%, Velocity(7d): {metrics['leads_moved_7d']}, Research: {metrics['research_completion_rate']}%, Calls(30d): {metrics['total_calls_30d']}, Connect: {metrics['connect_rate_30d']}%

Return: {{"insights":[{{"title":"","description":"","metric_value":"","trend":"up/down/neutral","category":"velocity/conversion/efficiency/health"}}], "headline":"", "health_score": 1-100}}"""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(GROQ_URL, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "max_tokens": 600})
        if resp.status_code != 200: return _fallback_insights(metrics)
        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"): content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"): content = content[:-3]
        return json.loads(content.strip())
    except Exception as e:
        logger.warning(f"AI insight failed: {e}"); return _fallback_insights(metrics)


@router.get("/growth-intelligence")
async def get_growth_intelligence(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    role = user.get("role", "SDR")
    key = "growth_admin" if role in ("Admin", "Super Admin") else f"growth_{user.get('sub')}"
    if key in _cache and (time.time() - _cache[key]["ts"]) < CACHE_TTL:
        return _cache[key]["data"]
    metrics = _compute_metrics(db, user)
    try:
        s = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
        api_key = (getattr(s, 'llm_api_key', None) or os.getenv("GROQ_API_KEY", ""))
        model = (getattr(s, 'llm_model', None) or "llama-3.3-70b-versatile")
    except Exception:
        api_key = os.getenv("GROQ_API_KEY", ""); model = "llama-3.3-70b-versatile"
    ai = await _generate_ai(metrics, api_key, model)
    result = {"metrics": metrics, "ai": ai, "generated_at": datetime.now(timezone.utc).isoformat()}
    _cache[key] = {"ts": time.time(), "data": result}
    return result

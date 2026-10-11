"""AI Research routes — Groq/LLM-powered lead research with company-level caching."""
import os, json, logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import get_db
from middleware import get_current_user
from models import Lead, SyncSettings, CompanyResearch

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/leads", tags=["AI Research"])

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
VALID_INDUSTRIES = {"SaaS", "Healthcare", "Finance", "Retail", "Manufacturing", "Real Estate", "Education", "Other"}
VALID_SIZES = {"1–50", "51–200", "201–1000", "1000+"}
VALID_TIMEZONES = {"IST", "EST", "PST", "GMT", "CST", "AEST", "Other"}
VALID_CHANNELS = {"Website Chat", "WhatsApp", "Social Media", "Phone/Calling", "In-Person", "Email", "Chatbot"}


def _get_llm_config(db):
    try:
        s = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
        return {"api_key": (getattr(s, 'llm_api_key', None) or os.getenv("GROQ_API_KEY", "")), "model": (getattr(s, 'llm_model', None) or "llama-3.3-70b-versatile"), "provider": (getattr(s, 'llm_provider', None) or "groq")}
    except Exception:
        return {"api_key": os.getenv("GROQ_API_KEY", ""), "model": "llama-3.3-70b-versatile", "provider": "groq"}


def _build_prompt(lead):
    parts = []
    if lead.first_name or lead.last_name: parts.append(f"Contact Name: {lead.first_name or ''} {lead.last_name or ''}".strip())
    if lead.title: parts.append(f"Job Title: {lead.title}")
    if lead.email: parts.append(f"Email: {lead.email}")
    if lead.company: parts.append(f"Company: {lead.company}")
    if lead.industry: parts.append(f"Industry: {lead.industry}")
    if lead.website: parts.append(f"Website: {lead.website}")
    loc = ", ".join(filter(None, [lead.city, lead.state, lead.country]))
    if loc: parts.append(f"Location: {loc}")
    if lead.employee_count: parts.append(f"Employee Count: {lead.employee_count}")
    if lead.annual_revenue: parts.append(f"Annual Revenue: {lead.annual_revenue}")
    ctx = "\n".join(parts) if parts else "No lead data available"
    return f"""You are an expert SDR researcher. Given this lead info, generate a research brief. Return ONLY valid JSON:

Lead Information:
{ctx}

{{
  "research_company": "One sentence about what this company does",
  "research_industry": "Pick ONE: SaaS, Healthcare, Finance, Retail, Manufacturing, Real Estate, Education, Other",
  "research_company_size": "Pick ONE: 1–50, 51–200, 201–1000, 1000+",
  "research_services": "Key products/services (under 100 chars)",
  "research_geo": "Geographic regions they serve",
  "research_timezone": "Pick ONE: IST, EST, PST, GMT, CST, AEST, Other",
  "research_hook": "Personalized cold call opening line",
  "research_hypothesis": "2-3 sentences: Why this contact would benefit from our solution",
  "research_personalization": "One specific observation showing research",
  "research_contact": "Role context and decision-making influence",
  "research_channels": "Comma-separated from: Website Chat, WhatsApp, Social Media, Phone/Calling, In-Person, Email, Chatbot"
}}

IMPORTANT: Return ONLY the JSON object."""


async def _call_groq(prompt, api_key, model):
    import httpx
    if not api_key:
        raise HTTPException(status_code=500, detail="AI API key not configured.")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(GROQ_URL, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, json={"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "max_tokens": 800})
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI service timed out.")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Could not connect to AI service.")
    if resp.status_code == 401: raise HTTPException(status_code=502, detail="Invalid API key.")
    if resp.status_code == 429: raise HTTPException(status_code=429, detail="AI rate limit reached.")
    if resp.status_code != 200: raise HTTPException(status_code=502, detail=f"AI error: {resp.status_code}")
    content = resp.json()["choices"][0]["message"]["content"].strip()
    if content.startswith("```"): content = content.split("\n", 1)[1] if "\n" in content else content[3:]
    if content.endswith("```"): content = content[:-3]
    try: return json.loads(content.strip())
    except json.JSONDecodeError: raise HTTPException(status_code=502, detail="AI returned invalid format.")


def _sanitize(result):
    s = {k: str(result.get(k, "")).strip()[:500] for k in ["research_company", "research_services", "research_geo", "research_hook", "research_hypothesis", "research_personalization", "research_contact"]}
    s["research_industry"] = result.get("research_industry", "Other") if result.get("research_industry") in VALID_INDUSTRIES else "Other"
    s["research_company_size"] = result.get("research_company_size", "") if result.get("research_company_size") in VALID_SIZES else ""
    s["research_timezone"] = result.get("research_timezone", "Other") if result.get("research_timezone") in VALID_TIMEZONES else "Other"
    ch = result.get("research_channels", "")
    if isinstance(ch, list): ch = ", ".join(ch)
    valid = [c.strip() for c in ch.split(",") if c.strip() in VALID_CHANNELS]
    s["research_channels"] = ", ".join(valid) if valid else "Email, Phone/Calling"
    return s


@router.post("/{lead_id}/ai-research")
async def ai_research_lead(lead_id: str, user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead: raise HTTPException(status_code=404, detail="Lead not found")
    company_name = (lead.company or "").strip().lower()

    if company_name:
        try:
            cached = db.query(CompanyResearch).filter(CompanyResearch.company_name == company_name).first()
        except Exception: cached = None
        if cached:
            return {k: getattr(cached, k, "") for k in ["research_company", "research_industry", "research_company_size", "research_services", "research_geo", "research_timezone", "research_hook", "research_hypothesis", "research_personalization", "research_contact", "research_channels"]} | {"from_cache": True}

    cfg = _get_llm_config(db)
    raw = await _call_groq(_build_prompt(lead), cfg["api_key"], cfg["model"])
    sanitized = _sanitize(raw)

    if company_name:
        try:
            db.add(CompanyResearch(company_name=company_name, raw_ai_response=json.dumps(raw), **sanitized))
            db.commit()
        except IntegrityError: db.rollback()
        except Exception: db.rollback()

    return {**sanitized, "from_cache": False}

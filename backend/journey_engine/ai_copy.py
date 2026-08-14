# ── journey_engine/ai_copy.py ─────────────────────────────────────────────────
"""
AI-generated cadence email copy — reuses the same Groq config/model
resolution the Smart Analytics NL-query feature already uses
(services/smart_analytics.py's _get_llm_config/_resolve_groq_model), rather
than adding a second AI provider/config surface. Deliberately a simpler call
than smart_analytics.parse_nl_to_dsl's: this is a one-shot, user-initiated
"generate a draft" action (the user can just click again on a transient
failure), not an interactive query path — so it skips that function's
automatic TPM-retry-with-sleep and 400-auto-model-discovery-and-retry
sophistication rather than duplicating it.
"""
import json
import logging
import re

import httpx

from services.smart_analytics import _get_llm_config, _resolve_groq_model

logger = logging.getLogger(__name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

_SYSTEM_PROMPT = """You are writing one email for a B2B sales outreach cadence (a Sales Journey step in a CRM).
Output ONLY valid JSON: {"subject": string, "body": string}. No prose, no markdown fences.

Rules:
- Write in plain text (no HTML), professional but conversational, under 150 words in the body.
- Personalize using these exact merge-field placeholders where a specific detail would go — never invent
  a name, company, or title: {{first_name}}, {{last_name}}, {{company}}, {{title}}, {{email}}, {{phone}}.
- No generic filler like "I hope this email finds you well."
- Sign off with just a comma and newline (e.g. "Best,\\n") — never invent a sender name."""


class AICopyError(Exception):
    def __init__(self, message: str, code: str = "ai_copy_error"):
        super().__init__(message)
        self.message = message
        self.code = code


def generate_email_copy(db, prompt: str) -> dict:
    """Args: db, prompt (a short brief, e.g. "Follow-up after a demo no-show").
    Returns {"subject": str, "body": str}."""
    cfg = _get_llm_config(db)
    if not cfg.get("api_key"):
        raise AICopyError(
            "AI email generation requires a Groq API key. Add one in Settings → AI/LLM.",
            code="llm_not_configured",
        )
    api_key = cfg["api_key"]
    model = cfg.get("model") or _resolve_groq_model(api_key, db)

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 400,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        resp = httpx.post(_GROQ_URL, headers=headers, json=payload, timeout=20.0)
    except httpx.TimeoutException:
        raise AICopyError("AI generation timed out. Please try again.", code="llm_timeout")
    except Exception as exc:
        logger.warning("ai_copy: Groq call failed: %s", exc)
        raise AICopyError("Could not reach the AI service.", code="llm_error")

    if resp.status_code != 200:
        logger.warning("ai_copy: Groq %s: %s", resp.status_code, resp.text[:200])
        raise AICopyError("AI service error. Please try again.", code="llm_error")

    raw = resp.json()["choices"][0]["message"]["content"].strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("ai_copy: non-JSON LLM output: %r", raw[:200])
        raise AICopyError("Couldn't parse the AI response. Please try again.", code="invalid_llm_response")

    if not isinstance(result, dict) or not result.get("subject") or not result.get("body"):
        raise AICopyError("Unexpected AI response. Please try again.", code="invalid_llm_response")

    return {"subject": str(result["subject"]), "body": str(result["body"])}

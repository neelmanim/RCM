# ── journey_engine/merge_fields.py ───────────────────────────────────────────
"""
Shared {{field}} substitution for every outreach channel (email, sms, ...).
Mirrors frontend-react/.../sales-journey/nodeDefaults.js EMAIL_MERGE_FIELDS —
keep both lists in sync.
"""
import re

_MERGE_FIELD_PATTERN = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def apply_merge_fields(text: str, lead) -> str:
    """Unmatched fields render blank rather than the literal placeholder —
    a recipient seeing a literal "{{last_name}}" is worse than a missing word."""
    if not text:
        return text
    fields = {
        "first_name": lead.first_name or "",
        "last_name": lead.last_name or "",
        "company": lead.company or "",
        "title": lead.title or "",
        "email": lead.email or "",
        "phone": lead.phone or "",
    }
    return _MERGE_FIELD_PATTERN.sub(lambda m: fields.get(m.group(1), ""), text)

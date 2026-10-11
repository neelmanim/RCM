# ── journey_engine/merge_fields.py ───────────────────────────────────────────
"""
Shared {{field}} substitution for every outreach channel (email, sms, ...).
Mirrors frontend-react/.../sales-journey/nodeDefaults.js EMAIL_MERGE_FIELDS —
keep both lists in sync.
"""
import re

_MERGE_FIELD_PATTERN = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def apply_merge_fields(text: str, lead, escape_html: bool = False, sender=None) -> str:
    """Unmatched fields render blank rather than the literal placeholder —
    a recipient seeing a literal "{{last_name}}" is worse than a missing word.

    escape_html: set it when `text` is real HTML (an Email Campaign body) so a
    lead value carrying markup characters — company "Smith & Sons <Ltd>" — is
    escaped into the document instead of breaking it. Leave it False for plain
    text (cadence email/sms/whatsapp bodies), where escaping would mail a
    literal "&amp;" to the recipient."""
    if not text:
        return text
    rep = lead.assigned_users[0] if getattr(lead, "assigned_users", None) else None
    fields = {
        "first_name": lead.first_name or "",
        "last_name": lead.last_name or "",
        "company": lead.company or "",
        "title": lead.title or "",
        "email": lead.email or "",
        "phone": lead.phone or "",
        # v13.0.0 — research-led cadences: the AI research the lead already
        # carries (Pre-Call Intelligence), and who the message is from.
        "research_hook": getattr(lead, "research_hook", None) or "",
        "research_opening": getattr(lead, "research_opening", None) or "",
        "rep_name": (rep.name if rep else "") or "",
        # sender: the user whose mailbox/number actually sends — the assigned
        # SDR, or the cadence owner as fallback (channels.base.sender_candidates).
        "sender_name": (sender.name if sender else (rep.name if rep else "")) or "",
    }
    if escape_html:
        import html as html_mod
        return _MERGE_FIELD_PATTERN.sub(lambda m: html_mod.escape(fields.get(m.group(1), "")), text)
    return _MERGE_FIELD_PATTERN.sub(lambda m: fields.get(m.group(1), ""), text)

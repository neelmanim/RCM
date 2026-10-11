"""Permanent audit trail (models.AuditEvent): who exported data, who changed export access, who edited Salesforce field mappings.

record() adds the row to the CALLER'S session, so for a settings change it commits or rolls back together with the change itself.
Exports commit it straight away (record_now) and refuse the export if the record cannot be written - no record, no download.
"""
import json
from datetime import datetime, timezone

import models

EXPORT_LABELS = {
    "/api/admin/leads/export": "Leads export", "/api/admin/analytics/export": "Analytics export",
    "/api/admin/activity.xlsx": "Raw activity (Excel)", "/api/my-day/export": "My Day CSV", "/api/admin/sf-logs/export": "Salesforce log CSV",
    "/api/admin/analytics/daily-digest/export.xlsx": "Team Digest (Excel)", "/api/admin/analytics/daily-digest/drilldown.xlsx": "Team Digest drill-down (Excel)", "/api/admin/analytics/sales-funnel/export.xlsx": "Sales Funnel (Excel)",
    "/api/metrics/export": "SDR metrics export",
}


def export_label(path):
    base = (path or "").split("?")[0]
    if base in EXPORT_LABELS:
        return EXPORT_LABELS[base]
    if base.endswith("/enrollments/export"):
        return "Cadence roster CSV"
    return base or "Export"


def record(db, actor, category, action, summary, detail=None):
    db.add(models.AuditEvent(
        created_at=datetime.now(timezone.utc),       # set here (microseconds) so events keep their true order
        actor_id=(actor or {}).get("sub"), actor_email=(actor or {}).get("email"), actor_name=(actor or {}).get("name"),
        actor_role=(actor or {}).get("role"), category=category, action=action, summary=summary[:300],
        detail_json=json.dumps(detail) if detail else None))


def record_now(db, actor, category, action, summary, detail=None):
    record(db, actor, category, action, summary, detail)
    db.commit()


def row(e):
    return {"id": e.id, "at": e.created_at.isoformat() if e.created_at else None, "actor_name": e.actor_name, "actor_email": e.actor_email,
            "actor_role": e.actor_role, "category": e.category, "action": e.action, "summary": e.summary,
            "detail": json.loads(e.detail_json) if e.detail_json else {}}

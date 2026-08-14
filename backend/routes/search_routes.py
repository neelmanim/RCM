# ── routes/search_routes.py — Global search ────────────────────────────────────
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

import models
from database import get_db
from auth import get_current_user
from routes.lead_helpers import _lead_to_dict

router = APIRouter(prefix="/api", tags=["Search"])


@router.get("/search")
def global_search(
    q: str = Query(...),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search leads and users. Admins see everything, SDRs see only their leads.

    Supports full-name search: 'Melanie Pratt' matches even though first_name
    and last_name are stored in separate columns.

    Requires minimum 2 characters — single-char queries return empty results
    to prevent expensive full-table scans on large lead sets.
    """
    # Backend enforcement: mirror the frontend 2-char minimum
    if not q or len(q.strip()) < 2:
        return {"leads": [], "users": []}
    q_filter = f"%{q}%"
    role = user.get("role")
    is_admin = role in ("Super Admin", "Pod Admin")

    # Full-name concat expression: "first_name || ' ' || last_name"
    full_name_expr = func.concat(
        func.coalesce(models.Lead.first_name, ''),
        ' ',
        func.coalesce(models.Lead.last_name, '')
    )

    def _lead_name_filter():
        return (
            models.Lead.first_name.ilike(q_filter) |
            models.Lead.last_name.ilike(q_filter) |
            full_name_expr.ilike(q_filter) |
            # Also try reversed order: "Pratt Melanie" → last first
            func.concat(
                func.coalesce(models.Lead.last_name, ''),
                ' ',
                func.coalesce(models.Lead.first_name, '')
            ).ilike(q_filter) |
            models.Lead.email.ilike(q_filter) |
            models.Lead.company.ilike(q_filter) |
            models.Lead.phone.ilike(q_filter) |
            models.Lead.phone_secondary.ilike(q_filter) |
            models.Lead.company_phone.ilike(q_filter)
        )

    if is_admin:
        leads_q = db.query(models.Lead).filter(
            _lead_name_filter()
        ).limit(10).all()
        users_q = db.query(models.User).filter(
            (models.User.name.ilike(q_filter)) |
            (models.User.email.ilike(q_filter))
        ).limit(5).all()
        user_results = [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in users_q]
    else:
        user_id = user.get("sub")
        assigned_lead_ids = db.query(models.lead_assignments.c.lead_id).filter(
            models.lead_assignments.c.user_id == user_id
        ).scalar_subquery()
        leads_q = db.query(models.Lead).filter(
            models.Lead.id.in_(assigned_lead_ids),
            _lead_name_filter()
        ).limit(10).all()
        user_results = []

    return {
        "leads": [_lead_to_dict(l) for l in leads_q],
        "users": user_results
    }

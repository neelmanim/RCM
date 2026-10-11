# ── routes/search_routes.py — Global search ────────────────────────────────────
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

import access_db
import models
from database import get_db
from auth import get_current_user
from sqlalchemy.orm import load_only
from routes.lead_helpers import lead_search_clause

router = APIRouter(prefix="/api", tags=["Search"])

# The dropdown shows name, company, email and phone — nothing else. The old code built the full lead-detail payload
# (research, lifecycle, links…) for every hit on every keystroke, and loaded every column of every row.
_HIT_COLS = (models.Lead.id, models.Lead.first_name, models.Lead.last_name, models.Lead.company, models.Lead.email, models.Lead.phone,
             models.Lead.phone_secondary, models.Lead.company_phone)


def _hit(lead):
    return {"id": lead.id, "first_name": lead.first_name, "last_name": lead.last_name,
            "company": lead.company, "email": lead.email, "phone": lead.phone,
            "phone_secondary": lead.phone_secondary, "company_phone": lead.company_phone}


@router.get("/search")
def global_search(
    q: str = Query(...),
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search leads, users, and accounts. Admins see everything, SDR/AE see
    only their own leads, CSM sees only their own assigned accounts.

    Supports full-name search: 'Melanie Pratt' matches even though first_name
    and last_name are stored in separate columns.

    Requires minimum 2 characters — single-char queries return empty results
    to prevent expensive full-table scans on large lead sets.
    """
    # Backend enforcement: mirror the frontend 2-char minimum
    if not q or len(q.strip()) < 2:
        return {"leads": [], "users": [], "accounts": []}
    q_filter = f"%{q}%"
    role = user.get("role")
    is_admin = role in ("Super Admin", "Pod Admin")

    def _lead_name_filter():
        return lead_search_clause(q.strip(), phone_cols=(models.Lead.phone, models.Lead.phone_secondary, models.Lead.company_phone))

    if is_admin:
        # v13.12.1: a Pod Admin searches their own pod only (leads the Leads list shows them, their pod's people and
        # CSM accounts) — it used to search the whole org, including every user's name, email and role.
        pod_scoped = role == "Pod Admin"
        pod = access_db.pod_of(user)
        if pod_scoped:
            from routes.lead_helpers import _build_lead_query
            leads_q = _build_lead_query(db, user).filter(_lead_name_filter()).options(load_only(*_HIT_COLS)).limit(10).all()
        else:
            leads_q = db.query(models.Lead).filter(_lead_name_filter()).options(load_only(*_HIT_COLS)).limit(10).all()
        users_base = db.query(models.User).filter(
            (models.User.name.ilike(q_filter)) |
            (models.User.email.ilike(q_filter))
        )
        if pod_scoped:
            users_base = users_base.filter(models.User.pod_id == pod)
        users_q = users_base.limit(5).all()
        user_results = [{"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in users_q]
        accounts_base = db.query(models.Account).filter(models.Account.name.ilike(q_filter))
        if pod_scoped:
            accounts_base = accounts_base.filter(models.Account.assigned_csm_id.in_(
                db.query(models.User.id).filter(models.User.pod_id == pod)))
        accounts_q = accounts_base.limit(10).all()
    else:
        user_id = user.get("sub")
        assigned_lead_ids = db.query(models.lead_assignments.c.lead_id).filter(
            models.lead_assignments.c.user_id == user_id
        ).scalar_subquery()
        leads_q = db.query(models.Lead).filter(
            models.Lead.id.in_(assigned_lead_ids),
            _lead_name_filter()
        ).options(load_only(*_HIT_COLS)).limit(10).all()
        user_results = []
        # Only a CSM has an "assigned accounts" scope — SDR/AE have none,
        # same as they have no assigned-users scope above.
        accounts_q = db.query(models.Account).filter(
            models.Account.assigned_csm_id == user_id,
            models.Account.name.ilike(q_filter),
        ).limit(10).all() if role == "CSM" else []

    return {
        "leads": [_hit(l) for l in leads_q],
        "users": user_results,
        "accounts": [{"id": a.id, "name": a.name, "industry": a.industry} for a in accounts_q],
    }

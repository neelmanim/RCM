"""Which leads an actor may see. One rule, one implementation.

Moved verbatim (behaviour-for-behaviour) out of `routes/lead_helpers.py`,
where it sat in the transport layer and had to be imported *back out* of
`routes/` by every non-HTTP caller. The query logic below is unchanged — only
its address and its input type are.

Why this one first: it is the single most security-sensitive rule in the
product. Every list, count, export, analytics aggregate and CSV download is
only correct because it starts from this query. `routes/lead_helpers.py` is
1,023 lines of mixed serialisation, formatting, batching and caching helpers,
and this rule was buried at line 813 of it.
"""
import models
from .actor import Actor


def visible_leads(db, actor: Actor, global_view: bool = False):
    """Base query over the leads `actor` is allowed to see.

    global_view=True (Pod Admin only): bypass pod scoping and return all
    leads. This powers the Pod/Global toggle pill in the UI.

    Soft-deleted leads (Lead.deleted_at set) are excluded for every role at
    the single return point — see
    routes/admin_assignment_routes.py::bulk_delete_leads().
    """
    if actor.is_super_admin:
        return models.exclude_deleted_leads(db.query(models.Lead))

    if actor.is_pod_admin:
        if global_view:
            return models.exclude_deleted_leads(db.query(models.Lead))
        return models.exclude_deleted_leads(_pod_scoped(db, actor.pod_id))

    # SDR / AE: only their assigned leads. A direct JOIN on lead_assignments
    # lets PostgreSQL use idx_lead_assignments_user_id, where the older
    # double-subquery form (IN (SELECT id FROM (SELECT lead_id...))) defeated
    # the planner.
    return models.exclude_deleted_leads(
        db.query(models.Lead).join(
            models.lead_assignments,
            (models.lead_assignments.c.lead_id == models.Lead.id)
            & (models.lead_assignments.c.user_id == actor.id),
        )
    )


def _pod_scoped(db, pod_id):
    """A Pod Admin's two-branch visibility, as a subquery.

    Branch 1 — leads assigned to ANY user in this pod. Goes through
    lead_assignments rather than Lead.pod_id, because in AE pods a lead's
    pod_id still points at the originating SDR pod.

    Branch 2 — pod-tagged leads with no assignment yet (the round-robin pool),
    which the Pod Admin manages ahead of assignment.
    """
    if not pod_id:
        # Pod Admin with no pod_id on the token: a data error. Show nothing
        # rather than falling through to something wider.
        return db.query(models.Lead).filter(models.Lead.id == None)  # noqa: E711

    pod_user_ids = (
        db.query(models.User.id).filter(models.User.pod_id == pod_id).subquery()
    )
    assigned_lead_ids = db.query(models.lead_assignments.c.lead_id).filter(
        models.lead_assignments.c.user_id.in_(pod_user_ids)
    )
    any_assigned_ids = db.query(models.lead_assignments.c.lead_id)
    unassigned_pod_lead_ids = db.query(models.Lead.id).filter(
        models.Lead.pod_id == pod_id,
        ~models.Lead.id.in_(any_assigned_ids),
    )
    visible_ids = assigned_lead_ids.union(unassigned_pod_lead_ids).subquery()
    return db.query(models.Lead).filter(models.Lead.id.in_(visible_ids))


# ── Per-lead rules ───────────────────────────────────────────────────────────
# visible_leads() answers "which leads may I list"; these answer "may I open /
# change THIS lead". RCA 2026-09-29: only the list rule existed, so every
# per-lead endpoint that forgot its own check (emails, calls, notes, lead
# detail…) served any lead to any logged-in user. Routes reach these through
# routes/lead_helpers.load_lead(); nothing else should re-implement them.

def can_view_lead(actor: Actor, lead) -> bool:
    """Super Admin: any lead. Pod Admin: any lead, read-only outside their pod
    (user decision 2026-09-29 — matches the Pod/Global toggle on the lists).
    SDR / AE / CSM / unknown role: only leads assigned to them.
    Soft-deleted leads: Super Admin only."""
    if actor.is_super_admin:
        return True
    if lead.deleted_at is not None:
        return False
    if actor.is_pod_admin:
        return True
    return any(u.id == actor.id for u in lead.assigned_users)


def can_edit_lead(actor: Actor, lead) -> bool:
    """Moved verbatim from routes/lead_helpers._can_modify_lead (behaviour
    unchanged): Super Admin any; Pod Admin an unassigned lead or one assigned
    to someone in their pod; everyone else only their assigned leads."""
    if actor.is_super_admin:
        return True
    if actor.is_pod_admin:
        if not lead.assigned_users:
            return True
        return bool(actor.pod_id) and any(u.pod_id == actor.pod_id for u in lead.assigned_users)
    return any(u.id == actor.id for u in lead.assigned_users)


def visible_lead_ids(db, actor: Actor, lead_ids) -> set:
    """The subset of `lead_ids` that can_view_lead() would allow, in one
    query — for feeds/aggregates that list many leads' rows at once."""
    ids = {i for i in lead_ids if i}
    if not ids or actor.is_super_admin:
        return ids
    q = models.exclude_deleted_leads(db.query(models.Lead.id).filter(models.Lead.id.in_(ids)))
    if not actor.is_pod_admin:
        q = q.join(
            models.lead_assignments,
            (models.lead_assignments.c.lead_id == models.Lead.id)
            & (models.lead_assignments.c.user_id == actor.id),
        )
    return {r[0] for r in q.all()}

"""Build-time guard for the 2026-09-29 access-control fix.

The hole was structural: a route was public unless its author remembered
Depends(get_current_user), and a lead was readable unless its author
remembered a per-lead check. These two tests make forgetting fail the build.
"""
import inspect
import re

from fastapi.routing import APIRoute

import main
from auth import require_super_admin

_ROUTES = [r for r in main.app.routes if isinstance(r, APIRoute)]


def _key(route):
    return f"{','.join(sorted(route.methods))} {route.path}"


def test_every_route_declares_auth_or_a_public_marker():
    """enforce_auth_by_default() still protects an unmarked route at runtime,
    but relying on it means someone forgot — declare get_current_user /
    a require_* dependency, or public_endpoint / authenticates_itself."""
    assert main.app.state.auth_gated_routes == [], (
        "Routes with no auth declared: " + ", ".join(main.app.state.auth_gated_routes)
    )


_LEAD_SCOPED = re.compile(r"\{(lead_id|call_id|note_id|task_id|attachment_id|enrollment_id)\}")
_GUARDS = ("load_lead(", "authorize_lead(", "_can_modify_lead(", "_authorize_dialer_call(",
           "lead_allowed(", "_authorize_conversation_access(", "_require_journey_owner(")

# Lead-scoped routes that legitimately don't go through the per-lead check.
# Every entry needs a reason; adding one is a review conversation.
_EXEMPT = {
    "POST /api/dialer/queue-status/{lead_id}": "writes only the caller's own queue row",
    "DELETE /api/dialer/queue-status/{lead_id}": "deletes only the caller's own queue row",
    "PATCH /api/my/tasks/{task_id}/snooze": "filtered to the caller's own tasks (Task.user_id == sub)",
    "PATCH /api/my/tasks/{task_id}/dismiss": "filtered to the caller's own tasks (Task.user_id == sub)",
    "GET /api/email/attachment/{attachment_id}/download": "fetched through the caller's own Nylas grant",
    "GET /api/public/leads/{lead_id}/calls": "public API: require_api_key (service actor)",
    "DELETE /api/admin/assignments/{user_id}/{lead_id}": "require_admin + own-pod check on the unassigned user",
}


def _super_admin_only(route):
    def walk(d):
        return any(x.call is require_super_admin or walk(x) for x in d.dependencies)
    return walk(route.dependant)


def test_every_lead_scoped_route_reaches_the_lead_access_check():
    missing = []
    for r in _ROUTES:
        if not _LEAD_SCOPED.search(r.path) or _key(r) in _EXEMPT or _super_admin_only(r):
            continue
        if not any(g in inspect.getsource(r.endpoint) for g in _GUARDS):
            missing.append(_key(r))
    assert not missing, "Lead-scoped routes with no per-lead access check: " + ", ".join(missing)

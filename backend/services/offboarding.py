"""Offboarding — one action that really removes a person's access, instead of a delete that fails or half-works.

What it does (and why each step): sign-in revoked (allowed_users), dialer / SMS / WhatsApp / email-sync switched off
(they used to stay on, so the person kept showing in the Calling & Messaging settings), mailbox marked disconnected,
Pod-Admin seats removed, portfolio released with an ownership reason ('user-access-removed' in lead_ownership_periods),
`users.left_at` stamped. The user ROW stays: call logs, bookings and ownership history point at it, and reports need
to show the person as Left rather than lose them.

"Left" = left_at is set OR the email is no longer on the sign-in list (people removed by the old CSV path never got a
left_at). Reactivating (adding the email back) clears left_at.
"""
from datetime import datetime, timezone

import access_db
import models
import ownership_history as oh


def left_ids(db, users=None):
    """ids of the people who have left. Pass `users` (iterable of User) to limit the work."""
    allowed = {(r[0] or "").strip().lower() for r in db.query(models.AllowedUser.email).all()}
    pool = users if users is not None else db.query(models.User).all()
    return {u.id for u in pool if u.left_at is not None or (u.email or "").strip().lower() not in allowed}


def offboard(db, user, actor_id):
    """Release everything. Caller commits nothing before; this commits once at the end (the ownership trigger needs
    the context set in the same transaction as the portfolio change)."""
    oh.set_assignment_context(db, oh.R_USER_REMOVED, actor_id)
    user.assigned_leads = []
    for flag in ("dialer_enabled", "sms_enabled", "whatsapp_enabled", "email_sync_enabled", "export_enabled"):
        setattr(user, flag, False)
    for mb in db.query(models.UserMailbox).filter(models.UserMailbox.user_id == user.id):
        mb.status = "disconnected"
    db.query(models.PodAdmin).filter(models.PodAdmin.user_id == user.id).delete()
    user.left_at = datetime.now(timezone.utc)
    db.flush()
    access_db.remove_allowed_user(db, user.email)    # commits and drops the identity cache
    db.commit()


def reactivate(db, user):
    user.left_at = None
    db.commit()

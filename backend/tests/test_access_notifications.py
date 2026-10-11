"""Tests for the Phase 1.5 access-granted email notification wired into
PATCH /api/admin/users/{id}/settings (admin_user_routes.py). Confirms it
fires exactly once, batched, on a real off->on transition, and not at all
on a no-op re-save or a revoke — see
.claude/plans/i-was-working-on-idempotent-ritchie.md ("Phase 1.5")."""
import sys, os
from unittest.mock import patch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_user_mailbox
import access_notifications


class TestAccessGrantedNotification:

    def test_fires_once_on_a_real_grant(self, client, db):
        user = create_test_user(db, email="grantee@test.com", role="SDR")
        with patch("access_notifications.send_report_email", return_value=True) as mock_send:
            resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
                "sms_enabled": True, "whatsapp_enabled": True,
            })
        assert resp.status_code == 200
        assert mock_send.call_count == 1
        args, _ = mock_send.call_args
        # (db, admin_user_id, [target_email], html_body, subject)
        assert args[2] == ["grantee@test.com"]
        assert "SMS messaging" in args[3]
        assert "WhatsApp messaging" in args[3]

    def test_does_not_fire_on_a_no_op_resave(self, client, db):
        user = create_test_user(db, email="already@test.com", role="SDR")
        user.sms_enabled = True
        db.commit()
        with patch("access_notifications.send_report_email", return_value=True) as mock_send:
            resp = client.patch(f"/api/admin/users/{user.id}/settings", json={"sms_enabled": True})
        assert resp.status_code == 200
        mock_send.assert_not_called()

    def test_does_not_fire_on_a_revoke(self, client, db):
        user = create_test_user(db, email="revoked@test.com", role="SDR")
        user.whatsapp_enabled = True
        db.commit()
        with patch("access_notifications.send_report_email", return_value=True) as mock_send:
            resp = client.patch(f"/api/admin/users/{user.id}/settings", json={"whatsapp_enabled": False})
        assert resp.status_code == 200
        mock_send.assert_not_called()

    def test_fires_when_a_messenger_agent_id_is_first_assigned(self, client, db):
        user = create_test_user(db, email="agent@test.com", role="SDR")
        with patch("access_notifications.send_report_email", return_value=True) as mock_send:
            # No global messenger_api_key configured in this test DB, so the
            # live-validation branch is skipped and the ID is stored as-is —
            # same path admin_user_routes.py logs a warning for.
            resp = client.patch(f"/api/admin/users/{user.id}/settings", json={
                "messenger_user_id": "359999",
            })
        assert resp.status_code == 200
        mock_send.assert_called_once()
        args, _ = mock_send.call_args
        assert "Alternate Messenger agent access" in args[3]


class TestAccessGrantedNotificationResilience:
    """RCA 2026-09-03 (pre-prod review): the notification used to run inline and
    unguarded after the endpoint's own db.commit(). send_report_email POSTs to
    Nylas with a 30s timeout and no try/except, so on prod this would have added
    up to 30s to every grant and turned any Nylas connection error into a 500
    handed to the admin *after* the change was already saved — they'd see
    failure, retry, and send the user a second email."""

    def test_a_nylas_failure_does_not_fail_the_grant(self, client, db):
        import models
        user = create_test_user(db, email="nylas-down@test.com", role="SDR")
        with patch("access_notifications.send_report_email",
                   side_effect=Exception("Nylas connection reset")):
            resp = client.patch(f"/api/admin/users/{user.id}/settings",
                                json={"dialer_enabled": True})
        assert resp.status_code == 200, (
            "A failed notification must never fail the operation it describes"
        )
        db.expire_all()
        refreshed = db.query(models.User).filter(models.User.id == user.id).first()
        assert refreshed.dialer_enabled is True, "the grant itself must still be committed"

    def test_wrapper_never_raises_and_uses_its_own_session(self, db):
        """The background wrapper must be safe to hand to BackgroundTasks: it
        opens its own session (the request's is gone by then) and swallows."""
        import access_notifications as an
        user = create_test_user(db, email="own-session@test.com", role="SDR")

        seen = {}
        def _capture(_db, admin_id, target, keys):
            seen["db_is_request_db"] = (_db is db)
            seen["target"] = target.email
            return True

        with patch.object(an, "notify_access_granted", _capture):
            an.notify_access_granted_in_background("admin-1", user.id, ["dialer_enabled"])
        assert seen["target"] == "own-session@test.com"
        assert seen["db_is_request_db"] is False, "must not reuse the request session"

        # And an exploding send is contained.
        with patch.object(an, "notify_access_granted", side_effect=Exception("boom")):
            an.notify_access_granted_in_background("admin-1", user.id, ["dialer_enabled"])

    def test_no_capabilities_sends_nothing(self, db):
        import access_notifications as an
        with patch.object(an, "notify_access_granted") as inner:
            an.notify_access_granted_in_background("admin-1", "whatever", [])
        inner.assert_not_called()


class TestNewAccessRequestNotification:
    """A Google sign-in from an unrecognized email — see models.AccessRequest
    and auth_routes._record_access_request, which calls this."""

    def test_no_super_admin_mailbox_returns_false_without_sending(self, db):
        create_test_user(db, email="super@test.com", role="Super Admin")  # no connected mailbox
        with patch("access_notifications.send_report_email") as mock_send:
            result = access_notifications.notify_new_access_request(db, "hopeful@test.com", "Hopeful Person")
        assert result is False
        mock_send.assert_not_called()

    def test_relays_through_first_super_admin_with_connected_mailbox(self, db):
        # RCA 2026-09-22: this used to CC every Super Admin — noisy, no one
        # in particular owned acting on it. Now goes to just the one Super
        # Admin whose connected mailbox relays it (sender == sole recipient).
        sender = create_test_user(db, email="sender-admin@test.com", role="Super Admin")
        create_user_mailbox(db, sender.id, email_address="sender-admin@test.com")
        create_test_user(db, email="other-admin@test.com", role="Super Admin")

        with patch("access_notifications.send_report_email", return_value=True) as mock_send:
            result = access_notifications.notify_new_access_request(db, "hopeful@test.com", "Hopeful Person")

        assert result is True
        args, _ = mock_send.call_args
        # (db, sender_user_id, [recipient emails], html_body, subject)
        assert args[1] == sender.id
        assert args[2] == ["sender-admin@test.com"]
        assert "hopeful@test.com" in args[3]

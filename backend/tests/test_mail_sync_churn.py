"""Staging OOM RCA (2026-10-06): the 5-minute mail sync must not re-download
and re-sanitize mail it already has on every tick — without missing mail."""
import os
import time
from unittest.mock import MagicMock, patch

os.environ.setdefault("APP_ENCRYPTION_KEY", "i20TaxOv9caS/T1LqOGzzaViYHWswZGvRwoTZVs1gSQ=")

import models
from crypto import encrypt_token
from conftest import create_test_lead, create_test_user, create_user_mailbox


def _setup(db, stored_body):
    lead = create_test_lead(db, email="lead@example.com")
    create_test_user(db, email="rep@test.com", id="rep-1")
    create_user_mailbox(db, "rep-1", email_address="rep@test.com")
    db.add(models.NylasConfig(id=1, client_id="c", api_key_encrypted=encrypt_token("k"),
                              redirect_uri="http://x", is_active=True))
    db.add(models.EmailThread(nylas_thread_id="t-1", lead_id=lead.id))
    db.add(models.LeadEmailActivity(lead_id=lead.id, user_id="rep-1", direction="outbound", subject="Hi",
                                    body_preview=stored_body, nylas_message_id="m-1", nylas_thread_id="t-1"))
    db.commit()
    return lead


def _nylas(body, msg_id="m-1", sender="rep@test.com", to="lead@example.com"):
    resp = MagicMock(status_code=200)
    resp.json.return_value = {"data": [{"id": msg_id, "from": [{"email": sender}], "to": [{"email": to}],
                                        "subject": "Hi", "body": body, "thread_id": "t-1",
                                        "date": int(time.time()), "attachments": []}] if body else []}
    return resp


def test_a_full_stored_body_is_not_sanitized_again(db):
    from routes.email_routes import _sync_thread_messages
    lead = _setup(db, stored_body="x" * 2000)   # stored in full by the current code
    with patch("routes.email_routes.httpx.get", return_value=_nylas("<p>" + "y" * 900 + "</p>")), \
            patch("routes.email_routes._sanitize_preview") as sanitize:
        _sync_thread_messages(lead.id, db)
    sanitize.assert_not_called()


def test_a_body_cut_at_the_old_500_limit_is_still_repaired(db):
    from routes.email_routes import _sync_thread_messages
    lead = _setup(db, stored_body="x" * 500)
    with patch("routes.email_routes.httpx.get", return_value=_nylas("<p>" + "y" * 900 + "</p>")):
        _sync_thread_messages(lead.id, db)
    db.commit()
    assert len(db.query(models.LeadEmailActivity).filter_by(nylas_message_id="m-1").one().body_preview) > 500


def test_a_colleague_reply_on_a_known_thread_is_still_picked_up(db):
    """The lead-address search can't see a colleague replying without the
    lead's address; only the thread pass after it does."""
    from routes.email_routes import _sync_full_mailbox
    lead = _setup(db, stored_body="x" * 2000)

    def get(url, params=None, **_):
        if "thread_id" in (params or {}):
            return _nylas("Looping in my CTO", msg_id="m-2", sender="cto@example.com", to="rep@test.com")
        return _nylas(None)   # the any_email search finds nothing new
    with patch("routes.email_routes.httpx.get", side_effect=get):
        _sync_full_mailbox(lead.id, db)
    db.commit()
    assert db.query(models.LeadEmailActivity).filter_by(nylas_message_id="m-2", direction="inbound").count() == 1

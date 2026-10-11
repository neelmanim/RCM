"""Role x endpoint matrix for the 2026-09-29 access-control fix.

Rule (domain/lead_access.py): Super Admin any lead; Pod Admin may VIEW any
lead but CHANGE only their pod's (or unassigned) leads; SDR/AE/CSM only
leads assigned to them. Refusals are 404 for "can't see" (never confirm
another user's lead exists) and 403 for "can see, can't change".
"""
import pytest

import models
from tests.conftest import create_test_lead, create_test_user, create_email_activity, grant_export


def _assign(db, lead, user_id, email, role="SDR", pod_id=None):
    u = db.query(models.User).filter(models.User.id == user_id).first() or \
        create_test_user(db, email=email, role=role)
    u.id, u.pod_id = user_id, pod_id
    db.commit()
    u.assigned_leads.append(lead)
    db.commit()
    return u


@pytest.fixture()
def leads(db):
    """mine: the SDR fixture's lead. other: another pod's SDR's lead."""
    mine = create_test_lead(db, email="mine@x.com", first_name="Mine")
    other = create_test_lead(db, email="other@x.com", first_name="Other")
    _assign(db, mine, "sdr-user-id", "sdr@test.com", pod_id="test-pod-id")
    _assign(db, other, "other-sdr-id", "other@test.com", pod_id="other-pod-id")
    db.add(models.Note(lead_id=other.id, content="private note", author="Other SDR"))
    create_email_activity(db, other.id, None, "outbound", subject="Pricing for Other")
    db.commit()
    return mine, other


# Every read of another rep's lead: 404, and the data never leaves.
_READS = [
    "/api/leads/{id}", "/api/leads/{id}/notes", "/api/leads/{id}/tasks",
    "/api/leads/{id}/calls", "/api/leads/{id}/attachments",
    "/api/leads/{id}/status-history", "/api/leads/{id}/field-history",
    "/api/email/lead/{id}/emails",
]


@pytest.mark.parametrize("path", _READS)
def test_sdr_cannot_read_another_reps_lead(client_as_sdr, leads, path):
    mine, other = leads
    assert client_as_sdr.get(path.format(id=mine.id)).status_code == 200
    r = client_as_sdr.get(path.format(id=other.id))
    assert r.status_code == 404
    assert "private note" not in r.text and "Pricing for Other" not in r.text


def test_sdr_cannot_write_to_another_reps_lead(client_as_sdr, leads):
    _, other = leads
    assert client_as_sdr.post(f"/api/leads/{other.id}/notes", json={"content": "x"}).status_code == 404
    assert client_as_sdr.post(f"/api/leads/{other.id}/tasks", json={"title": "x"}).status_code == 404
    r = client_as_sdr.post("/api/email/send", json={"lead_id": other.id, "subject": "s", "body": "b"})
    assert r.status_code == 404


def test_child_row_must_belong_to_the_lead_in_the_url(client_as_sdr, leads, db):
    """Own lead in the path + another lead's note id must not reach that note."""
    mine, other = leads
    note = db.query(models.Note).filter(models.Note.lead_id == other.id).first()
    assert client_as_sdr.delete(f"/api/leads/{mine.id}/notes/{note.id}").status_code == 404
    assert db.query(models.Note).filter(models.Note.id == note.id).first() is not None


def test_note_author_is_the_logged_in_user_not_the_request_body(client_as_sdr, leads):
    mine, _ = leads
    r = client_as_sdr.post(f"/api/leads/{mine.id}/notes", json={"content": "hi", "author": "The CEO"})
    assert r.status_code == 200 and r.json()["author"] == "SDR User"


def test_pod_admin_can_view_other_pods_lead_but_not_change_it(client_as_pod_admin, leads):
    """User decision 2026-09-29: view-only outside their pod."""
    _, other = leads
    assert client_as_pod_admin.get(f"/api/leads/{other.id}").status_code == 200
    assert client_as_pod_admin.get(f"/api/email/lead/{other.id}/emails").status_code == 200
    assert client_as_pod_admin.post(f"/api/leads/{other.id}/notes", json={"content": "x"}).status_code == 403


def test_super_admin_reaches_every_lead(client, leads):
    _, other = leads
    assert client.get(f"/api/leads/{other.id}/notes").status_code == 200


def test_monitor_mode_logs_but_does_not_refuse(client_as_sdr, leads, monkeypatch, caplog):
    """The rollout switch: SECURITY_LEAD_ACCESS_MODE=monitor lets the request
    through and records what would have been refused."""
    monkeypatch.setenv("SECURITY_LEAD_ACCESS_MODE", "monitor")
    _, other = leads
    assert client_as_sdr.get(f"/api/leads/{other.id}/notes").status_code == 200
    assert "action=would_refuse" in caplog.text and other.id in caplog.text


def test_activity_feed_shows_an_sdr_only_their_leads(client_as_sdr, leads, db):
    mine, other = leads
    for lead in (mine, other):
        db.add(models.LeadStatusLog(lead_id=lead.id, from_status="Lead Assigned", to_status="Calling", changed_by="x"))
    db.commit()
    ids = {row["lead_id"] for row in client_as_sdr.get("/api/leads/activity-feed").json()}
    assert mine.id in ids and other.id not in ids


def test_pod_admin_export_is_limited_to_their_pod(client_as_pod_admin, leads, db):
    """User decision 2026-09-29: Pod Admin bulk export = own pod only (and only once a Super Admin has switched export on)."""
    grant_export(db, "pod-admin-id", role="Pod Admin")
    r = client_as_pod_admin.get("/api/admin/leads/export?date_from=2000-01-01")
    assert r.status_code == 200
    assert "mine@x.com" in r.text and "other@x.com" not in r.text


# ── Webhooks: unverified senders are refused (enforce mode) ──────────────────

@pytest.fixture()
def enforce_webhooks(monkeypatch):
    monkeypatch.setenv("SECURITY_WEBHOOK_MODE", "enforce")


def test_aircall_webhook_without_token_is_refused(client, enforce_webhooks, monkeypatch):
    """RCA: a forged Aircall 'Meeting Set' tag could book a meeting."""
    import dialer_service
    monkeypatch.setattr(dialer_service, "get_dialer_config", lambda db: {"webhook_token": "s3cret"})
    called = []
    monkeypatch.setattr(dialer_service, "handle_webhook", lambda *a, **k: called.append(1) or {})
    body = {"event": "call.tagged", "data": {"id": 1}}
    assert client.post("/api/webhooks/aircall", json=body).status_code == 401
    assert client.post("/api/webhooks/aircall", json={**body, "token": "wrong"}).status_code == 401
    assert client.post("/api/webhooks/aircall", json={**body, "token": "s3cret"}).status_code == 200
    assert called == [1]


def test_nylas_webhook_without_signature_is_refused(client, enforce_webhooks):
    """Used to skip verification whenever the signature header was absent."""
    assert client.post("/webhooks/nylas", json={"type": "message.created"}).status_code == 401


def test_sms_webhook_without_configured_secret_is_refused(client, enforce_webhooks, monkeypatch):
    monkeypatch.delenv("MESSENGER_WEBHOOK_SECRET", raising=False)
    assert client.post("/api/webhooks/messenger-sms", json={}).status_code == 401


def test_dialer_config_never_returns_the_webhook_token(client, db):
    import dialer_service
    dialer_service.save_dialer_config(db, {"webhook_token": "s3cret"})
    assert client.get("/api/dialer/config").json()["webhook_token"] == "••••"
    assert dialer_service.get_dialer_config(db)["webhook_token"] == "s3cret"   # webhook check still sees it


def test_rollout_defaults_when_render_sets_nothing(monkeypatch):
    """Render never applied render.yaml's env values, so a service with no
    SECURITY_* vars must get the safe rollout (user-approved 2026-09-30): only
    the auth gate enforces; the rest log. An explicit var always wins."""
    from auth import security_enforcing
    for layer in ("AUTH_GATE", "IDENTITY", "LEAD_ACCESS", "WEBHOOK"):
        monkeypatch.delenv(f"SECURITY_{layer}_MODE", raising=False)
    assert security_enforcing("AUTH_GATE") is True
    assert [security_enforcing(l) for l in ("IDENTITY", "LEAD_ACCESS", "WEBHOOK")] == [False, False, False]
    monkeypatch.setenv("SECURITY_LEAD_ACCESS_MODE", "enforce")   # staging sets these explicitly
    assert security_enforcing("LEAD_ACCESS") is True

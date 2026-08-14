"""Tests for routes/dialer_routes.py's Power Dialer queue-status endpoints —
server-side persistence of a rep's progress through their call queue (see
models.DialerQueueStatus docstring for the 2026-08-10 RCA this replaces:
an ephemeral client-side Map that couldn't survive a page reload)."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timedelta, timezone

from conftest import create_test_user, create_test_lead, SDR_USER, SUPER_ADMIN
import models


class TestGetQueueStatus:

    def test_empty_lead_ids_returns_empty_dict(self, client_as_sdr):
        resp = client_as_sdr.get("/api/dialer/queue-status?lead_ids=")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_leads_with_no_status_are_absent_not_pending(self, client_as_sdr, db):
        lead = create_test_lead(db, email="untouched@test.com")
        resp = client_as_sdr.get(f"/api/dialer/queue-status?lead_ids={lead.id}")
        assert resp.status_code == 200
        assert resp.json() == {}  # absence == Pending, no row needed for that

    def test_returns_only_current_user_status(self, client_as_sdr, db):
        """RCA-class bug this must not have: one rep's skip must never leak
        into another rep's view of the same lead (e.g. after reassignment)."""
        lead = create_test_lead(db, email="shared@test.com")
        other_user = create_test_user(db, id="other-sdr", email="other@test.com", role="SDR")
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=other_user.id, status="called"))
        db.commit()

        resp = client_as_sdr.get(f"/api/dialer/queue-status?lead_ids={lead.id}")
        assert resp.status_code == 200
        assert resp.json() == {}

    def test_returns_status_for_multiple_leads(self, client_as_sdr, db):
        create_test_user(db, id=SDR_USER["sub"], email=SDR_USER["email"], role="SDR")
        l1 = create_test_lead(db, email="one@test.com")
        l2 = create_test_lead(db, email="two@test.com")
        db.add(models.DialerQueueStatus(lead_id=l1.id, user_id=SDR_USER["sub"], status="called"))
        db.add(models.DialerQueueStatus(lead_id=l2.id, user_id=SDR_USER["sub"], status="skipped", skip_reason="Wrong number"))
        db.commit()

        resp = client_as_sdr.get(f"/api/dialer/queue-status?lead_ids={l1.id},{l2.id}")
        data = resp.json()
        assert data[l1.id]["status"] == "called"
        assert data[l2.id]["status"] == "skipped"
        assert data[l2.id]["skip_reason"] == "Wrong number"


class TestSetQueueStatus:

    def test_rejects_invalid_status(self, client_as_sdr, db):
        lead = create_test_lead(db, email="bad@test.com")
        resp = client_as_sdr.post("/api/dialer/queue-status", json={"lead_id": lead.id, "status": "not-a-real-status"})
        assert resp.status_code == 400

    def test_creates_new_status_row(self, client_as_sdr, db):
        create_test_user(db, id=SDR_USER["sub"], email=SDR_USER["email"], role="SDR")
        lead = create_test_lead(db, email="new@test.com")
        resp = client_as_sdr.post("/api/dialer/queue-status", json={"lead_id": lead.id, "status": "called"})
        assert resp.status_code == 200

        row = db.query(models.DialerQueueStatus).filter(models.DialerQueueStatus.lead_id == lead.id).first()
        assert row.status == "called"
        assert row.user_id == SDR_USER["sub"]

    def test_upserts_existing_row_instead_of_duplicating(self, client_as_sdr, db):
        create_test_user(db, id=SDR_USER["sub"], email=SDR_USER["email"], role="SDR")
        lead = create_test_lead(db, email="upsert@test.com")
        client_as_sdr.post("/api/dialer/queue-status", json={"lead_id": lead.id, "status": "skipped", "skip_reason": "Bad timing"})
        client_as_sdr.post("/api/dialer/queue-status", json={"lead_id": lead.id, "status": "called"})

        rows = db.query(models.DialerQueueStatus).filter(models.DialerQueueStatus.lead_id == lead.id).all()
        assert len(rows) == 1
        assert rows[0].status == "called"
        # RCA-class bug this must not have: a stale skip_reason surviving
        # onto a later "called" status, misrepresenting why it was skipped.
        assert rows[0].skip_reason is None

    def test_skip_reason_only_persisted_for_skipped_status(self, client_as_sdr, db):
        create_test_user(db, id=SDR_USER["sub"], email=SDR_USER["email"], role="SDR")
        lead = create_test_lead(db, email="dnc@test.com")
        resp = client_as_sdr.post("/api/dialer/queue-status", json={
            "lead_id": lead.id, "status": "skipped_dnc", "skip_reason": "should be dropped",
        })
        assert resp.status_code == 200
        assert resp.json()["skip_reason"] is None

    def test_skip_reason_is_truncated_and_optional(self, client_as_sdr, db):
        create_test_user(db, id=SDR_USER["sub"], email=SDR_USER["email"], role="SDR")
        lead = create_test_lead(db, email="reason@test.com")
        resp = client_as_sdr.post("/api/dialer/queue-status", json={
            "lead_id": lead.id, "status": "skipped", "skip_reason": "x" * 500,
        })
        assert len(resp.json()["skip_reason"]) == 200


class TestClearQueueStatus:
    """DELETE /dialer/queue-status/{lead_id} — the only way today a skipped
    lead becomes callable again (requeue), see 2026-08-10 review."""

    def test_deletes_the_current_users_row(self, client_as_sdr, db):
        create_test_user(db, id=SDR_USER["sub"], email=SDR_USER["email"], role="SDR")
        lead = create_test_lead(db, email="requeue@test.com")
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=SDR_USER["sub"], status="skipped", skip_reason="Bad timing"))
        db.commit()

        resp = client_as_sdr.delete(f"/api/dialer/queue-status/{lead.id}")
        assert resp.status_code == 200
        assert db.query(models.DialerQueueStatus).filter(models.DialerQueueStatus.lead_id == lead.id).first() is None

    def test_never_deletes_another_users_row(self, client_as_sdr, db):
        lead = create_test_lead(db, email="other-requeue@test.com")
        other_user = create_test_user(db, id="other-sdr-2", email="other2@test.com", role="SDR")
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=other_user.id, status="called"))
        db.commit()

        resp = client_as_sdr.delete(f"/api/dialer/queue-status/{lead.id}")
        assert resp.status_code == 200
        assert db.query(models.DialerQueueStatus).filter(models.DialerQueueStatus.lead_id == lead.id).first() is not None

    def test_no_row_is_a_harmless_no_op(self, client_as_sdr, db):
        lead = create_test_lead(db, email="nothing-to-clear@test.com")
        resp = client_as_sdr.delete(f"/api/dialer/queue-status/{lead.id}")
        assert resp.status_code == 200


class TestSkipSummary:
    """GET /admin/dialer/skip-summary — the manager-facing read side of the
    skip data every rep's queue already writes. Admin-gated; nothing
    rendered this anywhere before 2026-08-10."""

    def test_requires_admin(self, client_as_sdr, db):
        resp = client_as_sdr.get("/api/admin/dialer/skip-summary")
        assert resp.status_code == 403

    def test_aggregates_reasons_and_dnc_separately(self, client, db):
        create_test_user(db, id=SUPER_ADMIN["sub"], email=SUPER_ADMIN["email"], role="Super Admin")
        rep = create_test_user(db, id="rep-1", email="rep1@test.com", role="SDR", name="Rep One")
        l1 = create_test_lead(db, email="skip1@test.com")
        l2 = create_test_lead(db, email="skip2@test.com")
        l3 = create_test_lead(db, email="skip3@test.com")
        db.add_all([
            models.DialerQueueStatus(lead_id=l1.id, user_id=rep.id, status="skipped", skip_reason="Wrong number"),
            models.DialerQueueStatus(lead_id=l2.id, user_id=rep.id, status="skipped", skip_reason="Wrong number"),
            models.DialerQueueStatus(lead_id=l3.id, user_id=rep.id, status="skipped_dnc"),
        ])
        db.commit()

        resp = client.get("/api/admin/dialer/skip-summary")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_skips"] == 3
        assert data["dnc_skips"] == 1
        assert data["by_reason"] == [{"reason": "Wrong number", "count": 2}]
        assert data["by_rep"] == [{"user_id": rep.id, "name": "Rep One", "count": 3}]

    def test_excludes_skips_older_than_the_requested_window(self, client, db):
        create_test_user(db, id=SUPER_ADMIN["sub"], email=SUPER_ADMIN["email"], role="Super Admin")
        rep = create_test_user(db, id="rep-2", email="rep2@test.com", role="SDR", name="Rep Two")
        old_lead = create_test_lead(db, email="old-skip@test.com")
        recent_lead = create_test_lead(db, email="recent-skip@test.com")
        db.add(models.DialerQueueStatus(
            lead_id=old_lead.id, user_id=rep.id, status="skipped", skip_reason="Old",
            updated_at=datetime.now(timezone.utc) - timedelta(days=30),
        ))
        db.add(models.DialerQueueStatus(lead_id=recent_lead.id, user_id=rep.id, status="skipped", skip_reason="Recent"))
        db.commit()

        resp = client.get("/api/admin/dialer/skip-summary?days=7")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_skips"] == 1
        assert data["by_reason"] == [{"reason": "Recent", "count": 1}]

    def test_no_reason_given_bucket_for_reasonless_manual_skips(self, client, db):
        create_test_user(db, id=SUPER_ADMIN["sub"], email=SUPER_ADMIN["email"], role="Super Admin")
        rep = create_test_user(db, id="rep-3", email="rep3@test.com", role="SDR", name="Rep Three")
        lead = create_test_lead(db, email="no-reason@test.com")
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=rep.id, status="skipped", skip_reason=None))
        db.commit()

        resp = client.get("/api/admin/dialer/skip-summary")
        data = resp.json()
        assert data["by_reason"] == [{"reason": "No reason given", "count": 1}]

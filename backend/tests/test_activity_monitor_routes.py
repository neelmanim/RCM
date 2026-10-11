

# ── v13.8.0: Instantly rows in the Email tab ─────────────────────────────────

class TestInstantlyRowsInEmailTab:
    def _rows(self, db):
        import models
        from datetime import datetime, timezone
        from conftest import create_test_lead, create_test_user
        rep = create_test_user(db, email="rep@test.com", id="rep-1", role="SDR")
        lead = create_test_lead(db, email="jim@test.com")
        lead.assigned_users.append(rep)
        db.add_all([
            # real Instantly emails: one sent, one reply, same thread
            models.LeadEmailActivity(lead_id=lead.id, direction="outbound", source="instantly", subject="hi",
                                     instantly_email_id="e1", instantly_thread_id="t1", timestamp=datetime.now(timezone.utc)),
            models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly", subject="re: hi",
                                     instantly_email_id="e2", instantly_thread_id="t1", timestamp=datetime.now(timezone.utc)),
            # open counter row — engagement, not an email
            models.LeadEmailActivity(lead_id=lead.id, direction="outbound", source="instantly",
                                     instantly_campaign_id="c1", opened_at=datetime.now(timezone.utc), open_count=2,
                                     timestamp=datetime.now(timezone.utc)),
        ])
        db.commit()
        return rep

    def test_instantly_replies_count_in_the_reply_rate_and_counter_rows_are_not_emails(self, client, db):
        self._rows(db)
        body = client.get("/api/admin/email-logs").json()
        assert body["total"] == 2                               # sent + reply, not the open counter
        assert body["summary"]["sent"] == 1 and body["summary"]["opened"] == 1
        assert body["summary"]["replied"] == 1 and body["summary"]["reply_rate"] == 100.0

    def test_the_rep_filter_attributes_instantly_rows_to_the_leads_rep(self, client, db):
        rep = self._rows(db)
        assert client.get(f"/api/admin/email-logs?sdr_id={rep.id}").json()["total"] == 2
        assert client.get("/api/admin/email-logs?sdr_id=someone-else").json()["total"] == 0

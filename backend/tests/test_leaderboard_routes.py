"""Tests for routes/leaderboard_routes.py — SDR performance leaderboard."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_test_lead, create_test_call


class TestLeaderboard:

    def test_returns_sdr_rankings(self, client, db):
        sdr1 = create_test_user(db, email="lb1@t.com", role="SDR", name="Top Seller")
        sdr2 = create_test_user(db, email="lb2@t.com", role="SDR", name="New SDR")

        # sdr1: 1 meeting scheduled, 2 calls
        lead1 = create_test_lead(db, email="lbl1@t.com", status="Meeting Scheduled")
        sdr1.assigned_leads.append(lead1)
        create_test_call(db, lead1.id, sdr1.id, "Call Completed", "Great call")
        create_test_call(db, lead1.id, sdr1.id, "Left Voicemail")
        db.commit()

        # sdr2: 0 meetings, 1 call
        lead2 = create_test_lead(db, email="lbl2@t.com", status="Calling")
        sdr2.assigned_leads.append(lead2)
        create_test_call(db, lead2.id, sdr2.id, "No Answer")
        db.commit()

        resp = client.get("/api/leaderboard")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

        # sdr1 should rank higher (1 meeting vs 0)
        assert data[0]["name"] == "Top Seller"
        assert data[0]["rank"] == 1
        assert data[0]["meetings_scheduled"] == 1

        assert data[1]["name"] == "New SDR"
        assert data[1]["rank"] == 2
        assert data[1]["meetings_scheduled"] == 0

    def test_empty_leaderboard(self, client, db):
        resp = client.get("/api/leaderboard")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_conversion_rate_calculation(self, client, db):
        sdr = create_test_user(db, email="conv@t.com", role="SDR")
        lead_m = create_test_lead(db, email="convm@t.com", status="Meeting Scheduled")
        lead_a = create_test_lead(db, email="conva@t.com", status="Lead Assigned")
        sdr.assigned_leads.extend([lead_m, lead_a])
        db.commit()

        resp = client.get("/api/leaderboard")
        data = resp.json()
        assert len(data) == 1
        # 1 meeting / 2 leads = 50.0%
        assert data[0]["conversion_rate"] == 50.0

    def test_disqualified_count_in_leaderboard(self, client, db):
        sdr = create_test_user(db, email="dqlb@t.com", role="SDR", name="DQ Tester")
        lead_dq = create_test_lead(db, email="dqlb1@t.com", status="Disqualified")
        lead_ok = create_test_lead(db, email="dqlb2@t.com", status="Calling")
        sdr.assigned_leads.extend([lead_dq, lead_ok])
        db.commit()

        resp = client.get("/api/leaderboard")
        data = resp.json()
        assert len(data) == 1
        assert data[0]["disqualified"] == 1


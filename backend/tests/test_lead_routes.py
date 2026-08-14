"""Tests for routes/lead_routes.py — Lead CRUD, dashboard, kanban, research."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from conftest import create_test_user, create_test_lead, create_test_call, create_test_dialer_call, SUPER_ADMIN, SDR_USER
import models


# ── Create Lead ──────────────────────────────────────────────────────────────

class TestCreateLead:

    def test_create_lead(self, client):
        resp = client.post("/api/leads", json={
            "first_name": "Jane", "last_name": "Doe", "email": "jane@test.com", "company": "Acme"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["first_name"] == "Jane"
        assert data["status"] == "Lead Assigned"
        assert data["lead_source"] == "manual"

    def test_create_lead_minimal(self, client):
        resp = client.post("/api/leads", json={"last_name": "Solo"})
        assert resp.status_code == 200
        assert resp.json()["last_name"] == "Solo"

    # RCA-2026-07-20: manual lead creation had no dedup at all, unlike the
    # CSV/Sheet import paths — the same contact could be (and was) re-added
    # repeatedly, and each duplicate independently re-pushed to Salesforce as
    # a brand-new Lead on every sync (see test_salesforce_client.py's
    # TestPushPendingLeadsToSalesforce for the sync-side half of this bug).

    def test_create_lead_blocks_email_duplicate(self, client, db):
        create_test_lead(db, email="dup@test.com", first_name="Original", last_name="Person")
        resp = client.post("/api/leads", json={
            "first_name": "Copycat", "last_name": "Person", "email": "dup@test.com", "company": "Acme"
        })
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    def test_create_lead_blocks_phone_duplicate(self, client, db):
        create_test_lead(db, phone="+91 98765 43210", email=None)
        resp = client.post("/api/leads", json={
            "first_name": "New", "last_name": "Person", "phone": "9876543210"
        })
        assert resp.status_code == 409

    def test_create_lead_blocks_name_company_duplicate(self, client, db):
        create_test_lead(db, first_name="Sam", last_name="Iyer", company="Beta Corp", email=None)
        resp = client.post("/api/leads", json={
            "first_name": "Sam", "last_name": "Iyer", "company": "Beta Corp"
        })
        assert resp.status_code == 409

    def test_create_lead_allows_distinct_contacts(self, client, db):
        create_test_lead(db, email="one@test.com")
        resp = client.post("/api/leads", json={
            "first_name": "Two", "last_name": "Two", "email": "two@test.com", "company": "Other"
        })
        assert resp.status_code == 200


# ── Get Lead Detail ──────────────────────────────────────────────────────────

class TestGetLead:

    def test_get_lead_by_id(self, client, db):
        lead = create_test_lead(db, email="detail@test.com")
        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        assert resp.json()["email"] == "detail@test.com"

    def test_get_nonexistent_lead_404(self, client):
        resp = client.get("/api/leads/does-not-exist")
        assert resp.status_code == 404

    def test_get_lead_last_call_outcome_reflects_dialer_call(self, client, db):
        """Bug report: after logging 'Wrong Number' via the in-app dialer, the
        lead detail page kept showing a stale/previous disposition. Root cause:
        _lead_to_dict()'s last_call_outcome only checked CallLog, never
        DialerCall, so a dialer-logged outcome never surfaced here."""
        from datetime import datetime
        from conftest import create_test_call, create_test_dialer_call
        lead = create_test_lead(db, email="staledisp@test.com")
        user = create_test_user(db, email="sdr-staledisp@test.com")
        # Naive datetimes (matching how SQLite round-trips them in this test
        # suite, e.g. test_call_routes.py's own called_at fixtures) to avoid a
        # naive/aware comparison crash while still giving each table a
        # deterministic, clearly-ordered timestamp.
        create_test_call(db, lead.id, user.id, "Not Interested", called_at=datetime(2024, 1, 1, 9, 0, 0))
        create_test_dialer_call(db, lead.id, user.id, outcome="Wrong Number", created_at=datetime(2024, 1, 2, 10, 0, 0))

        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        assert resp.json()["last_call_outcome"] == "Wrong Number"


# ── Paginated Lead List (Admin) ──────────────────────────────────────────────

class TestGetLeads:

    def test_get_leads_paginated(self, client, db):
        for i in range(5):
            create_test_lead(db, last_name=f"Bulk{i}", email=f"bulk{i}@test.com")
        resp = client.get("/api/leads?per_page=3&page=1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]) == 3
        assert data["total"] == 5
        assert data["pages"] == 2

    def test_get_leads_includes_suppression_fields(self, client, db):
        """Power Dialer client-side pre-filter needs these to skip a DNC lead
        without an unnecessary call attempt — see _lead_to_summary()."""
        create_test_lead(db, last_name="Suppressed", email="suppressed@test.com")
        resp = client.get("/api/leads?per_page=1")
        assert resp.status_code == 200
        lead_row = resp.json()["data"][0]
        assert "do_not_contact" in lead_row
        assert "unsubscribed_at" in lead_row

    def test_get_leads_last_call_outcome_reflects_dialer_call(self, client, db):
        """Same bug as TestGetLead's dialer_call test, but for the list
        endpoint's per-row serialization — _lead_to_summary's dialer_calls
        check must actually see the eager-loaded collection, not just the
        single-lead path."""
        from datetime import datetime
        lead = create_test_lead(db, email="listdisp@test.com")
        user = create_test_user(db, email="sdr-listdisp@test.com")
        create_test_call(db, lead.id, user.id, "Not Interested", called_at=datetime(2024, 1, 1, 9, 0, 0))
        create_test_dialer_call(db, lead.id, user.id, outcome="Wrong Number", created_at=datetime(2024, 1, 2, 10, 0, 0))

        resp = client.get("/api/leads?per_page=1")
        assert resp.status_code == 200
        assert resp.json()["data"][0]["last_call_outcome"] == "Wrong Number"

    def test_get_leads_does_not_n_plus_1_on_dialer_calls(self, client, db, engine):
        """RCA 2026-08-10: dialer_calls had no loader strategy in get_leads's
        .options(), unlike call_logs/notes — _lead_to_summary's dialer_calls
        check is unconditional, so each row lazy-loaded its own dialer_calls
        query. Power Dialer's 50-lead fetch turned this into ~50 extra
        queries, the dominant cost behind its ~3s load on staging.

        Guard: query count must not scale with lead count. Comparing two
        different SDRs (not two calls for the same one) so the 15s per-user
        result cache can't mask an N+1 by short-circuiting the second call.
        """
        from sqlalchemy import event

        def _leads_with_dialer_calls(n, tag):
            user = create_test_user(db, email=f"sdr-n1-{tag}@test.com")
            for i in range(n):
                lead = create_test_lead(db, email=f"n1lead-{tag}-{i}@test.com")
                user.assigned_leads.append(lead)
                create_test_dialer_call(db, lead.id, user.id, outcome="Interested")
            db.commit()

        def _query_count(path):
            queries = []
            def _count(conn, cursor, statement, parameters, context, executemany):
                queries.append(statement)
            event.listen(engine, "before_cursor_execute", _count)
            try:
                resp = client.get(path)
            finally:
                event.remove(engine, "before_cursor_execute", _count)
            assert resp.status_code == 200
            return resp, queries

        _leads_with_dialer_calls(3, "small")
        _leads_with_dialer_calls(12, "big")

        # Both requests are unscoped Super Admin fetches (no assigned_to
        # filter) — per_page bounds which page's worth of rows get
        # serialized (and therefore how many dialer_calls would lazy-load
        # per row if the bug were back), independent of total lead count.
        _, q_small = _query_count("/api/leads?per_page=3&sort_by=name")
        _, q_big = _query_count("/api/leads?per_page=12&sort_by=name")

        # If dialer_calls regressed to lazy-loading per row, q_big would be
        # ~9 queries higher than q_small (12 rows vs 3). A batched load adds
        # at most 1 extra query regardless of page size.
        assert len(q_big) - len(q_small) <= 2, (
            f"{len(q_small)} queries for a 3-row page vs {len(q_big)} for a 12-row page "
            "— dialer_calls looks like it's lazy-loading per row again"
        )

    def test_get_leads_filter_by_status(self, client, db):
        create_test_lead(db, email="a@t.com", status="Lead Assigned")
        create_test_lead(db, email="b@t.com", status="Calling")
        resp = client.get("/api/leads?status=Calling")
        data = resp.json()
        assert data["total"] == 1
        assert data["data"][0]["status"] == "Calling"

    def test_get_leads_search(self, client, db):
        create_test_lead(db, first_name="Unique", email="unique@t.com")
        create_test_lead(db, first_name="Other", email="other@t.com")
        resp = client.get("/api/leads?search=Unique")
        assert resp.json()["total"] == 1

    def test_sdr_sees_only_their_own_leads_via_leads_endpoint(self, client_as_sdr, db):
        """RCA 2026-07-28: GET /leads unconditionally 403'd any non-admin role,
        even though _build_lead_query already scopes SDR/AE correctly — this
        broke the redesigned All Leads page for every SDR/AE. Fixed by removing
        the redundant role gate; _build_lead_query's scoping is the real guard."""
        sdr = create_test_user(db, id="sdr-user-id", email="sdr@test.com", role="SDR")
        mine = create_test_lead(db, email="mine@t.com")
        hidden = create_test_lead(db, email="hidden@t.com")
        sdr.assigned_leads.append(mine)
        db.commit()

        resp = client_as_sdr.get("/api/leads")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["data"][0]["email"] == "mine@t.com"

    def test_sdr_global_view_param_is_a_no_op_not_a_privilege_escalation(self, client_as_sdr, db):
        """global_view only has meaning for Pod Admin (lead_helpers._build_lead_query) —
        confirm an SDR passing it can't use it to see other people's leads."""
        sdr = create_test_user(db, id="sdr-user-id", email="sdr2@test.com", role="SDR")
        mine = create_test_lead(db, email="mine2@t.com")
        create_test_lead(db, email="hidden2@t.com")
        sdr.assigned_leads.append(mine)
        db.commit()

        resp = client_as_sdr.get("/api/leads?global_view=true")
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_exclude_dialer_done_drops_leads_marked_called_by_this_user(self, client_as_sdr, db):
        """Power Dialer's replenishment fix: a lead the rep already worked
        must not keep reappearing just because its CRM status never moved."""
        import models
        sdr = create_test_user(db, id="sdr-user-id", email="dialerdone@test.com", role="SDR")
        done = create_test_lead(db, email="done@t.com")
        pending = create_test_lead(db, email="pending@t.com")
        sdr.assigned_leads.append(done)
        sdr.assigned_leads.append(pending)
        db.add(models.DialerQueueStatus(lead_id=done.id, user_id=sdr.id, status="called"))
        db.commit()

        resp = client_as_sdr.get("/api/leads?exclude_dialer_done=true")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["data"][0]["email"] == "pending@t.com"

    def test_exclude_dialer_done_is_a_no_op_by_default(self, client_as_sdr, db):
        import models
        sdr = create_test_user(db, id="sdr-user-id", email="default@test.com", role="SDR")
        done = create_test_lead(db, email="done2@t.com")
        sdr.assigned_leads.append(done)
        db.add(models.DialerQueueStatus(lead_id=done.id, user_id=sdr.id, status="called"))
        db.commit()

        resp = client_as_sdr.get("/api/leads")
        assert resp.json()["total"] == 1  # still shows up when the flag isn't passed

    def test_exclude_dialer_done_only_excludes_for_the_user_who_called_it(self, client_as_sdr, db):
        """A different rep's 'called' status on a shared/reassigned lead must
        not hide it from this rep — see DialerQueueStatus docstring."""
        import models
        sdr = create_test_user(db, id="sdr-user-id", email="scoped@test.com", role="SDR")
        other = create_test_user(db, id="other-sdr-id", email="otherscoped@test.com", role="SDR")
        lead = create_test_lead(db, email="reassigned@t.com")
        sdr.assigned_leads.append(lead)
        db.add(models.DialerQueueStatus(lead_id=lead.id, user_id=other.id, status="called"))
        db.commit()

        resp = client_as_sdr.get("/api/leads?exclude_dialer_done=true")
        assert resp.json()["total"] == 1

    def test_get_leads_includes_last_email_sent_at(self, client, db):
        """Power Dialer's email-sent indicator (green/grey) needs this —
        mailbox sync means it's meaningful for any lead now, not just ones
        an SDR happened to note down."""
        from datetime import datetime, timezone
        lead = create_test_lead(db, email="emailed@test.com")
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, direction="outbound", subject="Hi",
            timestamp=datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc),
        ))
        db.add(models.LeadEmailActivity(  # inbound reply — must not count as "sent"
            lead_id=lead.id, direction="inbound", subject="Re: Hi",
            timestamp=datetime(2026, 8, 2, 9, 0, tzinfo=timezone.utc),
        ))
        db.commit()
        never_emailed = create_test_lead(db, email="never@test.com")

        resp = client.get("/api/leads?per_page=10&sort_by=name")
        rows = {r["email"]: r for r in resp.json()["data"]}
        assert rows["emailed@test.com"]["last_email_sent_at"] is not None
        assert rows["never@test.com"]["last_email_sent_at"] is None

    def test_get_leads_includes_lead_context_fields(self, client, db):
        """Power Dialer's lead-context strip (2026-08-10) needs city/state/
        country/employee_count/research_company_size in the summary payload."""
        lead = create_test_lead(db, email="context@test.com")
        lead.city, lead.state, lead.country = "San Francisco", "CA", "USA"
        lead.employee_count = 512
        lead.research_company_size = "500-1000"
        create_test_lead(db, email="bare-context@test.com")
        db.commit()

        resp = client.get("/api/leads?per_page=10&sort_by=name")
        rows = {r["email"]: r for r in resp.json()["data"]}
        assert rows["context@test.com"]["city"] == "San Francisco"
        assert rows["context@test.com"]["state"] == "CA"
        assert rows["context@test.com"]["country"] == "USA"
        assert rows["context@test.com"]["employee_count"] == 512
        assert rows["context@test.com"]["research_company_size"] == "500-1000"
        assert rows["bare-context@test.com"]["city"] is None

    def test_get_leads_context_fields_do_not_n_plus_1(self, client, db, engine):
        """Guards the exact N+1 RCA this file already covers for
        do_not_contact/unsubscribed_at (see test_get_leads_does_not_n_plus_1_on_dialer_calls
        just above): a column read in _lead_to_summary but missing from
        SUMMARY_COLUMNS' load_only() deferred-loads with one extra SELECT
        per row. Comparative row-count check, not an absolute query count —
        see that test's own docstring for why."""
        from sqlalchemy import event

        def _make_leads(n, tag):
            for i in range(n):
                lead = create_test_lead(db, email=f"ctx-n1-{tag}-{i}@test.com")
                lead.city, lead.employee_count = "SF", 100
            db.commit()

        def _query_count(path):
            queries = []
            def _count(conn, cursor, statement, parameters, context, executemany):
                queries.append(statement)
            event.listen(engine, "before_cursor_execute", _count)
            try:
                resp = client.get(path)
            finally:
                event.remove(engine, "before_cursor_execute", _count)
            assert resp.status_code == 200
            return queries

        _make_leads(3, "small")
        _make_leads(12, "big")

        q_small = _query_count("/api/leads?per_page=3&sort_by=name")
        q_big = _query_count("/api/leads?per_page=12&sort_by=name")
        assert len(q_big) - len(q_small) <= 2, (
            f"{len(q_small)} queries for a 3-row page vs {len(q_big)} for a 12-row page "
            "— a context column looks like it's deferred-loading per row"
        )

    def test_get_leads_ids_only(self, client, db):
        for i in range(5):
            create_test_lead(db, last_name=f"Ids{i}", email=f"ids{i}@test.com")
        resp = client.get("/api/leads?ids_only=true")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert len(data["data"]) >= 5
        first = data["data"][0]
        assert "id" in first
        assert "first_name" in first
        assert "last_name" in first
        assert "company" in first
        assert "phone" in first
        assert "phone_secondary" in first
        assert "assigned_to" in first
        assert "email" not in first

    def test_get_leads_ids_only_with_filters(self, client, db):
        create_test_lead(db, last_name="MatchMe", status="Calling", email="m1@test.com")
        create_test_lead(db, last_name="Other", status="Calling", email="m2@test.com")
        create_test_lead(db, last_name="MatchMe", status="Research", email="m3@test.com")

        resp = client.get("/api/leads?ids_only=true&search=MatchMe&status=Calling")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]) == 1
        assert data["data"][0]["last_name"] == "MatchMe"

    def test_sort_by_name_asc(self, client, db):
        create_test_lead(db, first_name="Zoe", email="sort_z@t.com")
        create_test_lead(db, first_name="Amy", email="sort_a@t.com")
        create_test_lead(db, first_name="Mia", email="sort_m@t.com")
        resp = client.get("/api/leads?sort_by=name&sort_dir=asc")
        assert resp.status_code == 200
        names = [d["first_name"] for d in resp.json()["data"]]
        assert names.index("Amy") < names.index("Mia") < names.index("Zoe")

    def test_sort_by_name_desc(self, client, db):
        create_test_lead(db, first_name="Zoe", email="sort_z2@t.com")
        create_test_lead(db, first_name="Amy", email="sort_a2@t.com")
        resp = client.get("/api/leads?sort_by=name&sort_dir=desc")
        assert resp.status_code == 200
        names = [d["first_name"] for d in resp.json()["data"]]
        assert names.index("Zoe") < names.index("Amy")

    def test_sort_by_status(self, client, db):
        create_test_lead(db, email="sort_s1@t.com", status="Calling")
        create_test_lead(db, email="sort_s2@t.com", status="Lead Assigned")
        resp = client.get("/api/leads?sort_by=status&sort_dir=asc")
        assert resp.status_code == 200
        statuses = [d["status"] for d in resp.json()["data"]]
        assert statuses == sorted(statuses)

    def test_sort_by_time_in_status_asc_shows_shortest_first(self, client, db):
        """RCA 2026-07-28: time_in_status is derived from status_changed_at, not
        a stored column — sort_dir=asc (shortest time first) must map to the
        MOST RECENT status_changed_at first, i.e. status_changed_at DESCENDING."""
        from datetime import datetime, timezone, timedelta
        old_lead = create_test_lead(db, email="sort_old@t.com")
        old_lead.status_changed_at = datetime.now(timezone.utc) - timedelta(days=10)
        recent_lead = create_test_lead(db, email="sort_recent@t.com")
        recent_lead.status_changed_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()

        resp = client.get("/api/leads?sort_by=time_in_status&sort_dir=asc")
        assert resp.status_code == 200
        ids = [d["id"] for d in resp.json()["data"]]
        assert ids.index(recent_lead.id) < ids.index(old_lead.id), (
            "Expected the recently-changed (shortest time in status) lead first"
        )

    def test_sort_by_priority_desc_shows_highest_first(self, client, db):
        low = create_test_lead(db, email="sort_low_prio@t.com")
        low.priority_score = 25
        high = create_test_lead(db, email="sort_high_prio@t.com")
        high.priority_score = 100
        db.commit()

        resp = client.get("/api/leads?sort_by=priority&sort_dir=desc")
        assert resp.status_code == 200
        ids = [d["id"] for d in resp.json()["data"]]
        assert ids.index(high.id) < ids.index(low.id), (
            "Expected the higher priority_score lead first"
        )

    def test_unrecognized_sort_by_falls_back_to_default(self, client, db):
        """An unknown sort_by must not 500 — falls back to the default order."""
        create_test_lead(db, email="sort_fallback@t.com")
        resp = client.get("/api/leads?sort_by=not_a_real_column")
        assert resp.status_code == 200


# ── My Leads (SDR) ──────────────────────────────────────────────────────────

class TestGetMyLeads:

    def test_sdr_sees_only_assigned_leads(self, client_as_sdr, db):
        sdr = create_test_user(db, id="sdr-user-id", email="sdr@test.com", role="SDR")
        lead1 = create_test_lead(db, email="myl1@t.com")
        lead2 = create_test_lead(db, email="myl2@t.com")
        sdr.assigned_leads.append(lead1)
        db.commit()

        # SDR sees all via /my (but query is scoped by sub)
        resp = client_as_sdr.get("/api/leads/my")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert len(data["data"]) == 1
        assert data["data"][0]["email"] == "myl1@t.com"

    def test_get_my_leads_ids_only(self, client_as_sdr, db):
        sdr = create_test_user(db, id="sdr-user-id", email="sdr_ids@test.com", role="SDR")
        lead1 = create_test_lead(db, email="myl_id1@t.com")
        lead2 = create_test_lead(db, email="myl_id2@t.com")
        sdr.assigned_leads.append(lead1)
        sdr.assigned_leads.append(lead2)
        db.commit()

        # Call with override user_id context or simulate SDR JWT
        resp = client_as_sdr.get("/api/leads/my?ids_only=true")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert len(data["data"]) == 2
        first = data["data"][0]
        assert "id" in first
        assert "email" not in first


# ── Dashboard Stats ──────────────────────────────────────────────────────────

class TestDashboardStats:

    def test_returns_status_counts(self, client, db):
        create_test_lead(db, email="d1@t.com", status="Lead Assigned")
        create_test_lead(db, email="d2@t.com", status="Calling")
        create_test_lead(db, email="d3@t.com", status="Meeting Scheduled")

        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert data["status_counts"]["Lead Assigned"] == 1
        assert data["status_counts"]["Calling"] == 1
        assert data["status_counts"]["Meeting Scheduled"] == 1
        assert "recent_leads" in data


# ── Kanban ───────────────────────────────────────────────────────────────────

class TestKanban:

    def test_kanban_returns_all_leads(self, client, db):
        for i in range(3):
            create_test_lead(db, last_name=f"Kan{i}", email=f"kan{i}@t.com")
        resp = client.get("/api/leads/kanban")
        assert resp.status_code == 200
        assert len(resp.json()) == 3


# ── Update Lead ──────────────────────────────────────────────────────────────

class TestUpdateLead:

    def test_update_lead_fields(self, client, db):
        lead = create_test_lead(db, email="upd@t.com")
        resp = client.patch(f"/api/leads/{lead.id}", json={"company": "NewCo", "first_name": "Updated"})
        assert resp.status_code == 200
        assert resp.json()["company"] == "NewCo"
        assert resp.json()["first_name"] == "Updated"

    def test_update_status_creates_audit_log(self, client, db):
        lead = create_test_lead(db, email="audit@t.com", status="Lead Assigned")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Research"})
        assert resp.status_code == 200
        logs = db.query(models.LeadStatusLog).filter(models.LeadStatusLog.lead_id == lead.id).all()
        assert len(logs) == 1
        assert logs[0].from_status == "Lead Assigned"
        assert logs[0].to_status == "Research"

    def test_meeting_scheduled_requires_call(self, client, db):
        lead = create_test_lead(db, email="nocall@t.com", status="Calling")
        # Fill research fields
        for f in ["research_company", "research_contact", "research_hypothesis", "research_personalization"]:
            setattr(lead, f, "filled")
        db.commit()
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Meeting Scheduled"})
        assert resp.status_code == 422

    def test_meeting_scheduled_accepts_dialer_only_call(self, client, db):
        """A call logged entirely through the in-app dialer attaches its
        outcome to DialerCall directly, with no CallLog row created (see
        call_routes.py's dialer-attach path) — the gate must count that too."""
        lead = create_test_lead(db, email="dialeronly@t.com", status="Calling")
        for f in ["research_company", "research_contact", "research_hypothesis", "research_personalization"]:
            setattr(lead, f, "filled")
        db.commit()
        create_test_dialer_call(db, lead.id, SUPER_ADMIN["sub"], outcome="Meeting Confirmed")
        resp = client.patch(f"/api/leads/{lead.id}", json={"status": "Meeting Scheduled"})
        assert resp.status_code == 200


class TestUpdateLeadPriority:

    def test_update_lead_priority_sets_score(self, client, db):
        lead = create_test_lead(db, email="prio@t.com")
        lead.priority_score = 25
        db.commit()
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 100})
        assert resp.status_code == 200
        assert resp.json()["priority_score"] == 100
        db.refresh(lead)
        assert lead.priority_score == 100

    def test_update_lead_priority_accepts_medium_and_deprioritized(self, client, db):
        """Not just the High/reset case — the React client's tier picker sends
        50 (Medium) and 25 (Deprioritized) directly, not just a reset to 100."""
        lead = create_test_lead(db, email="prio_tiers@t.com")
        for score in (50, 25):
            resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": score})
            assert resp.status_code == 200
            assert resp.json()["priority_score"] == score

    def test_update_lead_priority_clamps_out_of_range(self, client, db):
        lead = create_test_lead(db, email="prio_clamp@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/priority", json={"priority_score": 500})
        assert resp.status_code == 200
        assert resp.json()["priority_score"] == 100


# ── Research ─────────────────────────────────────────────────────────────────

class TestResearch:

    def test_save_research_fields(self, client, db):
        lead = create_test_lead(db, email="res@t.com")
        resp = client.patch(f"/api/leads/{lead.id}/research", json={
            "research_company": "They do X",
            "research_contact": "VP of Sales",
        })
        assert resp.status_code == 200
        assert resp.json()["research_company"] == "They do X"


# ── Kanban Move ──────────────────────────────────────────────────────────────

class TestKanbanMove:

    def test_move_to_calling_succeeds_without_research_when_gate_off(self, client, db):
        """v8: Research gate is OFF by default. SDR can move to Calling without research."""
        lead = create_test_lead(db, email="kanm@t.com", status="Lead Assigned")
        resp = client.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Calling"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"

    def test_move_to_research_succeeds(self, client, db):
        lead = create_test_lead(db, email="kanr@t.com", status="Lead Assigned")
        resp = client.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Research"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Research"

    def test_move_to_disqualified_blocked(self, client, db):
        """Direct kanban move to Disqualified should be blocked."""
        lead = create_test_lead(db, email="nodq@t.com", status="Calling")
        resp = client.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Disqualified"})
        assert resp.status_code == 422

    def test_move_from_disqualified_blocked(self, client, db):
        """Cannot move a Disqualified lead back into the pipeline."""
        lead = create_test_lead(db, email="fromdq@t.com", status="Disqualified")
        resp = client.patch("/api/leads/kanban/move", params={"lead_id": lead.id, "new_status": "Calling"})
        assert resp.status_code == 422


# ── Status History ───────────────────────────────────────────────────────────

class TestStatusHistory:

    def test_returns_status_changes(self, client, db):
        lead = create_test_lead(db, email="hist@t.com")
        models.log_status_change(db, lead.id, None, "Lead Assigned", "system")
        models.log_status_change(db, lead.id, "Lead Assigned", "Research", "admin")
        db.commit()
        resp = client.get(f"/api/leads/{lead.id}/status-history")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_disqualified_transition_logged(self, client, db):
        lead = create_test_lead(db, email="dqhist@t.com")
        models.log_status_change(db, lead.id, "Calling", "Disqualified", "admin")
        db.commit()
        resp = client.get(f"/api/leads/{lead.id}/status-history")
        data = resp.json()
        assert len(data) == 1
        assert data[0]["to_status"] == "Disqualified"


# ── Activity Feed ────────────────────────────────────────────────────────────

class TestActivityFeed:

    def test_returns_org_wide_activity(self, client, db):
        lead = create_test_lead(db, email="feed@t.com")
        models.log_status_change(db, lead.id, "Lead Assigned", "Research", "admin")
        db.commit()
        resp = client.get("/api/leads/activity-feed")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["to_status"] == "Research"

    def test_excludes_sandbox_test_lead_status_changes(self, client, db):
        real_lead = create_test_lead(db, email="feed_real@t.com")
        test_lead = create_test_lead(db, email="feed_test@t.com")
        test_lead.is_test = True
        db.commit()
        models.log_status_change(db, real_lead.id, "Lead Assigned", "Research", "admin")
        models.log_status_change(db, test_lead.id, "Lead Assigned", "Research", "admin")
        db.commit()

        resp = client.get("/api/leads/activity-feed")
        assert resp.status_code == 200
        lead_ids = [row["lead_id"] for row in resp.json()]
        assert real_lead.id in lead_ids
        assert test_lead.id not in lead_ids, "test lead's status change must not appear in the dashboard activity feed"


# ── Dashboard with Disqualified ─────────────────────────────────────────────

class TestDashboardWithDisqualified:

    def test_dashboard_counts_disqualified(self, client, db):
        create_test_lead(db, email="dqd1@t.com", status="Lead Assigned")
        create_test_lead(db, email="dqd2@t.com", status="Disqualified")
        resp = client.get("/api/leads/dashboard-stats")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["status_counts"].get("Disqualified", 0) == 1


# ── Leads Filter by Disqualified ────────────────────────────────────────────

class TestLeadsFilterDisqualified:

    def test_filter_by_disqualified_status(self, client, db):
        create_test_lead(db, email="filt1@t.com", status="Calling")
        create_test_lead(db, email="filt2@t.com", status="Disqualified")
        create_test_lead(db, email="filt3@t.com", status="Disqualified")
        resp = client.get("/api/leads?status=Disqualified")
        data = resp.json()
        assert data["total"] == 2
        assert all(d["status"] == "Disqualified" for d in data["data"])



# ── Backward Transition Access Control ──────────────────────────────────────

class TestBackwardTransitionAccess:

    def test_sdr_cannot_move_backward_kanban(self, client_as_sdr, db):
        """SDR should get 403 when trying to move Calling → Research."""
        sdr = models.User(id="sdr-user-id", email="sdr@test.com", name="SDR User", role="SDR")
        db.add(sdr)
        lead = create_test_lead(db, email="bw1@t.com", status="Calling")
        sdr.assigned_leads.append(lead)
        db.commit()
        resp = client_as_sdr.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Research"})
        assert resp.status_code == 403
        assert "previous status" in resp.json()["detail"].lower()

    def test_pod_admin_can_move_backward_kanban(self, client_as_pod_admin, db):
        """Pod Admin should be allowed to move Calling → Research."""
        lead = create_test_lead(db, email="bw2@t.com", status="Calling")
        resp = client_as_pod_admin.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Research"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Research"

    def test_super_admin_can_move_backward_kanban(self, client, db):
        """Super Admin should be allowed to move Calling → Research."""
        lead = create_test_lead(db, email="bw3@t.com", status="Calling")
        resp = client.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Research"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Research"

    def test_sdr_can_still_move_forward(self, client_as_sdr, db):
        """SDR can move Research → Calling (gate is OFF by default in v8)."""
        sdr = models.User(id="sdr-user-id", email="sdrf@test.com", name="SDR User", role="SDR")
        db.add(sdr)
        lead = create_test_lead(db, email="fw1@t.com", status="Research")
        sdr.assigned_leads.append(lead)
        db.commit()
        resp = client_as_sdr.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Calling"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"


# ── Research v2 fields in lead GET response ──────────────────────────────────
# Fix: _lead_to_dict was missing research_heat and research_opening.
# Without them, frontend's hasV2Research check was always false on page load,
# causing an unnecessary extra research API call for every lead opened.

class TestLeadDetailResearchV2Fields:

    def test_lead_detail_includes_research_heat(self, client, db):
        """GET /api/leads/{id} must return research_heat for hasV2Research check."""
        lead = create_test_lead(db, email="v2heat@t.com")
        lead.research_heat = "hot"
        db.commit()
        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "research_heat" in data, "research_heat missing from lead detail API response"
        assert data["research_heat"] == "hot"

    def test_lead_detail_includes_research_opening(self, client, db):
        """GET /api/leads/{id} must return research_opening (v2 opening line)."""
        lead = create_test_lead(db, email="v2open@t.com")
        lead.research_opening = "Hi Priya, saw Acme just crossed 100 employees — congrats!"
        db.commit()
        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "research_opening" in data, "research_opening missing from lead detail API response"
        assert data["research_opening"] == "Hi Priya, saw Acme just crossed 100 employees — congrats!"

    def test_lead_detail_research_heat_none_when_not_set(self, client, db):
        """When v2 research hasn't run yet, research_heat and research_opening are null (not missing)."""
        lead = create_test_lead(db, email="v2null@t.com")
        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        data = resp.json()
        # Keys must be present (even if null) — frontend checks 'in' not truthiness
        assert "research_heat" in data
        assert "research_opening" in data
        assert data["research_heat"] is None
        assert data["research_opening"] is None

    def test_lead_detail_has_v2_research_both_fields(self, client, db):
        """Both v2 fields populated — frontend hasV2Research check resolves to true."""
        lead = create_test_lead(db, email="v2both@t.com")
        lead.research_heat = "warm"
        lead.research_opening = "Hey Amit, noticed Groww just launched a new product..."
        db.commit()
        resp = client.get(f"/api/leads/{lead.id}")
        assert resp.status_code == 200
        data = resp.json()
        # Simulate frontend's hasV2Research = research_heat && research_opening
        has_v2 = bool(data.get("research_heat") and data.get("research_opening"))
        assert has_v2 is True, "hasV2Research should be true when both v2 fields are set"


# ── Lead Assigned → Calling direct backend move (pipeline step fix) ──────────
# Fix: frontend step rule now allows within-stage jumps.
# Backend has NO step-order enforcement — this tests that backend accepts it.

class TestLeadAssignedToCallingDirect:

    def test_lead_assigned_to_calling_succeeds_gate_off(self, client, db):
        """Lead Assigned → Calling directly must succeed when research gate is OFF.
        This is the core scenario: SDR opens a fresh lead and dials immediately.
        The AI research runs automatically in the background."""
        lead = create_test_lead(db, email="direct1@t.com", status="Lead Assigned")
        resp = client.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Calling"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"

    def test_lead_assigned_to_calling_blocked_gate_on(self, client, db):
        """Lead Assigned → Calling must be blocked when research gate is ON
        and core research fields are not filled."""
        # Turn gate on
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings:
            settings = models.SyncSettings(id=1)
            db.add(settings)
        settings.require_research_before_calling = True
        db.commit()

        lead = create_test_lead(db, email="direct2@t.com", status="Lead Assigned")
        resp = client.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Calling"})
        assert resp.status_code == 422
        assert "research" in resp.json()["detail"].lower() or "required" in resp.json()["detail"].lower()

        # Cleanup — turn gate off for other tests
        settings.require_research_before_calling = False
        db.commit()

    def test_lead_assigned_to_calling_succeeds_gate_on_with_research(self, client, db):
        """Lead Assigned → Calling must succeed when gate is ON and all 4 research fields filled."""
        settings = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        if not settings:
            settings = models.SyncSettings(id=1)
            db.add(settings)
        settings.require_research_before_calling = True
        db.commit()

        lead = create_test_lead(db, email="direct3@t.com", status="Lead Assigned")
        lead.research_company = "They build SaaS"
        lead.research_contact = "VP of Sales"
        lead.research_hypothesis = "Need outbound tooling"
        lead.research_personalization = "They just hired 5 AEs"
        db.commit()

        resp = client.patch("/api/leads/kanban/move",
            params={"lead_id": lead.id, "new_status": "Calling"})
        assert resp.status_code == 200
        assert resp.json()["lead"]["status"] == "Calling"

        # Cleanup
        settings.require_research_before_calling = False
        db.commit()


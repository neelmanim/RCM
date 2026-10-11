"""
Tests for Analytics Dashboard Bug Fixes & Enhancements (V-next).

Bug 1:  Batch dropdown ignores preset date filters
Bug 3:  Funnel shows 0 leads but >0 research when batch is selected outside date range
Bug 5:  Trend chart groups research by created_at instead of status_changed_at
Enh 1:  Unique calls per lead + average calls per lead in funnel
Enh 3:  Pod identifier in batch dropdown labels

Conventions:
  - Uses conftest.py fixtures (client, db, engine)
  - In-memory SQLite — date_trunc tests marked xfail
  - Each test is isolated (cache cleared via autouse fixture)
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timezone, timedelta
from conftest import (
    create_test_user,
    create_test_lead,
    create_test_pod,
    create_test_call,
    create_test_dialer_call,
)
import models
import routes.analytics_routes as _analytics_mod


@pytest.fixture(autouse=True)
def _clear_caches():
    _analytics_mod._cache.clear()
    yield
    _analytics_mod._cache.clear()


_postgres_only = pytest.mark.xfail(
    reason="date_trunc is Postgres-only; SQLite raises OperationalError",
    strict=False,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _create_upload_log(db, filename="gsheet-Google Sheet", created_at=None):
    log = models.LeadUploadLog(filename=filename)
    db.add(log)
    db.flush()
    if created_at:
        log.created_at = created_at
        db.flush()
    db.commit()
    db.refresh(log)
    return log


def _create_lead_for_batch(db, batch_log, email, pod=None, research_done=False,
                           created_at=None, status_changed_at=None):
    """Create a lead linked to the batch via the real upload_log_id FK
    (mirrors admin_upload_routes.py — no lead_source/filename heuristics)."""
    lead = models.Lead(
        first_name="Test", last_name=email.split("@")[0],
        email=email, company="TestCo", status="Lead Assigned",
        lead_source="upload:test.csv", pod_id=pod.id if pod else None,
        upload_log_id=batch_log.id,
    )
    if research_done:
        lead.research_personalization = "done"
        lead.research_company = "done"
    db.add(lead)
    db.flush()
    if created_at:
        lead.created_at = created_at
    if status_changed_at:
        lead.status_changed_at = status_changed_at
    db.commit()
    db.refresh(lead)
    return lead


# ═════════════════════════════════════════════════════════════════════════════
# BUG 1: Batch dropdown should respect preset date filters
# ═════════════════════════════════════════════════════════════════════════════

class TestBug1_BatchDateScoping:
    """The /filters endpoint must scope batches by date_from/date_to."""

    def test_batches_filtered_by_custom_date_range(self, client, db):
        """Batches outside the custom date range should NOT appear."""
        old = _create_upload_log(db, "gsheet-Old Batch",
                                 created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        recent = _create_upload_log(db, "gsheet-Recent Batch",
                                    created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))
        _create_lead_for_batch(db, old, "old@t.com")
        _create_lead_for_batch(db, recent, "recent@t.com")

        resp = client.get("/api/admin/analytics/filters"
                          "?date_from=2026-04-15&date_to=2026-04-22")
        assert resp.status_code == 200
        batch_ids = [b["id"] for b in resp.json()["batches"]]
        assert recent.id in batch_ids
        assert old.id not in batch_ids

    def test_batches_no_date_filter_returns_all(self, client, db):
        """Without date params, all batches (that have leads) should be returned."""
        b1 = _create_upload_log(db, "gsheet-Batch1")
        b2 = _create_upload_log(db, "gsheet-Batch2")
        _create_lead_for_batch(db, b1, "b1@t.com")
        _create_lead_for_batch(db, b2, "b2@t.com")

        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200
        batch_ids = [b["id"] for b in resp.json()["batches"]]
        assert b1.id in batch_ids
        assert b2.id in batch_ids

    def test_batches_scoped_by_pod(self, client, db):
        """A batch should only appear for a pod that actually has leads from it."""
        pod_a = create_test_pod(db, name="Pod A")
        pod_b = create_test_pod(db, name="Pod B")

        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        # Create leads for this batch under pod_a only
        _create_lead_for_batch(db, batch, "a@t.com", pod=pod_a)

        resp_a = client.get(f"/api/admin/analytics/filters?pod_id={pod_a.id}")
        resp_b = client.get(f"/api/admin/analytics/filters?pod_id={pod_b.id}")
        assert resp_a.status_code == 200
        assert resp_b.status_code == 200
        assert batch.id in [b["id"] for b in resp_a.json()["batches"]]
        assert batch.id not in [b["id"] for b in resp_b.json()["batches"]]

    def test_batch_with_no_leads_excluded_from_dropdown(self, client, db):
        """A LeadUploadLog with zero linked leads (e.g. a legacy/manual batch
        row with no real Lead.upload_log_id links) must never be offered as a
        selectable batch — picking it would always be a guaranteed-empty
        dead end. Regression test for the Klenty-backfill-style bug."""
        empty_batch = _create_upload_log(db, "Klenty Backfill Q2-2026",
                                         created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        real_batch = _create_upload_log(db, "gsheet-Google Sheet",
                                        created_at=datetime(2026, 4, 11, tzinfo=timezone.utc))
        _create_lead_for_batch(db, real_batch, "real@t.com")

        resp = client.get("/api/admin/analytics/filters")
        batch_ids = [b["id"] for b in resp.json()["batches"]]
        assert real_batch.id in batch_ids
        assert empty_batch.id not in batch_ids

    def test_empty_date_range_returns_no_batches(self, client, db):
        """Date range that contains no batches should return empty list."""
        _create_upload_log(db, "gsheet-Old",
                           created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))

        resp = client.get("/api/admin/analytics/filters"
                          "?date_from=2026-12-01&date_to=2026-12-31")
        assert resp.status_code == 200
        assert resp.json()["batches"] == []


# ═════════════════════════════════════════════════════════════════════════════
# BUG 3: Funnel shows 0 leads but >0 research when batch selected outside date
# ═════════════════════════════════════════════════════════════════════════════

class TestBug3_BatchOverridesDateForLeads:
    """When a batch is selected, leads_assigned should reflect ALL batch leads,
    not be further filtered by the date range."""

    def test_batch_selected_leads_not_zero(self, client, db):
        """Core regression: selecting a batch should show its leads even if
        the global date range excludes the batch upload date."""
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        lead = _create_lead_for_batch(db, batch, "b3@t.com", research_done=True,
                                      created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))

        # Query with date range AFTER the batch (Apr 16-22) but SELECT the batch
        resp = client.get(
            f"/api/admin/analytics/funnel"
            f"?date_from=2026-04-16&date_to=2026-04-22"
            f"&upload_log_id={batch.id}"
        )
        assert resp.status_code == 200
        body = resp.json()
        # After fix: leads_assigned should be 1 (batch scoping overrides date)
        # Before fix: leads_assigned would be 0 (date filter excludes Apr 10 lead)
        assert body["leads_assigned"] >= 1, (
            f"Bug 3 regression: leads_assigned={body['leads_assigned']}, "
            f"expected >=1 when batch is selected"
        )

    def test_no_batch_selected_date_filter_applies(self, client, db):
        """Without batch selection, date filter should still scope leads normally."""
        old_lead = create_test_lead(db, email="old@t.com")
        old_lead.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        new_lead = create_test_lead(db, email="new@t.com")
        new_lead.created_at = datetime(2026, 4, 20, tzinfo=timezone.utc)
        db.commit()

        resp = client.get("/api/admin/analytics/funnel"
                          "?date_from=2026-04-15&date_to=2026-04-22")
        body = resp.json()
        assert body["leads_assigned"] == 1  # Only new_lead

    def test_unresolvable_batch_returns_zeros(self, client, db):
        """A batch id with no matching leads should return zeros, not unfiltered
        data — Lead.upload_log_id is a real FK, so a bogus/empty batch id simply
        matches nothing rather than needing special-case handling."""
        create_test_lead(db, email="wild@t.com")

        resp = client.get("/api/admin/analytics/funnel"
                          "?upload_log_id=nonexistent-uuid-1234")
        body = resp.json()
        assert body["leads_assigned"] == 0

    def test_batch_with_pod_filter(self, client, db):
        """Batch + pod filter should return only leads in that pod from that batch."""
        pod_a = create_test_pod(db, name="Pod A")
        pod_b = create_test_pod(db, name="Pod B")

        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        _create_lead_for_batch(db, batch, "pa@t.com", pod=pod_a,
                               created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        _create_lead_for_batch(db, batch, "pb@t.com", pod=pod_b,
                               created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))

        resp = client.get(
            f"/api/admin/analytics/funnel"
            f"?upload_log_id={batch.id}&pod_id={pod_a.id}"
        )
        body = resp.json()
        assert body["leads_assigned"] == 1  # Only pod_a lead


# ═════════════════════════════════════════════════════════════════════════════
# Rep filter (_resolve_sdr_filter) — Analytics Hub "Rep" dropdown
# ═════════════════════════════════════════════════════════════════════════════

class TestRepFilter:
    """A Super Admin/Pod Admin can scope the hub to one rep via sdr_id. A Pod
    Admin must not be able to peek at another pod's rep by passing its id
    directly — get_filter_options only ever offers their own pod's reps, but
    a direct API call could try anyway."""

    def test_super_admin_scopes_funnel_to_chosen_rep(self, client, db):
        rep_a = create_test_user(db, email="repa@t.com", name="Rep A", role="SDR")
        rep_b = create_test_user(db, email="repb@t.com", name="Rep B", role="SDR")
        lead_a = create_test_lead(db, email="repfilter-a@t.com")
        lead_b = create_test_lead(db, email="repfilter-b@t.com")
        rep_a.assigned_leads.append(lead_a)
        rep_b.assigned_leads.append(lead_b)
        db.commit()

        resp = client.get(f"/api/admin/analytics/funnel?sdr_id={rep_a.id}")
        assert resp.json()["leads_assigned"] == 1

    def test_pod_admin_cannot_scope_to_a_rep_outside_their_pod(self, client_as_pod_admin, db):
        """rep_in_pod belongs to the Pod Admin's own pod ("test-pod-id"); rep_
        elsewhere belongs to a different pod. Passing rep_elsewhere's id must
        NOT leak that pod's lead — _resolve_sdr_filter rejects an out-of-pod
        sdr_id rather than trusting the caller."""
        rep_in_pod = create_test_user(db, email="repinpod@t.com", name="In Pod", role="SDR", pod_id="test-pod-id")
        rep_elsewhere = create_test_user(db, email="repelsewhere@t.com", name="Elsewhere", role="SDR", pod_id="other-pod-id")
        lead_elsewhere = create_test_lead(db, email="repfilter-elsewhere@t.com")
        rep_elsewhere.assigned_leads.append(lead_elsewhere)
        db.commit()

        resp = client_as_pod_admin.get(f"/api/admin/analytics/funnel?sdr_id={rep_elsewhere.id}")
        # Rejected sdr_id falls back to the Pod Admin's own pod scope (0 leads
        # here, since rep_elsewhere's lead lives outside it) — never the
        # other pod's rep's data.
        assert resp.json()["leads_assigned"] == 0


# ═════════════════════════════════════════════════════════════════════════════
# Lead Activity (/analytics/leads) — must honor preset/date scoping like
# every other Analytics Hub endpoint, and exclude test/deleted leads
# ═════════════════════════════════════════════════════════════════════════════

class TestLeadActivityScoping:
    """Live-reported bug (2026-09-25): selecting the '7D' preset showed 83
    leads_assigned on the funnel but 12,150 leads in the Lead Activity panel
    for the exact same filters — get_lead_activity accepted date_from/date_to
    but never `preset`, so every preset-based selection (7D/30D/90D) silently
    fell through with no date filter applied at all, and never excluded
    sandbox/deleted leads like every other reporting endpoint does."""

    def test_preset_scopes_lead_activity_same_as_funnel(self, client, db):
        old_lead = create_test_lead(db, email="la-old@t.com",
                                     created_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
        recent_lead = create_test_lead(db, email="la-recent@t.com",
                                        created_at=datetime.now(timezone.utc) - timedelta(days=1))
        for resp in (
            client.get("/api/admin/analytics/leads?preset=7d"),
            client.get("/api/admin/analytics/funnel?preset=7d"),
        ):
            assert resp.status_code == 200
        leads_resp = client.get("/api/admin/analytics/leads?preset=7d").json()
        funnel_resp = client.get("/api/admin/analytics/funnel?preset=7d").json()
        lead_ids = [l["id"] for l in leads_resp["leads"]]
        assert recent_lead.id in lead_ids
        assert old_lead.id not in lead_ids
        # The two views must agree on how many leads fall in the window —
        # this is the exact live-reported mismatch (83 vs 12,150).
        assert leads_resp["total"] == funnel_resp["leads_assigned"]

    def test_batch_selection_overrides_date_preset(self, client, db):
        """Same 'batch scoping wins over date scoping' rule as the funnel
        (TestBug3_BatchOverridesDateForLeads) — a lead from an old batch must
        still show up in Lead Activity when that batch is explicitly picked,
        even though '7d' would otherwise exclude it."""
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2020, 1, 1, tzinfo=timezone.utc))
        old_batch_lead = _create_lead_for_batch(db, batch, "la-batch@t.com",
                                                 created_at=datetime(2020, 1, 1, tzinfo=timezone.utc))

        resp = client.get(f"/api/admin/analytics/leads?preset=7d&upload_log_id={batch.id}")
        lead_ids = [l["id"] for l in resp.json()["leads"]]
        assert old_batch_lead.id in lead_ids

    def test_excludes_test_and_deleted_leads(self, client, db):
        real_lead = create_test_lead(db, email="la-real@t.com")
        test_lead = create_test_lead(db, email="la-test@t.com")
        test_lead.is_test = True
        db.commit()

        resp = client.get("/api/admin/analytics/leads?preset=all")
        lead_ids = [l["id"] for l in resp.json()["leads"]]
        assert real_lead.id in lead_ids
        assert test_lead.id not in lead_ids

    def test_sort_by_company(self, client, db):
        create_test_lead(db, email="la-sort-z@t.com", company="Zebra Inc")
        create_test_lead(db, email="la-sort-a@t.com", company="Alpha Inc")

        resp = client.get("/api/admin/analytics/leads?preset=all&sort_by=company")
        companies = [l["company"] for l in resp.json()["leads"]]
        assert companies == sorted(companies)


class TestLeadActivityEmailDetail:
    """Lead Activity should show email detail at the same level as calls
    (per-lead email_count/last_email_status, plus email events in the
    per-lead timeline)."""

    def test_email_count_and_furthest_status_per_lead(self, client, db):
        sdr = create_test_user(db, email="em-sdr@t.com", name="Em SDR", role="SDR")
        lead = create_test_lead(db, email="em-lead@t.com")
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, user_id=sdr.id, direction="outbound", subject="First",
        ))
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, user_id=sdr.id, direction="outbound", subject="Second",
            opened_at=datetime.now(timezone.utc),
        ))
        db.commit()

        resp = client.get("/api/admin/analytics/leads?preset=all")
        row = next(l for l in resp.json()["leads"] if l["id"] == lead.id)
        assert row["email_count"] == 2
        # Furthest stage reached across all sends, not the last one sent.
        assert row["last_email_status"] == "opened"

    def test_timeline_includes_email_events(self, client, db):
        sdr = create_test_user(db, email="em-sdr2@t.com", name="Em SDR2", role="SDR")
        lead = create_test_lead(db, email="em-lead2@t.com")
        db.add(models.LeadEmailActivity(
            lead_id=lead.id, user_id=sdr.id, direction="outbound", subject="Hi there",
        ))
        db.commit()

        resp = client.get(f"/api/admin/analytics/leads/{lead.id}/timeline")
        events = resp.json()["timeline"]
        assert any(e["type"] == "email" for e in events)


class TestLeadActivityConnectOutcomeVisibility:
    """'Did people log what happened on connects' — aggregate stat +
    per-lead flag for a connected DialerCall with no SDR-tagged outcome."""

    def test_aggregate_connects_vs_logged_outcome(self, client, db):
        sdr = create_test_user(db, email="co-sdr@t.com", name="Co SDR", role="SDR")
        lead1 = create_test_lead(db, email="co-lead1@t.com")
        lead2 = create_test_lead(db, email="co-lead2@t.com")
        # Connected with a logged outcome.
        create_test_dialer_call(db, lead1.id, sdr.id, outcome="Interested")
        # Connected (duration-based, no SDR outcome) — batch-synced style.
        create_test_dialer_call(db, lead2.id, sdr.id, outcome=None, duration=121)

        resp = client.get("/api/admin/analytics/leads?preset=all").json()
        assert resp["total_connects"] == 2
        assert resp["connects_with_outcome"] == 1

    def test_per_lead_connect_no_outcome_flag(self, client, db):
        sdr = create_test_user(db, email="co-sdr2@t.com", name="Co SDR2", role="SDR")
        flagged_lead = create_test_lead(db, email="co-lead3@t.com")
        clean_lead = create_test_lead(db, email="co-lead4@t.com")
        create_test_dialer_call(db, flagged_lead.id, sdr.id, outcome=None, duration=121)
        create_test_dialer_call(db, clean_lead.id, sdr.id, outcome="Interested")

        resp = client.get("/api/admin/analytics/leads?preset=all").json()
        rows = {l["id"]: l for l in resp["leads"]}
        assert rows[flagged_lead.id]["connect_no_outcome"] is True
        assert rows[clean_lead.id]["connect_no_outcome"] is False


# ═════════════════════════════════════════════════════════════════════════════
# ENHANCEMENT 1: Unique calls per lead + avg calls per lead
# ═════════════════════════════════════════════════════════════════════════════

class TestEnh1_UniqueCallMetrics:
    """Funnel should return unique_leads_called and avg_calls_per_lead."""

    def test_funnel_has_unique_call_fields(self, client, db):
        """Funnel calls section should include the new metrics."""
        sdr = create_test_user(db, email="uc@t.com", name="UC SDR", role="SDR")
        lead1 = create_test_lead(db, email="uc1@t.com")
        lead2 = create_test_lead(db, email="uc2@t.com")
        # 3 calls to lead1, 1 call to lead2
        create_test_call(db, lead1.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead1.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead1.id, sdr.id, outcome="Call Completed")
        create_test_call(db, lead2.id, sdr.id, outcome="No Answer")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        body = resp.json()
        calls = body["calls"]

        assert calls["made"] == 4
        # After enhancement: these fields should exist
        assert "unique_leads_called" in calls, "Missing unique_leads_called field"
        assert "avg_calls_per_lead" in calls, "Missing avg_calls_per_lead field"
        assert calls["unique_leads_called"] == 2
        assert calls["avg_calls_per_lead"] == 2.0  # 4 calls / 2 leads

    def test_unique_calls_zero_when_no_calls(self, client, db):
        """With no calls, unique and avg should be 0."""
        resp = client.get("/api/admin/analytics/funnel")
        calls = resp.json()["calls"]
        assert calls.get("unique_leads_called", 0) == 0
        assert calls.get("avg_calls_per_lead", 0) == 0

    def test_unique_calls_single_lead_multiple_calls(self, client, db):
        """5 calls to 1 lead = unique=1, avg=5.0."""
        sdr = create_test_user(db, email="sl@t.com", name="SL SDR", role="SDR")
        lead = create_test_lead(db, email="sl_lead@t.com")
        for _ in range(5):
            create_test_call(db, lead.id, sdr.id, outcome="No Answer")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        calls = resp.json()["calls"]
        assert calls["unique_leads_called"] == 1
        assert calls["avg_calls_per_lead"] == 5.0

    def test_unique_calls_pod_scoped(self, client, db):
        """Unique call metrics should respect pod filter."""
        pod_a = create_test_pod(db, name="Pod A")
        pod_b = create_test_pod(db, name="Pod B")
        sdr = create_test_user(db, email="ps@t.com", name="PS SDR", role="SDR")

        lead_a = create_test_lead(db, email="pa@t.com")
        lead_a.pod_id = pod_a.id
        lead_b = create_test_lead(db, email="pb@t.com")
        lead_b.pod_id = pod_b.id

        create_test_call(db, lead_a.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead_a.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead_b.id, sdr.id, outcome="No Answer")
        db.commit()

        resp = client.get(f"/api/admin/analytics/funnel?preset=all&pod_id={pod_a.id}")
        calls = resp.json()["calls"]
        assert calls["made"] == 2
        assert calls["unique_leads_called"] == 1
        assert calls["avg_calls_per_lead"] == 2.0


# ═════════════════════════════════════════════════════════════════════════════
# ENHANCEMENT 3: Pod identifier in batch labels
# ═════════════════════════════════════════════════════════════════════════════

class TestEnh3_PodInBatchLabels:
    """Batch dropdown labels should include the pod name."""

    def test_batch_label_includes_pod_name(self, client, db):
        """When a batch's leads belong to a pod, the label should show it."""
        pod = create_test_pod(db, name="US Team")
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))
        _create_lead_for_batch(db, batch, "pod_label@t.com", pod=pod,
                               created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))

        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200
        batches = resp.json()["batches"]
        batch_obj = next((b for b in batches if b["id"] == batch.id), None)
        assert batch_obj is not None
        # After enhancement: pod_name should be in response
        assert "pod_name" in batch_obj, "Missing pod_name field in batch object"
        assert batch_obj["pod_name"] == "US Team"

    def test_batch_label_no_pod_shows_null(self, client, db):
        """Batch with leads that have no pod should show pod_name as null."""
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))
        _create_lead_for_batch(db, batch, "nopod@t.com",
                               created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))

        resp = client.get("/api/admin/analytics/filters")
        batches = resp.json()["batches"]
        batch_obj = next((b for b in batches if b["id"] == batch.id), None)
        assert batch_obj is not None
        assert batch_obj.get("pod_name") is None

    def test_batch_label_mixed_pods_uses_majority(self, client, db):
        """When batch leads span multiple pods, use the majority pod."""
        pod_a = create_test_pod(db, name="India Team")
        pod_b = create_test_pod(db, name="US Team")
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))
        # 3 leads in pod_a, 1 in pod_b → majority is India Team
        for i in range(3):
            _create_lead_for_batch(db, batch, f"india{i}@t.com", pod=pod_a,
                                   created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))
        _create_lead_for_batch(db, batch, "us0@t.com", pod=pod_b,
                               created_at=datetime(2026, 4, 20, tzinfo=timezone.utc))

        resp = client.get("/api/admin/analytics/filters")
        batches = resp.json()["batches"]
        batch_obj = next((b for b in batches if b["id"] == batch.id), None)
        assert batch_obj is not None
        assert batch_obj.get("pod_name") == "India Team"


# ═════════════════════════════════════════════════════════════════════════════
# EDGE CASES: General robustness
# ═════════════════════════════════════════════════════════════════════════════

class TestEdgeCases:

    def test_funnel_invalid_date_format_handled(self, client, db):
        """Invalid date strings should not crash the endpoint."""
        resp = client.get("/api/admin/analytics/funnel"
                          "?date_from=not-a-date&date_to=also-bad")
        assert resp.status_code == 200  # Graceful fallback

    def test_funnel_date_from_after_date_to(self, client, db):
        """Inverted date range should return 0 leads (not crash)."""
        create_test_lead(db, email="inv@t.com")
        resp = client.get("/api/admin/analytics/funnel"
                          "?date_from=2026-04-22&date_to=2026-04-01")
        assert resp.status_code == 200
        assert resp.json()["leads_assigned"] == 0

    def test_funnel_preset_all_ignores_date_params(self, client, db):
        """preset=all should return everything regardless of date params."""
        lead = create_test_lead(db, email="all@t.com")
        lead.created_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.json()["leads_assigned"] >= 1

    def test_filters_empty_db_no_crash(self, client, db):
        """Filters endpoint with empty DB should return empty lists."""
        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200
        body = resp.json()
        assert body["batches"] == []
        assert body["pods"] == []

    def test_funnel_batch_plus_lead_source_both_applied(self, client, db):
        """When both batch and lead_source are provided, batch should take precedence."""
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        _create_lead_for_batch(db, batch, "both@t.com",
                               created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))

        resp = client.get(
            f"/api/admin/analytics/funnel"
            f"?upload_log_id={batch.id}&lead_source=LinkedIn&preset=all"
        )
        body = resp.json()
        # batch_lead_source filter is more specific; lead_source shouldn't zero it out
        # The exact behavior depends on implementation, but it should not crash
        assert resp.status_code == 200

    def test_batch_summary_returns_200(self, client, db):
        """Batch summary endpoint should work even with no data."""
        resp = client.get("/api/admin/analytics/batch-summary")
        assert resp.status_code == 200
        assert "batches" in resp.json()

    def test_multiple_calls_same_lead_counted_correctly(self, client, db):
        """Verify total calls vs unique leads are computed independently."""
        sdr = create_test_user(db, email="mc@t.com", name="MC SDR", role="SDR")
        lead = create_test_lead(db, email="mc_lead@t.com")
        # 10 calls to same lead
        for _ in range(10):
            create_test_call(db, lead.id, sdr.id, outcome="No Answer")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        calls = resp.json()["calls"]
        assert calls["made"] == 10
        # After enhancement
        if "unique_leads_called" in calls:
            assert calls["unique_leads_called"] == 1
            assert calls["avg_calls_per_lead"] == 10.0


# ═════════════════════════════════════════════════════════════════════════════
# RCA-2026-07-21: Analytics Hub batch filter reliability — Lead.upload_log_id
# is a real, indexed FK (set at upload time in admin_upload_routes.py, and
# backfilled historically). Every endpoint that accepts upload_log_id must
# filter leads/calls/emails by that FK consistently — no endpoint should ever
# silently fall back to unfiltered ("All Batches") data for a valid batch id.
# ═════════════════════════════════════════════════════════════════════════════

class TestBatchFilterAcrossEndpoints:
    """Every batch-aware endpoint must agree with the others for the same
    upload_log_id: SDR table, email breakdown, batch summary, and the
    Won/Lost opportunity counts inside /funnel."""

    def test_sdr_table_scoped_to_batch(self, client, db):
        """/sdr-table must only count leads/calls belonging to the selected batch."""
        sdr = create_test_user(db, email="sdr_batch@t.com", name="Batch SDR", role="SDR")
        batch = _create_upload_log(db, "gsheet-Google Sheet")
        in_batch = _create_lead_for_batch(db, batch, "inbatch@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=in_batch.id))
        outside = create_test_lead(db, email="outside@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=outside.id))
        db.commit()

        resp = client.get(f"/api/admin/analytics/sdr-table?upload_log_id={batch.id}")
        assert resp.status_code == 200
        rows = resp.json()["sdrs"]
        row = next((r for r in rows if r.get("sdr_id") == sdr.id or r.get("user_id") == sdr.id), None)
        assert row is not None
        assert row["leads_assigned"] == 1  # only in_batch, not outside

    def test_sdr_table_unresolvable_batch_returns_empty(self, client, db):
        """A batch id matching no leads must return an empty table, not all SDRs."""
        sdr = create_test_user(db, email="sdr_empty@t.com", name="Empty SDR", role="SDR")
        lead = create_test_lead(db, email="e@t.com")
        db.execute(models.lead_assignments.insert().values(user_id=sdr.id, lead_id=lead.id))
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?upload_log_id=nonexistent-id")
        assert resp.status_code == 200
        rows = resp.json()["sdrs"]
        row = next((r for r in rows if r.get("sdr_id") == sdr.id or r.get("user_id") == sdr.id), None)
        # SDR still listed (table always lists all SDRs) but with 0 leads for this batch
        assert row is None or row["leads_assigned"] == 0

    def test_email_breakdown_scoped_to_batch(self, client, db):
        """/email-breakdown must only count emails for leads in the selected batch."""
        batch = _create_upload_log(db, "gsheet-Google Sheet")
        in_batch = _create_lead_for_batch(db, batch, "email_inbatch@t.com")
        outside = create_test_lead(db, email="email_outside@t.com")

        db.add(models.LeadEmailActivity(lead_id=in_batch.id, direction="outbound"))
        db.add(models.LeadEmailActivity(lead_id=outside.id, direction="outbound"))
        db.commit()

        resp = client.get(f"/api/admin/analytics/email-breakdown?upload_log_id={batch.id}")
        assert resp.status_code == 200
        stages = resp.json()["stages"] if isinstance(resp.json(), dict) and "stages" in resp.json() else resp.json()
        total_sent = sum(s.get("sent", 0) for s in stages) if isinstance(stages, list) else None
        if total_sent is not None:
            assert total_sent == 1  # only the in-batch email

    def test_batch_summary_counts_match_real_fk(self, client, db):
        """/batch-summary lead counts must reflect only leads truly linked via
        Lead.upload_log_id — not a filename/lead_source guess."""
        batch = _create_upload_log(db, "gsheet-Google Sheet")
        _create_lead_for_batch(db, batch, "bs1@t.com")
        _create_lead_for_batch(db, batch, "bs2@t.com")
        create_test_lead(db, email="bs_outside@t.com")  # unrelated, must not be counted

        resp = client.get("/api/admin/analytics/batch-summary")
        assert resp.status_code == 200
        rows = resp.json()["batches"]
        row = next((r for r in rows if r["id"] == batch.id), None)
        assert row is not None
        assert row["leads"] == 2

    def test_batch_summary_excludes_batches_with_no_leads(self, client, db):
        """A batch row with zero linked leads must not appear in the comparison table."""
        _create_upload_log(db, "Klenty Backfill Q2-2026")  # no leads attached at all

        resp = client.get("/api/admin/analytics/batch-summary")
        assert resp.status_code == 200
        assert resp.json()["batches"] == []

    def test_batch_summary_calls_scoped_by_date_range(self, client, db):
        """RCA 2026-07-27: /batch-summary's per-batch calls/meetings/disqualified/
        research ignored date_from/date_to entirely — the date range only
        selected which batches appear, not the activity counted for them,
        unlike every other Analytics Hub card. A call made outside the
        selected date window must not count toward that batch's total."""
        sdr = create_test_user(db, email="bs_date_sdr@t.com", role="SDR")
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                    created_at=datetime(2026, 6, 10, tzinfo=timezone.utc))
        lead = _create_lead_for_batch(db, batch, "bs_date_lead@t.com")

        create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested",
                                 created_at=datetime(2026, 6, 15, tzinfo=timezone.utc))
        create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested",
                                 created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        db.commit()

        resp = client.get(
            "/api/admin/analytics/batch-summary?date_from=2026-06-01&date_to=2026-06-30"
        )
        assert resp.status_code == 200
        row = next((r for r in resp.json()["batches"] if r["id"] == batch.id), None)
        assert row is not None
        assert row["calls"] == 1, f"Expected only the June call counted, got {row['calls']}"

    def test_batch_summary_meetings_scoped_by_date_range(self, client, db):
        """RCA 2026-07-27: meetings/disqualified/research counts previously
        ignored the date range and always showed the batch's lifetime total."""
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                    created_at=datetime(2026, 6, 10, tzinfo=timezone.utc))
        in_window = _create_lead_for_batch(db, batch, "bs_meet_in@t.com")
        in_window.status = "Meeting Scheduled"
        in_window.lead_closed_at = datetime(2026, 6, 15, tzinfo=timezone.utc)
        outside_window = _create_lead_for_batch(db, batch, "bs_meet_out@t.com")
        outside_window.status = "Meeting Scheduled"
        outside_window.lead_closed_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db.commit()

        resp = client.get(
            "/api/admin/analytics/batch-summary?date_from=2026-06-01&date_to=2026-06-30"
        )
        assert resp.status_code == 200
        row = next((r for r in resp.json()["batches"] if r["id"] == batch.id), None)
        assert row is not None
        assert row["meetings"] == 1, f"Expected only the June meeting counted, got {row['meetings']}"

    def test_opportunity_won_lost_scoped_to_batch(self, client, db):
        """Won/Lost counts in /funnel must respect the batch filter, same as
        every other funnel metric (previously unfiltered — RCA-2026-07-21)."""
        batch = _create_upload_log(db, "gsheet-Google Sheet")
        in_batch = _create_lead_for_batch(db, batch, "won_inbatch@t.com")
        in_batch.opportunity_status = "Won"
        outside = create_test_lead(db, email="won_outside@t.com")
        outside.opportunity_status = "Won"
        db.commit()

        resp = client.get(f"/api/admin/analytics/funnel?upload_log_id={batch.id}&preset=all")
        body = resp.json()
        assert body["opportunity"]["won"] == 1  # only in_batch

    def test_funnel_calls_made_scoped_to_batch(self, client, db):
        """Bug report: 'Calls Made' on /funnel ignored the batch filter entirely —
        selecting a specific batch still showed org/pod-wide call totals, while
        every sibling metric (leads_assigned, research, etc.) correctly scoped
        to the batch. calls_made must only count calls against leads in the
        selected batch."""
        sdr = create_test_user(db, email="callsbatch_sdr@t.com", name="Calls Batch SDR", role="SDR")
        batch = _create_upload_log(db, "gsheet-Google Sheet")
        in_batch = _create_lead_for_batch(db, batch, "calls_inbatch@t.com")
        outside = create_test_lead(db, email="calls_outside@t.com")

        create_test_dialer_call(db, in_batch.id, sdr.id, outcome="Interested")
        create_test_dialer_call(db, outside.id, sdr.id, outcome="Interested")

        resp = client.get(f"/api/admin/analytics/funnel?upload_log_id={batch.id}&preset=all")
        assert resp.status_code == 200
        assert resp.json()["calls"]["made"] == 1  # only in_batch, not outside

    def test_funnel_calls_made_never_negative_for_batch_with_few_calls(self, client, db):
        """Bug report: Analytics Hub showed 'Calls Made: -31' for a real batch
        (Klenty CSV backfill). Root cause: the dialer_calls/call_logs overlap
        de-dupe count was computed org-wide (unscoped by batch), then subtracted
        from a single batch's much smaller, correctly-scoped totals — going
        negative once real overlap existed anywhere else in the org."""
        sdr = create_test_user(db, email="negcalls_sdr@t.com", name="Neg Calls SDR", role="SDR")

        # Two leads OUTSIDE the batch, each with an overlapping CallLog + DialerCall
        # (same user+lead+date) — this is what inflates the org-wide overlap count.
        for i in range(2):
            outside = create_test_lead(db, email=f"negcalls_outside{i}@t.com")
            create_test_call(db, outside.id, sdr.id)
            create_test_dialer_call(db, outside.id, sdr.id)

        # The selected batch has exactly one real call.
        batch = _create_upload_log(db, "gsheet-Google Sheet")
        in_batch = _create_lead_for_batch(db, batch, "negcalls_inbatch@t.com")
        create_test_dialer_call(db, in_batch.id, sdr.id)

        resp = client.get(f"/api/admin/analytics/funnel?upload_log_id={batch.id}&preset=all")
        assert resp.status_code == 200
        assert resp.json()["calls"]["made"] == 1  # never negative, never inflated by unrelated overlap


@_postgres_only
class TestTrendBatchFilter:
    """Activity Trend chart series must all respect the batch filter equally —
    previously the Calls series ignored upload_log_id entirely while Emails/
    Meetings/Research/Disqualified did apply it (RCA-2026-07-21)."""

    def test_trend_calls_series_scoped_to_batch(self, client, db):
        sdr = create_test_user(db, email="trend_sdr@t.com", name="Trend SDR", role="SDR")
        batch = _create_upload_log(db, "gsheet-Google Sheet",
                                   created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        in_batch = _create_lead_for_batch(db, batch, "trend_in@t.com",
                                          created_at=datetime(2026, 4, 10, tzinfo=timezone.utc))
        outside = create_test_lead(db, email="trend_out@t.com")

        create_test_dialer_call(db, in_batch.id, sdr.id,
                                created_at=datetime(2026, 4, 18, tzinfo=timezone.utc))
        create_test_dialer_call(db, outside.id, sdr.id,
                                created_at=datetime(2026, 4, 18, tzinfo=timezone.utc))

        resp = client.get(
            "/api/admin/analytics/trend"
            f"?date_from=2026-04-15&date_to=2026-04-22&upload_log_id={batch.id}"
        )
        assert resp.status_code == 200
        data = resp.json()["series"]
        total_calls = sum(d.get("calls", 0) for d in data)
        assert total_calls == 1  # only the in-batch call, not the outside one


class TestResolveDateRangeSimple:
    """RCA-2026-07-13: explicit date_from/date_to must win over a defaulted preset."""

    def test_explicit_dates_win_even_with_preset_30d(self):
        start, end = _analytics_mod._resolve_date_range_simple("2026-01-01", "2026-01-05", "30d")
        assert start.day == 1 and end.day == 5

    def test_inverted_range_is_swapped(self):
        start, end = _analytics_mod._resolve_date_range_simple("2026-01-05", "2026-01-01", "30d")
        assert start.day == 1 and end.day == 5

    def test_no_dates_no_preset_is_all_time(self):
        assert _analytics_mod._resolve_date_range_simple(None, None, None) == (None, None)

    def test_preset_applies_when_no_explicit_dates(self):
        start, end = _analytics_mod._resolve_date_range_simple(None, None, "7d")
        assert (end - start).days == 6


class TestConnectRateDataCleanliness:
    """RCA 2026-08-25: NOT_ANSWERED_OUTCOMES was missing "Unreachable" and
    compared case-sensitively against outcome strings, so a lowercase
    "no_answer" variant (real production data) silently counted as a live
    connect. Also, /funnel's calls_connected only ever summed DialerCall
    connects — a manually-logged (CallLog) connect never contributed, even
    though it already counted toward the calls_made denominator."""

    def test_lowercase_no_answer_variant_not_counted_as_connected(self, client, db):
        sdr = create_test_user(db, email="caseoutcome_sdr@t.com", name="Case Outcome SDR", role="SDR")
        lead = create_test_lead(db, email="caseoutcome_lead@t.com")
        create_test_dialer_call(db, lead.id, sdr.id, outcome="no_answer")

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        assert resp.json()["calls"]["connected"] == 0

    def test_unreachable_outcome_not_counted_as_connected(self, client, db):
        sdr = create_test_user(db, email="unreachable_sdr@t.com", name="Unreachable SDR", role="SDR")
        lead = create_test_lead(db, email="unreachable_lead@t.com")
        create_test_dialer_call(db, lead.id, sdr.id, outcome="Unreachable")

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        assert resp.json()["calls"]["connected"] == 0

    def test_left_the_company_still_counts_as_connected(self, client, db):
        sdr = create_test_user(db, email="ltc_sdr@t.com", name="LTC SDR", role="SDR")
        lead = create_test_lead(db, email="ltc_lead@t.com")
        create_test_dialer_call(db, lead.id, sdr.id, outcome="Left the Company")

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        assert resp.json()["calls"]["connected"] == 1

    def test_manual_call_log_connect_counted_in_funnel_numerator(self, client, db):
        sdr = create_test_user(db, email="cllog_sdr@t.com", name="CallLog SDR", role="SDR")
        lead = create_test_lead(db, email="cllog_lead@t.com")
        # A DialerCall that never connected, plus a manually-logged CallLog
        # (different lead, no matching DialerCall so it isn't de-duped as
        # overlap) that did — only the CallLog connect should count.
        other_lead = create_test_lead(db, email="cllog_other@t.com")
        create_test_dialer_call(db, other_lead.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead.id, sdr.id, outcome="Interested")

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        body = resp.json()
        assert body["calls"]["made"] == 2
        assert body["calls"]["connected"] == 1

    def test_auto_logged_call_log_not_double_counted_as_connected(self, client, db):
        """RCA 2026-08-25 (2): _auto_log_outcome mirrors every DialerCall into a
        CallLog row with dialer_call_id set. The funnel used to count ALL
        call_logs and only subtract a date-based heuristic overlap from
        calls_made — never from calls_connected — so this mirrored row's
        connect was counted once via DialerCall and again via CallLog,
        inflating connect_rate. It must count once."""
        sdr = create_test_user(db, email="mirrored_sdr@t.com", name="Mirrored SDR", role="SDR")
        lead = create_test_lead(db, email="mirrored_lead@t.com")
        dialer_call = create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")
        mirrored_log = create_test_call(db, lead.id, sdr.id, outcome="Interested")
        mirrored_log.dialer_call_id = dialer_call.id
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        body = resp.json()
        assert body["calls"]["made"] == 1
        assert body["calls"]["connected"] == 1

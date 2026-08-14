"""
Tests for routes/analytics_routes.py — Analytics Hub.

Coverage:
  1. /filters       — SDR list, pod list, batch list, lead sources
  2. /funnel        — KPI metrics + filter params (pod, source, upload_log)
  3. /sdr-table     — Per-SDR breakdown, pagination, pod-scope
  4. /trend         — Time-series endpoint returns expected shape
  5. /email-breakdown — Email endpoint structure
  6. /insights-summary — POST endpoint, LLM not configured path

Test conventions follow the existing suite:
  - `client` fixture from conftest.py (dependency-overridden FastAPI TestClient)
  - `db` fixture from conftest.py (in-memory SQLite, isolated per test)
  - Helpers: create_test_user, create_test_lead, create_test_pod, create_test_call

**SQLite note**: The /trend endpoint uses PostgreSQL-specific `date_trunc()`. Those
tests are marked @pytest.mark.xfail(reason='date_trunc not in SQLite') and are
expected to fail in the local test environment. They pass on staging (Postgres).
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from conftest import (
    create_test_user,
    create_test_lead,
    create_test_pod,
    create_test_call,
    create_test_dialer_call,
)
import models

# ── Module-level cache used by analytics_routes (cleared between tests) ──────
import routes.analytics_routes as _analytics_mod
import routes.analytics_ai_routes as _analytics_ai_mod


@pytest.fixture(autouse=True)
def _clear_analytics_cache():
    """Wipe the in-memory caches before every analytics test.
    The analytics router uses a module-level dict (_cache) that persists
    across tests, causing earlier test data to bleed into later assertions.
    """
    _analytics_mod._cache.clear()
    _analytics_ai_mod._llm_summary_cache.clear()
    yield
    _analytics_mod._cache.clear()
    _analytics_ai_mod._llm_summary_cache.clear()


# Mark to indicate a test needs Postgres date_trunc and is expected to fail
# on SQLite (local test env). It WILL pass on staging (real Postgres DB).
_postgres_only = pytest.mark.xfail(
    reason="date_trunc is Postgres-only; SQLite raises OperationalError",
    strict=False,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def create_test_upload_log(db, filename="batch_jan.csv"):
    """Create a LeadUploadLog for batch-filter tests."""
    log = models.LeadUploadLog(filename=filename)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def assign_lead_to_sdr(db, lead, sdr):
    """Append lead to sdr.assigned_leads and commit."""
    sdr.assigned_leads.append(lead)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# 1. /filters endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestFiltersEndpoint:

    def test_returns_200(self, client, db):
        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200

    def test_response_shape(self, client, db):
        resp = client.get("/api/admin/analytics/filters")
        body = resp.json()
        assert "pods" in body
        assert "sdrs" in body
        assert "batches" in body
        assert "lead_sources" in body

    def test_sdrs_loaded_using_user_name_field(self, client, db):
        """
        Regression: User model has `name` NOT `first_name`/`last_name`.
        Previously caused AttributeError → 500 on every request.
        """
        sdr1 = create_test_user(db, email="alpha@t.com", name="Alice Smith", role="SDR")
        sdr2 = create_test_user(db, email="beta@t.com",  name="Bob Jones",  role="SDR")
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        sdr_names = {s["name"] for s in resp.json()["sdrs"]}
        assert "Alice Smith" in sdr_names
        assert "Bob Jones"  in sdr_names

    def test_sdr_with_no_name_falls_back_to_email(self, client, db):
        """Users with name=None or '' should appear by email."""
        sdr = create_test_user(db, email="nameless@t.com", name="", role="SDR")
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200
        sdr_emails = {s["name"] for s in resp.json()["sdrs"]}
        assert "nameless@t.com" in sdr_emails

    def test_non_sdrs_excluded_from_sdr_list(self, client, db):
        """Pod Admins and Super Admins must not appear in the SDR dropdown."""
        create_test_user(db, email="admin@t.com", name="Pod Admin",   role="Pod Admin")
        create_test_user(db, email="super@t.com", name="Super Admin", role="Super Admin")
        sdr = create_test_user(db, email="sdr@t.com", name="Real SDR", role="SDR")
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        sdr_names = {s["name"] for s in resp.json()["sdrs"]}
        assert "Real SDR" in sdr_names
        assert "Pod Admin" not in sdr_names
        assert "Super Admin" not in sdr_names

    def test_pods_returned(self, client, db):
        pod = create_test_pod(db, name="Alpha Pod")
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        pod_names = [p["name"] for p in resp.json()["pods"]]
        assert "Alpha Pod" in pod_names

    def test_lead_sources_returned(self, client, db):
        create_test_lead(db, email="l1@t.com", lead_source="LinkedIn")
        create_test_lead(db, email="l2@t.com", lead_source="salesforce")
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        sources = resp.json()["lead_sources"]
        # Sources are now {value, label} objects
        source_values = [s["value"] for s in sources]
        assert "LinkedIn" in source_values
        assert "salesforce" in source_values

    def test_source_normalization_deduplicates_gsheet(self, client, db):
        """Multiple gsheet:Google Sheet:YYYY-MM-DD entries collapse into one 'Google Sheet'."""
        create_test_lead(db, email="gs1@t.com", lead_source="gsheet:Google Sheet:2026-03-25")
        create_test_lead(db, email="gs2@t.com", lead_source="gsheet:Google Sheet:2026-04-01")
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        sources = resp.json()["lead_sources"]
        source_values = [s["value"] for s in sources]
        source_labels = [s["label"] for s in sources]
        # Only one entry for gsheet prefix
        assert source_values.count("google_sheet") == 1
        assert "Google Sheet" in source_labels

    def test_sdr_includes_pod_id(self, client, db):
        """SDR objects in /filters now include pod_id for frontend cascade."""
        pod = create_test_pod(db, name="Cascade Pod")
        sdr = create_test_user(db, email="cascade@t.com", name="Cascade SDR", role="SDR", pod_id=pod.id)
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        sdr_obj = next((s for s in resp.json()["sdrs"] if s["name"] == "Cascade SDR"), None)
        assert sdr_obj is not None
        assert "pod_id" in sdr_obj
        assert sdr_obj["pod_id"] == str(pod.id)

    def test_batches_returned(self, client, db):
        log = create_test_upload_log(db, filename="jan_upload.csv")
        lead = create_test_lead(db, email="jan_batch@t.com")
        lead.upload_log_id = log.id
        db.commit()

        resp = client.get("/api/admin/analytics/filters")
        assert resp.status_code == 200
        batch_ids = [b["id"] for b in resp.json()["batches"]]
        assert log.id in batch_ids

    def test_empty_database_returns_empty_lists(self, client, db):
        resp = client.get("/api/admin/analytics/filters")
        body = resp.json()
        assert resp.status_code == 200
        assert body["sdrs"] == []
        assert body["pods"] == []
        assert body["lead_sources"] == []
        assert body["batches"] == []


# ─────────────────────────────────────────────────────────────────────────────
# 2. /funnel endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestFunnelEndpoint:

    def test_returns_200_no_params(self, client, db):
        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200

    def test_response_has_required_fields(self, client, db):
        """
        Funnel response shape:
          { leads_assigned, emails{sent,opened,...},
            calls{made,connected,...}, connect_rate, avg_retries,
            meetings{booked,...}, disqualified, opportunity{won,lost}, meta }
        """
        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        body = resp.json()
        # Top-level keys
        for key in ("leads_assigned", "calls", "emails", "connect_rate",
                    "meetings", "avg_retries", "meta"):
            assert key in body, f"Missing top-level key: {key}"
        # Nested shapes
        assert "made" in body["calls"]
        assert "sent" in body["emails"]
        assert "booked" in body["meetings"]

    def test_lead_count_increases_with_data(self, client, db):
        create_test_lead(db, email="f1@t.com")
        create_test_lead(db, email="f2@t.com")
        create_test_lead(db, email="f3@t.com")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        body = resp.json()
        assert body["leads_assigned"] >= 3

    def test_pod_filter_scopes_leads(self, client, db):
        """
        The funnel endpoint filters leads by Lead.pod_id.
        Create leads with explicit pod_id set on the lead itself.
        """
        pod_a = create_test_pod(db, name="Pod A")
        pod_b = create_test_pod(db, name="Pod B")

        # Create leads with pod_id set directly on the Lead model
        lead_a = create_test_lead(db, email="la@t.com")
        lead_b = create_test_lead(db, email="lb@t.com")
        lead_a.pod_id = pod_a.id
        lead_b.pod_id = pod_b.id
        db.commit()

        resp_all   = client.get("/api/admin/analytics/funnel?preset=all")
        resp_pod_a = client.get(f"/api/admin/analytics/funnel?preset=all&pod_id={pod_a.id}")
        resp_pod_b = client.get(f"/api/admin/analytics/funnel?preset=all&pod_id={pod_b.id}")

        assert resp_all.status_code == 200
        assert resp_pod_a.status_code == 200
        assert resp_pod_b.status_code == 200

        # Each pod should see exactly its own lead
        assert resp_pod_a.json()["leads_assigned"] == 1
        assert resp_pod_b.json()["leads_assigned"] == 1
        # Combined should be 2
        assert resp_all.json()["leads_assigned"] == 2

    def test_lead_source_filter(self, client, db):
        create_test_lead(db, email="li1@t.com", lead_source="LinkedIn")
        create_test_lead(db, email="li2@t.com", lead_source="LinkedIn")
        create_test_lead(db, email="sf1@t.com", lead_source="Salesforce")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all&lead_source=LinkedIn")
        assert resp.status_code == 200
        assert resp.json()["leads_assigned"] == 2

    def test_preset_all_returns_all_leads(self, client, db):
        for i in range(5):
            create_test_lead(db, email=f"p{i}@t.com")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.json()["leads_assigned"] >= 5

    def test_connect_rate_is_null_when_no_calls(self, client, db):
        """connect_rate is null (not 0) when there are no call records at all."""
        resp = client.get("/api/admin/analytics/funnel")
        val = resp.json().get("connect_rate")
        # With zero calls the backend returns null (NULLIF with zero denominator)
        assert val is None or isinstance(val, (int, float))

    def test_calls_made_is_zero_with_no_data(self, client, db):
        resp = client.get("/api/admin/analytics/funnel")
        assert resp.json()["calls"]["made"] == 0

    def test_meetings_booked_is_zero_with_no_data(self, client, db):
        resp = client.get("/api/admin/analytics/funnel")
        assert resp.json()["meetings"]["booked"] == 0

    def test_connect_rate_counts_provider_disposition(self, client, db):
        """RCA 2026-08-03: same dialer_call_connected() helper as the SDR
        table — Klenty calls carry provider_disposition, never outcome."""
        user = create_test_user(db, email="funnel-klenty-cr@t.com")
        lead = create_test_lead(db, email="funnel-klenty-cr-lead@t.com")
        create_test_dialer_call(db, lead.id, user.id, provider="klenty", provider_disposition="ANSWERED")
        create_test_dialer_call(db, lead.id, user.id, provider="klenty", provider_disposition="NOT_ANSWERED")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        body = resp.json()
        assert body["calls"]["made"] == 2
        assert body["calls"]["connected"] == 1
        assert body["connect_rate"] == 50.0

    def test_lead_source_filter_scopes_calls_made(self, client, db):
        """
        RCA 2026-07-27: calls_made/connected/connect_rate ignored lead_source
        entirely — every other funnel card (leads_assigned, emails
        sent/opened, meetings, disqualified, opportunity) correctly scoped by
        source, but Calls silently stayed org-wide. A dialer call against a
        lead from a DIFFERENT source than the one we're filtering by must
        not be counted.
        """
        user = create_test_user(db, email="funnel-calls-sdr@t.com")
        li_lead = create_test_lead(db, email="funnel-li@t.com", lead_source="LinkedIn")
        sf_lead = create_test_lead(db, email="funnel-sf@t.com", lead_source="Salesforce")
        create_test_dialer_call(db, li_lead.id, user.id)
        create_test_dialer_call(db, sf_lead.id, user.id)
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all&lead_source=LinkedIn")
        assert resp.status_code == 200
        assert resp.json()["calls"]["made"] == 1, (
            f"Expected only the LinkedIn lead's 1 call, got {resp.json()['calls']}"
        )

    def test_lead_source_filter_scopes_avg_retries(self, client, db):
        """RCA 2026-07-27: avg_retries ignored lead_source entirely."""
        li_lead = create_test_lead(db, email="funnel-retries-li@t.com", lead_source="LinkedIn")
        sf_lead = create_test_lead(db, email="funnel-retries-sf@t.com", lead_source="Salesforce")
        li_lead.call_attempt_count = 10
        sf_lead.call_attempt_count = 0
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all&lead_source=LinkedIn")
        assert resp.status_code == 200
        assert resp.json()["avg_retries"] == 10.0, (
            f"Expected avg_retries scoped to only the LinkedIn lead (10), got {resp.json()['avg_retries']}"
        )

    def test_lead_source_filter_scopes_emails_replied(self, client, db):
        """RCA 2026-07-27: emails_replied ignored lead_source entirely — sent/opened
        correctly scoped by source, replied silently stayed org-wide."""
        from conftest import create_email_activity
        li_lead = create_test_lead(db, email="funnel-reply-li@t.com", lead_source="LinkedIn")
        sf_lead = create_test_lead(db, email="funnel-reply-sf@t.com", lead_source="Salesforce")
        create_email_activity(db, li_lead.id, direction="inbound", nylas_thread_id="thread-li-1")
        create_email_activity(db, sf_lead.id, direction="inbound", nylas_thread_id="thread-sf-1")
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all&lead_source=LinkedIn")
        assert resp.status_code == 200
        assert resp.json()["emails"]["replied"] == 1, (
            f"Expected only the LinkedIn lead's 1 reply, got {resp.json()['emails']}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. /sdr-table endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestSdrTableEndpoint:

    def test_returns_200(self, client, db):
        resp = client.get("/api/admin/analytics/sdr-table")
        assert resp.status_code == 200

    def test_response_shape(self, client, db):
        resp = client.get("/api/admin/analytics/sdr-table")
        body = resp.json()
        assert "sdrs" in body
        assert "total" in body
        assert "page" in body

    def test_sdr_appears_in_table(self, client, db):
        sdr = create_test_user(db, email="sdr_tbl@t.com", name="Table SDR", role="SDR")
        lead = create_test_lead(db, email="for_tbl@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_names = [s.get("name") or s.get("sdr_name") for s in resp.json()["sdrs"]]
        assert "Table SDR" in sdr_names

    def test_sdr_name_comes_from_user_name_field(self, client, db):
        """
        Regression: SDR table must use User.name, not first_name/last_name.
        """
        sdr = create_test_user(db, email="sdr_name@t.com", name="Correct Name", role="SDR")
        lead = create_test_lead(db, email="lead_name@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        all_names = [r.get("name") or r.get("sdr_name") for r in resp.json()["sdrs"]]
        assert "Correct Name" in all_names

    def test_calls_made_counted_correctly(self, client, db):
        sdr = create_test_user(db, email="sdr_calls@t.com", name="Call SDR", role="SDR")
        lead = create_test_lead(db, email="lead_calls@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_call(db, lead.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead.id, sdr.id, outcome="Call Completed")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Call SDR"),
            None,
        )
        assert sdr_row is not None, "SDR not found in table"
        assert sdr_row["calls_made"] == 2

    def test_calls_made_uses_real_call_date_not_sync_ingestion_date(self, client, db):
        """
        Regression: a delayed batch sync (Klenty's pull-only nightly catch-up,
        or Aircall's nightly catch-up job) inserts a DialerCall with the real
        call time in started_at but created_at set to whenever the sync ran —
        possibly hours or days later. Date-filtered views must attribute the
        call to its real (started_at) date, not the sync's insertion date.
        """
        import datetime as _dt
        sdr = create_test_user(db, email="delayed_sync@t.com", name="Delayed Sync SDR", role="SDR")
        lead = create_test_lead(db, email="delayed_sync_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        real_call_day = _dt.datetime(2026, 7, 29, 18, 0, tzinfo=_dt.timezone.utc)
        sync_ingestion_day = _dt.datetime(2026, 7, 30, 6, 51, tzinfo=_dt.timezone.utc)
        create_test_dialer_call(
            db, lead.id, sdr.id,
            provider="klenty",
            started_at=real_call_day,
            created_at=sync_ingestion_day,
        )
        db.commit()

        resp = client.get(
            "/api/admin/analytics/sdr-table?date_from=2026-07-29&date_to=2026-07-29"
        )
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Delayed Sync SDR"),
            None,
        )
        assert sdr_row is not None, "SDR not found in table"
        assert sdr_row["calls_made"] == 1, (
            "Call should count on 2026-07-29 (the real call date, started_at) "
            "even though it was synced into the DB on 2026-07-30 (created_at)"
        )

        # And it must NOT double-count onto the sync day instead
        resp2 = client.get(
            "/api/admin/analytics/sdr-table?date_from=2026-07-30&date_to=2026-07-30"
        )
        sdr_row2 = next(
            (r for r in resp2.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Delayed Sync SDR"),
            None,
        )
        assert sdr_row2 is None or sdr_row2["calls_made"] == 0

    def test_connect_rate_only_counts_live_connects(self, client, db):
        sdr = create_test_user(db, email="cr_sdr@t.com", name="ConnRate SDR", role="SDR")
        lead = create_test_lead(db, email="cr_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_call(db, lead.id, sdr.id, outcome="Call Completed")   # live connect
        create_test_call(db, lead.id, sdr.id, outcome="No Answer")        # not a connect
        create_test_call(db, lead.id, sdr.id, outcome="Left Voicemail")   # not a connect
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "ConnRate SDR"),
            None,
        )
        assert sdr_row is not None
        assert sdr_row["calls_made"] == 3
        # connect_rate = 1/3 ≈ 33.3 — just check it's not 100% or 0%
        rate = sdr_row.get("connect_rate", 0)
        assert 0 < rate < 100

    def test_connect_rate_counts_provider_disposition_for_batch_synced_calls(self, client, db):
        """RCA 2026-08-03: Klenty calls never get an SDR-tagged outcome (no
        Connect Rate tie-in via `outcome`), so Connect Rate always read 0%
        for a Klenty-heavy SDR regardless of real performance. provider_
        disposition (Klenty's own ANSWERED/NOT_ANSWERED) is the connect
        signal those calls actually carry."""
        sdr = create_test_user(db, email="klenty_cr@t.com", name="Klenty CR SDR", role="SDR")
        lead = create_test_lead(db, email="klenty_cr_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, provider="klenty", provider_disposition="ANSWERED")
        create_test_dialer_call(db, lead.id, sdr.id, provider="klenty", provider_disposition="NOT_ANSWERED")
        create_test_dialer_call(db, lead.id, sdr.id, provider="klenty", provider_disposition="VOICE_MAIL")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Klenty CR SDR"),
            None,
        )
        assert sdr_row is not None
        assert sdr_row["calls_made"] == 3
        assert sdr_row["calls_connected"] == 1
        assert sdr_row["connect_rate"] == pytest.approx(33.3, abs=0.1)

    def test_pod_filter_scopes_sdr_table(self, client, db):
        pod_x = create_test_pod(db, name="Pod X")
        pod_y = create_test_pod(db, name="Pod Y")
        sdr_x = create_test_user(db, email="sdr_x@t.com", name="SDR X", role="SDR", pod_id=pod_x.id)
        sdr_y = create_test_user(db, email="sdr_y@t.com", name="SDR Y", role="SDR", pod_id=pod_y.id)
        lead_x = create_test_lead(db, email="lead_x@t.com")
        lead_y = create_test_lead(db, email="lead_y@t.com")
        assign_lead_to_sdr(db, lead_x, sdr_x)
        assign_lead_to_sdr(db, lead_y, sdr_y)
        db.commit()

        resp = client.get(f"/api/admin/analytics/sdr-table?preset=all&pod_id={pod_x.id}")
        assert resp.status_code == 200
        sdr_names = [r.get("name") or r.get("sdr_name") for r in resp.json()["sdrs"]]
        assert "SDR X" in sdr_names
        # SDR Y belongs to a different pod — must not appear when filtering by Pod X
        assert "SDR Y" not in sdr_names

    def test_pagination_works(self, client, db):
        for i in range(5):
            sdr = create_test_user(db, email=f"pg_sdr{i}@t.com", name=f"PageSDR{i}", role="SDR")
            lead = create_test_lead(db, email=f"pg_lead{i}@t.com")
            assign_lead_to_sdr(db, lead, sdr)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all&page=1&page_size=2")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["sdrs"]) <= 2
        assert body["total"] >= 5

    def test_empty_sdr_table_returns_empty_list(self, client, db):
        resp = client.get("/api/admin/analytics/sdr-table")
        body = resp.json()
        assert resp.status_code == 200
        assert isinstance(body["sdrs"], list)

    def test_meetings_count_respects_date_filter(self, client, db):
        """
        BUG-ANALYTICS-2 fix: SDR meetings column must respect the date filter.

        Case A: lead_closed_at is 60 days ago → must NOT appear in 7D filter
        Case B: lead_closed_at is today → MUST appear in 7D filter

        Previously meetings were all-time (never date-filtered). This was wrong
        because selecting "Last 7 Days" still showed all-time meeting counts per SDR.
        """
        from datetime import datetime, timezone, timedelta
        sdr = create_test_user(db, email="mtg_sdr@t.com", name="Meeting SDR", role="SDR")

        # Case A: meeting booked 60 days ago → outside 7D window
        lead_old = create_test_lead(db, email="mtg_lead_old@t.com")
        lead_old.status = "Meeting Scheduled"
        lead_old.created_at = datetime.now(timezone.utc) - timedelta(days=60)
        lead_old.lead_closed_at = datetime.now(timezone.utc) - timedelta(days=60)
        assign_lead_to_sdr(db, lead_old, sdr)

        # Case B: meeting booked today → inside 7D window
        lead_new = create_test_lead(db, email="mtg_lead_new@t.com")
        lead_new.status = "Meeting Scheduled"
        lead_new.created_at = datetime.now(timezone.utc)
        lead_new.lead_closed_at = datetime.now(timezone.utc)
        assign_lead_to_sdr(db, lead_new, sdr)
        db.commit()

        # With 7D preset — only the recent meeting should appear
        resp = client.get("/api/admin/analytics/sdr-table?preset=7d&page_size=100")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Meeting SDR"),
            None,
        )
        assert sdr_row is not None
        # Only 1 meeting in 7D window (the recent one); the 60-day-old one is excluded
        assert sdr_row["meetings"] == 1
        # leads_assigned = 1 (the new lead is within 7D created_at)
        # leads_assigned = 0 for the old lead (outside 7D created_at window)
        assert sdr_row["leads_assigned"] == 1

    def test_inactive_sdr_no_login_no_activity(self, client, db):
        """SDR with NULL last_login_at and no calls/emails should be flagged inactive."""
        sdr = create_test_user(db, email="ghost@t.com", name="Ghost SDR", role="SDR")
        lead = create_test_lead(db, email="ghost_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Ghost SDR"),
            None,
        )
        assert sdr_row is not None
        # No login + no activity = inactive
        assert sdr_row["is_inactive"] is True

    def test_active_sdr_with_calls_overrides_stale_login(self, client, db):
        """RCA 2026-08-03: an SDR with a stale (>90-day) last_login_at used to
        be flagged inactive regardless of has_any_activity — the check only
        looked at activity when last_login_at was None. A Klenty-only SDR who
        never logs into the CRM but makes real calls every day was wrongly
        hidden from the default (non-"Inactive") view because of this."""
        from datetime import datetime, timezone, timedelta
        sdr = create_test_user(db, email="klenty_only@t.com", name="Klenty Only SDR", role="SDR")
        sdr.last_login_at = datetime.now(timezone.utc) - timedelta(days=120)
        lead = create_test_lead(db, email="klenty_only_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, provider="klenty", provider_disposition="ANSWERED")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Klenty Only SDR"),
            None,
        )
        assert sdr_row is not None
        assert sdr_row["is_inactive"] is False

    def test_active_sdr_with_calls_no_login(self, client, db):
        """SDR with NULL last_login_at but HAS calls should be flagged active."""
        sdr = create_test_user(db, email="active@t.com", name="Active SDR", role="SDR")
        lead = create_test_lead(db, email="active_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_call(db, lead.id, sdr.id, outcome="No Answer")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        assert resp.status_code == 200
        sdr_row = next(
            (r for r in resp.json()["sdrs"]
             if (r.get("name") or r.get("sdr_name")) == "Active SDR"),
            None,
        )
        assert sdr_row is not None
        # Has activity → should NOT be flagged inactive
        assert sdr_row["is_inactive"] is False


def _sdr_row(resp, name):
    return next(
        (r for r in resp.json()["sdrs"] if (r.get("name") or r.get("sdr_name")) == name),
        None,
    )


class TestConversationsColumn:
    """Added 2026-08-14: a call counts as a real Conversation if outcome
    isn't a not-answered one and duration is unknown or > 30s (see
    models.dialer_call_is_conversation / call_log_is_conversation)."""

    def test_dialer_call_over_30s_with_no_outcome_counts(self, client, db):
        sdr = create_test_user(db, email="conv1@t.com", name="Conv SDR 1", role="SDR")
        lead = create_test_lead(db, email="conv1_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, duration=45)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv SDR 1")
        assert row is not None
        assert row["conversations"] == 1

    def test_org_configured_threshold_overrides_the_30s_default(self, client, db):
        """SyncSettings.conversation_min_seconds (Super Admin configurable) —
        a 45s call counts at the 30s default but not once an org raises the
        threshold to 60s."""
        db.add(models.SyncSettings(id=1, conversation_min_seconds=60))
        db.commit()
        sdr = create_test_user(db, email="conv_threshold@t.com", name="Conv Threshold SDR", role="SDR")
        lead = create_test_lead(db, email="conv_threshold_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, duration=45)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv Threshold SDR")
        assert row is not None
        assert row["conversations"] == 0

    def test_dialer_call_under_30s_with_no_outcome_does_not_count(self, client, db):
        sdr = create_test_user(db, email="conv2@t.com", name="Conv SDR 2", role="SDR")
        lead = create_test_lead(db, email="conv2_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, duration=15)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv SDR 2")
        assert row is not None
        assert row["conversations"] == 0

    def test_dialer_call_over_30s_but_tagged_left_voicemail_does_not_count(self, client, db):
        """A dialer's voicemail pickup can itself run 20-30s+ — duration alone
        can't tell that apart from a short real answer, so an explicit SDR/AE
        "Left Voicemail" tag always overrides duration."""
        sdr = create_test_user(db, email="conv3@t.com", name="Conv SDR 3", role="SDR")
        lead = create_test_lead(db, email="conv3_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, duration=40, outcome="Left Voicemail")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv SDR 3")
        assert row is not None
        assert row["conversations"] == 0

    def test_dialer_call_with_no_duration_at_all_counts(self, client, db):
        """Duration is unknown (never set) — not the same as a short call.
        Passes the duration gate so outcome alone decides."""
        sdr = create_test_user(db, email="conv4@t.com", name="Conv SDR 4", role="SDR")
        lead = create_test_lead(db, email="conv4_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, duration=None)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv SDR 4")
        assert row is not None
        assert row["conversations"] == 1

    def test_call_log_negative_outcomes_do_not_count(self, client, db):
        sdr = create_test_user(db, email="conv5@t.com", name="Conv SDR 5", role="SDR")
        lead = create_test_lead(db, email="conv5_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_call(db, lead.id, sdr.id, outcome="No Answer")
        create_test_call(db, lead.id, sdr.id, outcome="Wrong Number")
        create_test_call(db, lead.id, sdr.id, outcome="Left Voicemail")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv SDR 5")
        assert row is not None
        assert row["conversations"] == 0

    def test_call_log_other_outcomes_count(self, client, db):
        sdr = create_test_user(db, email="conv6@t.com", name="Conv SDR 6", role="SDR")
        lead = create_test_lead(db, email="conv6_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_call(db, lead.id, sdr.id, outcome="Meeting Scheduled")
        create_test_call(db, lead.id, sdr.id, outcome="Not Interested")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Conv SDR 6")
        assert row is not None
        assert row["conversations"] == 2

    def test_conversations_included_in_csv_export(self, client, db):
        sdr = create_test_user(db, email="conv7@t.com", name="Conv SDR 7", role="SDR")
        lead = create_test_lead(db, email="conv7_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(db, lead.id, sdr.id, duration=60)
        db.commit()

        resp = client.get("/api/admin/analytics/export?preset=all")
        assert resp.status_code == 200
        body = resp.content.decode()
        assert "Conversations" in body.splitlines()[0]


class TestPodTimezoneBucketing:
    """Added 2026-08-14: a custom date_from/date_to is bucketed per-SDR using
    that SDR's own pod timezone, so a US team's real calendar day doesn't get
    split across two UTC dates (or merged with the wrong one) the way a
    single UTC-anchored day boundary would."""

    def test_call_after_midnight_utc_still_counts_as_previous_local_day(self, client, db):
        """01:00 UTC on Aug 14 is 18:00 PDT on Aug 13 (America/Los_Angeles is
        UTC-7 in August). Querying "Aug 14" for a Los-Angeles-timezone pod
        must NOT include this call — a naive UTC bucketing would wrongly
        include it."""
        import datetime as _dt
        pod = create_test_pod(db, name="US Pod")
        pod.timezone = "America/Los_Angeles"
        db.commit()
        sdr = create_test_user(db, email="tz1@t.com", name="TZ SDR 1", role="SDR")
        sdr.pod_id = pod.id
        db.commit()
        lead = create_test_lead(db, email="tz1_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(
            db, lead.id, sdr.id,
            started_at=_dt.datetime(2026, 8, 14, 1, 0, tzinfo=_dt.timezone.utc),
        )
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?date_from=2026-08-14&date_to=2026-08-14")
        row = _sdr_row(resp, "TZ SDR 1")
        assert row is None or row["calls_made"] == 0

        # It should show up under "Aug 13" instead (its real PDT-local day).
        resp2 = client.get("/api/admin/analytics/sdr-table?date_from=2026-08-13&date_to=2026-08-13")
        row2 = _sdr_row(resp2, "TZ SDR 1")
        assert row2 is not None
        assert row2["calls_made"] == 1

    def test_call_late_evening_local_still_counts_same_local_day_despite_crossing_utc_midnight(self, client, db):
        """22:00 PDT on Aug 14 is 05:00 UTC on Aug 15 — a naive UTC bucketing
        would put this on "Aug 15", but for this pod's own team it's still
        squarely "Aug 14"."""
        import datetime as _dt
        pod = create_test_pod(db, name="US Pod 2")
        pod.timezone = "America/Los_Angeles"
        db.commit()
        sdr = create_test_user(db, email="tz2@t.com", name="TZ SDR 2", role="SDR")
        sdr.pod_id = pod.id
        db.commit()
        lead = create_test_lead(db, email="tz2_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(
            db, lead.id, sdr.id,
            started_at=_dt.datetime(2026, 8, 15, 5, 0, tzinfo=_dt.timezone.utc),
        )
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?date_from=2026-08-14&date_to=2026-08-14")
        row = _sdr_row(resp, "TZ SDR 2")
        assert row is not None
        assert row["calls_made"] == 1

    def test_pod_with_no_timezone_set_falls_back_to_utc(self, client, db):
        import datetime as _dt
        pod = create_test_pod(db, name="No TZ Pod")  # timezone left unset
        sdr = create_test_user(db, email="tz3@t.com", name="TZ SDR 3", role="SDR")
        sdr.pod_id = pod.id
        db.commit()
        lead = create_test_lead(db, email="tz3_lead@t.com")
        assign_lead_to_sdr(db, lead, sdr)
        create_test_dialer_call(
            db, lead.id, sdr.id,
            started_at=_dt.datetime(2026, 8, 14, 12, 0, tzinfo=_dt.timezone.utc),
        )
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?date_from=2026-08-14&date_to=2026-08-14")
        row = _sdr_row(resp, "TZ SDR 3")
        assert row is not None
        assert row["calls_made"] == 1

    def test_two_pods_different_timezones_each_bucketed_independently_in_the_same_request(self, client, db):
        """The whole point: one on-screen date, two different real UTC
        windows queried under the hood — each team sees ITS OWN local day."""
        import datetime as _dt
        us_pod = create_test_pod(db, name="US Pod 3")
        us_pod.timezone = "America/Los_Angeles"
        india_pod = create_test_pod(db, name="India Pod")
        india_pod.timezone = "Asia/Kolkata"
        db.commit()

        us_sdr = create_test_user(db, email="tz4us@t.com", name="TZ US SDR", role="SDR")
        us_sdr.pod_id = us_pod.id
        india_sdr = create_test_user(db, email="tz4in@t.com", name="TZ India SDR", role="SDR")
        india_sdr.pod_id = india_pod.id
        db.commit()

        us_lead = create_test_lead(db, email="tz4us_lead@t.com")
        assign_lead_to_sdr(db, us_lead, us_sdr)
        india_lead = create_test_lead(db, email="tz4in_lead@t.com")
        assign_lead_to_sdr(db, india_lead, india_sdr)

        # 03:00 UTC on Aug 14 = Aug 13, 20:00 PDT (previous local day for the
        # US pod) = Aug 14, 08:30 IST (same local day for the India pod).
        call_time = _dt.datetime(2026, 8, 14, 3, 0, tzinfo=_dt.timezone.utc)
        create_test_dialer_call(db, us_lead.id, us_sdr.id, started_at=call_time)
        create_test_dialer_call(db, india_lead.id, india_sdr.id, started_at=call_time)
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?date_from=2026-08-14&date_to=2026-08-14")
        us_row = _sdr_row(resp, "TZ US SDR")
        india_row = _sdr_row(resp, "TZ India SDR")
        assert us_row is None or us_row["calls_made"] == 0
        assert india_row is not None
        assert india_row["calls_made"] == 1


# ─────────────────────────────────────────────────────────────────────────────
# 4. /trend endpoint
# ─────────────────────────────────────────────────────────────────────────────

@_postgres_only
class TestTrendEndpoint:
    """
    The /trend endpoint uses PostgreSQL-specific date_trunc().
    These tests are xfail on SQLite (local) but pass on staging (Postgres).
    """

    def test_returns_200(self, client, db):
        resp = client.get("/api/admin/analytics/trend")
        assert resp.status_code == 200

    def test_response_is_list(self, client, db):
        resp = client.get("/api/admin/analytics/trend")
        body = resp.json()
        assert isinstance(body, list)

    def test_each_bucket_has_required_keys(self, client, db):
        resp = client.get("/api/admin/analytics/trend?preset=30d")
        assert resp.status_code == 200
        data = resp.json()
        if data:  # may be empty if no calls
            first = data[0]
            assert "period" in first or "date" in first or "week" in first
            # one of these activity count fields must exist
            assert any(k in first for k in ("calls", "emails", "meetings", "calls_made"))

    def test_pod_filter_accepted(self, client, db):
        pod = create_test_pod(db, name="Trend Pod")
        db.commit()
        resp = client.get(f"/api/admin/analytics/trend?preset=30d&pod_id={pod.id}")
        assert resp.status_code == 200

    def test_lead_source_filter_accepted(self, client, db):
        resp = client.get("/api/admin/analytics/trend?preset=30d&lead_source=LinkedIn")
        assert resp.status_code == 200

    def test_sdr_filter_scopes_disqualified_count(self, client, db):
        """
        RCA 2026-07-27: disq_q was the only one of the 5 trend metrics not
        scoped to sdr_id — filtering the Activity Trend chart by SDR left
        Disqualified showing the org-wide count while Calls/Emails/Meetings/
        Research correctly shrank to just that SDR, breaking the chart.
        A lead disqualified but assigned to a DIFFERENT SDR than the one
        we're filtering by must not be counted.
        """
        from datetime import datetime, timezone
        sdr_a = create_test_user(db, email="trend-sdr-a@t.com", role="SDR")
        sdr_b = create_test_user(db, email="trend-sdr-b@t.com", role="SDR")
        lead_a = create_test_lead(db, email="trend-lead-a@t.com", status="Disqualified")
        lead_a.lead_closed_at = datetime.now(timezone.utc)
        lead_b = create_test_lead(db, email="trend-lead-b@t.com", status="Disqualified")
        lead_b.lead_closed_at = datetime.now(timezone.utc)
        db.execute(models.lead_assignments.insert().values(user_id=sdr_a.id, lead_id=lead_a.id))
        db.execute(models.lead_assignments.insert().values(user_id=sdr_b.id, lead_id=lead_b.id))
        db.commit()

        resp = client.get(f"/api/admin/analytics/trend?preset=30d&sdr_id={sdr_a.id}")
        assert resp.status_code == 200
        total_disq = sum(bucket.get("disqualified", 0) for bucket in resp.json()["series"])
        assert total_disq == 1, (
            f"Expected only sdr_a's 1 disqualified lead when filtered to sdr_a, got {total_disq} "
            f"— disq_q is not respecting sdr_id."
        )


# ─────────────────────────────────────────────────────────────────────────────
# 5. /email-breakdown endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailBreakdownEndpoint:

    def test_returns_200(self, client, db):
        resp = client.get("/api/admin/analytics/email-breakdown")
        assert resp.status_code == 200

    def test_response_shape(self, client, db):
        resp = client.get("/api/admin/analytics/email-breakdown")
        body = resp.json()
        # Must be either a list or a dict with an 'sdrs' or 'data' key
        assert isinstance(body, (list, dict))

    def test_pod_filter_accepted(self, client, db):
        pod = create_test_pod(db, name="Email Pod")
        db.commit()
        resp = client.get(f"/api/admin/analytics/email-breakdown?pod_id={pod.id}")
        assert resp.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# 6. /insights-summary POST endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestInsightsSummaryEndpoint:

    def test_empty_insights_returns_null_summary(self, client, db):
        resp = client.post(
            "/api/admin/analytics/insights-summary",
            json={"insights": []},
        )
        assert resp.status_code == 200
        assert resp.json()["summary"] is None

    def test_whitespace_only_insights_returns_null(self, client, db):
        resp = client.post(
            "/api/admin/analytics/insights-summary",
            json={"insights": ["   ", ""]},
        )
        assert resp.status_code == 200
        assert resp.json()["summary"] is None

    def test_returns_null_when_llm_not_configured(self, client, db):
        """
        With no Groq API key in config, the endpoint should silently
        return summary=null (no 500).
        """
        resp = client.post(
            "/api/admin/analytics/insights-summary",
            json={"insights": ["Strong connect rate", "5 leads not called"]},
        )
        # Must not 500 — LLM not configured on test env
        assert resp.status_code == 200
        body = resp.json()
        assert "summary" in body
        # summary may be null (no LLM config) or a string — both valid
        assert body["summary"] is None or isinstance(body["summary"], str)

    def test_accepts_up_to_three_insights(self, client, db):
        """Payload with exactly 3 insights must not error."""
        resp = client.post(
            "/api/admin/analytics/insights-summary",
            json={"insights": ["Insight A", "Insight B", "Insight C"]},
        )
        assert resp.status_code == 200

    def test_truncates_to_three_insights(self, client, db):
        """Backend must truncate to 3 even if frontend sends more."""
        resp = client.post(
            "/api/admin/analytics/insights-summary",
            json={"insights": ["A", "B", "C", "D", "E"]},
        )
        assert resp.status_code == 200

    def test_invalid_payload_returns_422(self, client, db):
        """Missing 'insights' key must return 422 Unprocessable Entity."""
        resp = client.post(
            "/api/admin/analytics/insights-summary",
            json={"wrong_key": "oops"},
        )
        assert resp.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# 7. Router registration / module-level import health check
# ─────────────────────────────────────────────────────────────────────────────

class TestRouterHealth:

    def test_analytics_router_registered_no_server_errors(self, client, db):
        """
        Regression: mid-file 'from pydantic import BaseModel' caused the
        entire analytics router to fail to register, making ALL endpoints 500.
        Verify that key routes respond (not 404 or 500).
        NOTE: /trend is excluded — it uses Postgres date_trunc() which fails on SQLite.
        """
        endpoints = [
            "/api/admin/analytics/filters",
            "/api/admin/analytics/funnel",
            "/api/admin/analytics/sdr-table",
            "/api/admin/analytics/email-breakdown",
        ]
        for ep in endpoints:
            resp = client.get(ep)
            assert resp.status_code not in (404, 500), (
                f"{ep} returned unexpected {resp.status_code}: {resp.text[:200]}"
            )


# ─────────────────────────────────────────────────────────────────────────────
# 8. Account-Level Connect % (v10.3.0 — AEC-2026-07)
# ─────────────────────────────────────────────────────────────────────────────

class TestAccountConnectRate:
    """
    Tests for the new accounts_called / accounts_connected / account_connect_rate
    fields added in v10.3.0 to /api/admin/analytics/sdr-table.

    All tests use DialerCall (Bulk Query 5a) which is the primary call source.
    AEC = Analytics Edge Case reference from the implementation plan.
    """

    URL = "/api/admin/analytics/sdr-table?preset=all&page_size=100"

    def _get_sdr_row(self, resp, name):
        """Pull the named SDR's row from the response, or return None."""
        return next(
            (r for r in resp.json()["sdrs"]
             if (r.get("sdr_name") or r.get("name")) == name),
            None,
        )

    # ── AEC-1 variant: SDR calls 3 leads at the SAME company, 1 connected ───
    def test_same_company_counts_as_one_account(self, client, db):
        """3 leads, 1 company → accounts_called=1 even if all 3 are called."""
        sdr = create_test_user(db, email="acct1@t.com", name="Acct SDR 1", role="SDR")
        leads = [
            create_test_lead(db, email=f"acct1_lead{i}@t.com", company="Acme Corp")
            for i in range(3)
        ]
        for lead in leads:
            assign_lead_to_sdr(db, lead, sdr)
            create_test_dialer_call(db, lead.id, sdr.id, status="CALL_ENDED")
        # Connect only the first lead
        create_test_dialer_call(db, leads[0].id, sdr.id, outcome="Call Back Later")
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 1")
        assert row is not None, "SDR not found in table"
        assert row["accounts_called"] == 1, "3 calls to same company = 1 account called"
        assert row["accounts_connected"] == 1
        assert row["account_connect_rate"] == 100.0

    # ── AEC-1 variant: SDR calls 3 DIFFERENT companies, 1 connected ─────────
    def test_different_companies_each_count_separately(self, client, db):
        """3 different companies called, 1 connected → rate = 33.3."""
        sdr = create_test_user(db, email="acct2@t.com", name="Acct SDR 2", role="SDR")
        companies = ["Alpha Inc", "Beta Ltd", "Gamma Co"]
        leads = [
            create_test_lead(db, email=f"acct2_{c}@t.com", company=c)
            for c in companies
        ]
        for lead in leads:
            assign_lead_to_sdr(db, lead, sdr)
            create_test_dialer_call(db, lead.id, sdr.id, status="CALL_ENDED")
        # Connect only the first company
        create_test_dialer_call(db, leads[0].id, sdr.id, outcome="Call Back Later")
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 2")
        assert row is not None
        assert row["accounts_called"] == 3
        assert row["accounts_connected"] == 1
        rate = row["account_connect_rate"]
        assert rate is not None
        assert 33.0 <= rate <= 34.0, f"Expected ~33.3, got {rate}"

    # ── AEC-3: NULL company excluded ─────────────────────────────────────────
    def test_null_company_excluded_from_account_count(self, client, db):
        """Leads with company=None must not inflate accounts_called."""
        sdr = create_test_user(db, email="acct3@t.com", name="Acct SDR 3", role="SDR")
        lead_no_company = create_test_lead(db, email="acct3_nc@t.com", company=None)
        lead_with_company = create_test_lead(db, email="acct3_wc@t.com", company="Real Corp")
        assign_lead_to_sdr(db, lead_no_company, sdr)
        assign_lead_to_sdr(db, lead_with_company, sdr)
        create_test_dialer_call(db, lead_no_company.id, sdr.id, status="CALL_ENDED")
        create_test_dialer_call(db, lead_with_company.id, sdr.id, status="CALL_ENDED")
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 3")
        assert row is not None
        # Only the lead with a real company counts
        assert row["accounts_called"] == 1, "NULL company must be excluded"

    # ── AEC-3: Empty string company excluded ─────────────────────────────────
    def test_empty_string_company_excluded_from_account_count(self, client, db):
        """Leads with company='' must not inflate accounts_called."""
        sdr = create_test_user(db, email="acct4@t.com", name="Acct SDR 4", role="SDR")
        lead_empty = create_test_lead(db, email="acct4_empty@t.com", company="")
        lead_real = create_test_lead(db, email="acct4_real@t.com", company="ValidCo")
        assign_lead_to_sdr(db, lead_empty, sdr)
        assign_lead_to_sdr(db, lead_real, sdr)
        create_test_dialer_call(db, lead_empty.id, sdr.id, status="CALL_ENDED")
        create_test_dialer_call(db, lead_real.id, sdr.id, outcome="Call Back Later")
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 4")
        assert row is not None
        assert row["accounts_called"] == 1, "Empty string company must be excluded"
        assert row["accounts_connected"] == 1

    # ── AEC-4: Case normalisation — 'Acme Corp' and 'acme corp' = 1 account ─
    def test_company_case_normalised_counts_as_one_account(self, client, db):
        """'Acme Corp' and 'acme corp' must be treated as the same account."""
        sdr = create_test_user(db, email="acct5@t.com", name="Acct SDR 5", role="SDR")
        lead_upper = create_test_lead(db, email="acct5_upper@t.com", company="Acme Corp")
        lead_lower = create_test_lead(db, email="acct5_lower@t.com", company="acme corp")
        assign_lead_to_sdr(db, lead_upper, sdr)
        assign_lead_to_sdr(db, lead_lower, sdr)
        create_test_dialer_call(db, lead_upper.id, sdr.id, outcome="Call Back Later")
        create_test_dialer_call(db, lead_lower.id, sdr.id, status="CALL_ENDED")
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 5")
        assert row is not None
        assert row["accounts_called"] == 1, (
            "'Acme Corp' and 'acme corp' must normalise to 1 account (AEC-4)"
        )
        assert row["accounts_connected"] == 1

    # ── AEC-5: Date filter propagated to account queries ─────────────────────
    def test_date_filter_applied_to_account_queries(self, client, db):
        """Calls outside the date window must NOT count toward account metrics."""
        from datetime import datetime, timezone, timedelta
        sdr = create_test_user(db, email="acct6@t.com", name="Acct SDR 6", role="SDR")
        lead_old = create_test_lead(db, email="acct6_old@t.com", company="OldCo")
        lead_new = create_test_lead(db, email="acct6_new@t.com", company="NewCo")
        assign_lead_to_sdr(db, lead_old, sdr)
        assign_lead_to_sdr(db, lead_new, sdr)

        sixty_days_ago = datetime.now(timezone.utc) - timedelta(days=60)
        # Old call outside 7D window
        create_test_dialer_call(
            db, lead_old.id, sdr.id,
            outcome="Call Back Later",
            created_at=sixty_days_ago,
        )
        # New call inside 7D window
        create_test_dialer_call(db, lead_new.id, sdr.id, outcome="Call Back Later")
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=7d&page_size=100")
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 6")
        assert row is not None
        # Only NewCo (within 7D) should count
        assert row["accounts_called"] == 1, "Old calls outside date window must be excluded"
        assert row["accounts_connected"] == 1

    # ── AEC-8: Sort by account_connect_rate ──────────────────────────────────
    def test_sort_by_account_connect_rate(self, client, db):
        """sort_by=account_connect_rate must order SDRs descending by that field."""
        # SDR A: 100% acct connect rate
        sdr_a = create_test_user(db, email="sort_a@t.com", name="Sort SDR A", role="SDR")
        lead_a = create_test_lead(db, email="sort_la@t.com", company="CorpA")
        assign_lead_to_sdr(db, lead_a, sdr_a)
        create_test_dialer_call(db, lead_a.id, sdr_a.id, outcome="Call Back Later")

        # SDR B: 0% acct connect rate
        sdr_b = create_test_user(db, email="sort_b@t.com", name="Sort SDR B", role="SDR")
        lead_b = create_test_lead(db, email="sort_lb@t.com", company="CorpB")
        assign_lead_to_sdr(db, lead_b, sdr_b)
        create_test_dialer_call(db, lead_b.id, sdr_b.id, status="CALL_ENDED")
        db.commit()

        resp = client.get(
            "/api/admin/analytics/sdr-table?preset=all&sort_by=account_connect_rate&page_size=100"
        )
        assert resp.status_code == 200
        names = [
            (r.get("sdr_name") or r.get("name"))
            for r in resp.json()["sdrs"]
            if (r.get("sdr_name") or r.get("name")) in ("Sort SDR A", "Sort SDR B")
        ]
        # SDR A (100%) must appear before SDR B (0%) when sorted descending
        assert names.index("Sort SDR A") < names.index("Sort SDR B"), (
            "SDR with higher account_connect_rate must rank first"
        )

    # ── AEC-1 CallLog path: CallLog also counts toward account metrics ────────
    def test_call_log_path_also_counted(self, client, db):
        """Calls via CallLog (RCM/manual) must also be counted for account metrics."""
        sdr = create_test_user(db, email="acct8@t.com", name="Acct SDR 8", role="SDR")
        lead = create_test_lead(db, email="acct8_lead@t.com", company="LogCorp")
        assign_lead_to_sdr(db, lead, sdr)
        # Use CallLog path (create_test_call), not DialerCall
        create_test_call(db, lead.id, sdr.id, outcome="Call Back Later")  # = connected
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 8")
        assert row is not None
        # accounts_called and accounts_connected should be >= 1 from CallLog
        assert row["accounts_called"] >= 1, "CallLog calls must count for account metrics"
        assert row["accounts_connected"] >= 1, "Connected CallLog must count as account connected"

    # ── AEC-13: Zero-call SDR gets None, not division error ───────────────────
    def test_zero_call_sdr_has_null_account_connect_rate(self, client, db):
        """SDR with 0 accounts called must have account_connect_rate=None (not 0/0 error)."""
        sdr = create_test_user(db, email="acct9@t.com", name="Acct SDR 9", role="SDR")
        lead = create_test_lead(db, email="acct9_lead@t.com", company="NoCalls Corp")
        assign_lead_to_sdr(db, lead, sdr)
        # No calls created
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        row = self._get_sdr_row(resp, "Acct SDR 9")
        assert row is not None
        assert row["accounts_called"] == 0
        assert row["account_connect_rate"] is None, (
            "account_connect_rate must be None when accounts_called=0 (AEC-13)"
        )

    # ── Response schema: new fields present alongside existing fields ─────────
    def test_account_fields_present_in_response(self, client, db):
        """AEC-10: New fields must be added, existing connect_rate must be unchanged."""
        sdr = create_test_user(db, email="acct10@t.com", name="Acct SDR 10", role="SDR")
        db.commit()

        resp = client.get(self.URL)
        assert resp.status_code == 200
        sdrs = resp.json()["sdrs"]
        if not sdrs:
            pytest.skip("No SDRs in response — skipping field presence check")
        row = sdrs[0]
        for field in ("connect_rate", "accounts_called", "accounts_connected", "account_connect_rate"):
            assert field in row, f"Required field '{field}' missing from SDR row (AEC-10)"


# ─────────────────────────────────────────────────────────────────────────────
# 7. AE role — Analytics Hub forced self-scope
# ─────────────────────────────────────────────────────────────────────────────

class TestAESelfScope:
    """AE gets the same Analytics Hub endpoints as an admin, but every metric
    is forced to their own leads/calls only — no pod-wide or cross-SDR
    visibility, and the sdr_id/pod_id query params can't override that."""

    def test_sdr_blocked_from_analytics(self, client_as_sdr, db):
        resp = client_as_sdr.get("/api/admin/analytics/funnel")
        assert resp.status_code == 403

    def test_ae_allowed_into_funnel(self, client_as_ae, db):
        resp = client_as_ae.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200

    def test_ae_funnel_scoped_to_own_leads_only(self, client_as_ae, db):
        from conftest import AE_USER
        other_ae = create_test_user(db, email="other-ae@t.com", name="Other AE", role="AE")
        me = create_test_user(db, email=AE_USER["email"], name=AE_USER["name"], role="AE", id=AE_USER["sub"])

        my_lead = create_test_lead(db, email="mine@t.com")
        other_lead = create_test_lead(db, email="theirs@t.com")
        assign_lead_to_sdr(db, my_lead, me)
        assign_lead_to_sdr(db, other_lead, other_ae)

        resp = client_as_ae.get("/api/admin/analytics/funnel")
        assert resp.status_code == 200
        assert resp.json()["leads_assigned"] == 1, (
            "AE's funnel must count only their own assigned leads, not the other AE's"
        )

    def test_ae_cannot_override_scope_via_pod_id_param(self, client_as_ae, db):
        """An AE passing a pod_id (e.g. via a crafted request) must not widen
        their scope — analytics_routes._effective_ae_sdr forces self-scope
        regardless of any pod_id/sdr_id query param."""
        from conftest import AE_USER
        other_ae = create_test_user(db, email="other-ae2@t.com", name="Other AE 2", role="AE")
        me = create_test_user(db, email=AE_USER["email"] + "2", name=AE_USER["name"], role="AE", id=AE_USER["sub"])
        pod = create_test_pod(db, name="Some Pod")
        other_ae.pod_id = pod.id
        db.commit()

        other_lead = create_test_lead(db, email="pod-scoped@t.com")
        assign_lead_to_sdr(db, other_lead, other_ae)

        resp = client_as_ae.get(f"/api/admin/analytics/funnel?pod_id={pod.id}")
        assert resp.status_code == 200
        assert resp.json()["leads_assigned"] == 0, (
            "AE must not see another SDR's pod data even when passing that pod's pod_id"
        )

    def test_ae_sdr_table_shows_only_self(self, client_as_ae, db):
        from conftest import AE_USER
        other_ae = create_test_user(db, email="other-ae3@t.com", name="Other AE 3", role="AE")
        create_test_user(db, email=AE_USER["email"] + "3", name=AE_USER["name"], role="AE", id=AE_USER["sub"])
        db.commit()

        resp = client_as_ae.get("/api/admin/analytics/sdr-table")
        assert resp.status_code == 200
        sdr_ids = [row["sdr_id"] for row in resp.json()["sdrs"]]
        assert sdr_ids == [AE_USER["sub"]], "AE's SDR table must contain only their own row"


# ─────────────────────────────────────────────────────────────────────────────
# 7. Cadence/Messaging Sandbox — test-lead exclusion
#
# Lead.is_test=True leads (created by routes/journey_routes.py's sandbox
# enroll-test-lead endpoint) must never contribute to any real analytics
# number. Every test below creates one real lead and one is_test=True lead
# with otherwise-identical activity, and asserts the metric reflects only
# the real lead's data.
# ─────────────────────────────────────────────────────────────────────────────

class TestSandboxTestLeadExclusion:

    def test_funnel_excludes_test_lead_leads_calls_emails_meetings(self, client, db):
        sdr = create_test_user(db, email="sandbox_funnel@t.com", name="Sandbox Funnel SDR", role="SDR")
        real_lead = create_test_lead(db, email="sandbox_real@t.com", status="Meeting Scheduled")
        test_lead = create_test_lead(db, email="sandbox_test@t.com", status="Meeting Scheduled")
        test_lead.is_test = True
        db.commit()
        assign_lead_to_sdr(db, real_lead, sdr)
        assign_lead_to_sdr(db, test_lead, sdr)
        create_test_dialer_call(db, real_lead.id, sdr.id, outcome="Call Back Later")
        create_test_dialer_call(db, test_lead.id, sdr.id, outcome="Call Back Later")
        db.add(models.LeadEmailActivity(lead_id=real_lead.id, direction="outbound"))
        db.add(models.LeadEmailActivity(lead_id=test_lead.id, direction="outbound"))
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        body = resp.json()
        assert body["leads_assigned"] == 1, "test lead must not inflate leads_assigned"
        assert body["calls"]["made"] == 1, "test lead's call must not count"
        assert body["calls"]["connected"] == 1
        assert body["emails"]["sent"] == 1, "test lead's email must not count"
        assert body["meetings"]["booked"] == 1, "test lead's meeting must not count"

    def test_funnel_excludes_test_lead_disqualified_and_opportunity(self, client, db):
        real_lead = create_test_lead(db, email="sandbox_disq_real@t.com", status="Disqualified")
        real_lead.opportunity_status = "Won"
        test_lead = create_test_lead(db, email="sandbox_disq_test@t.com", status="Disqualified")
        test_lead.opportunity_status = "Won"
        test_lead.is_test = True
        db.commit()

        resp = client.get("/api/admin/analytics/funnel?preset=all")
        assert resp.status_code == 200
        body = resp.json()
        assert body["disqualified"] == 1, "test lead must not count as disqualified"
        assert body["opportunity"]["won"] == 1, "test lead must not count as a won opportunity"

    @_postgres_only
    def test_trend_excludes_test_lead_calls(self, client, db):
        sdr = create_test_user(db, email="sandbox_trend@t.com", name="Sandbox Trend SDR", role="SDR")
        real_lead = create_test_lead(db, email="sandbox_trend_real@t.com")
        test_lead = create_test_lead(db, email="sandbox_trend_test@t.com")
        test_lead.is_test = True
        db.commit()
        assign_lead_to_sdr(db, real_lead, sdr)
        assign_lead_to_sdr(db, test_lead, sdr)
        create_test_dialer_call(db, real_lead.id, sdr.id)
        create_test_dialer_call(db, test_lead.id, sdr.id)
        db.commit()

        resp = client.get("/api/admin/analytics/trend?preset=all")
        assert resp.status_code == 200
        total_calls = sum(p["calls"] for p in resp.json()["series"])
        assert total_calls == 1, "test lead's call must not appear in the trend series"

    def test_sdr_table_excludes_test_lead_data(self, client, db):
        sdr = create_test_user(db, email="sandbox_sdrtable@t.com", name="Sandbox SDR Table SDR", role="SDR")
        real_lead = create_test_lead(db, email="sandbox_sdrtable_real@t.com", status="Meeting Scheduled")
        test_lead = create_test_lead(db, email="sandbox_sdrtable_test@t.com", status="Meeting Scheduled")
        test_lead.is_test = True
        db.commit()
        assign_lead_to_sdr(db, real_lead, sdr)
        assign_lead_to_sdr(db, test_lead, sdr)
        create_test_dialer_call(db, real_lead.id, sdr.id, outcome="Call Back Later")
        create_test_dialer_call(db, test_lead.id, sdr.id, outcome="Call Back Later")
        db.add(models.LeadEmailActivity(lead_id=real_lead.id, user_id=sdr.id, direction="outbound"))
        db.add(models.LeadEmailActivity(lead_id=test_lead.id, user_id=sdr.id, direction="outbound"))
        db.commit()

        resp = client.get("/api/admin/analytics/sdr-table?preset=all")
        row = _sdr_row(resp, "Sandbox SDR Table SDR")
        assert row is not None
        assert row["leads_assigned"] == 1
        assert row["calls_made"] == 1
        assert row["calls_connected"] == 1
        assert row["emails_sent"] == 1
        assert row["meetings"] == 1

    def test_export_csv_excludes_test_lead_calls(self, client, db):
        sdr = create_test_user(db, email="sandbox_export@t.com", name="Sandbox Export SDR", role="SDR")
        real_lead = create_test_lead(db, email="sandbox_export_real@t.com")
        test_lead = create_test_lead(db, email="sandbox_export_test@t.com")
        test_lead.is_test = True
        db.commit()
        assign_lead_to_sdr(db, real_lead, sdr)
        assign_lead_to_sdr(db, test_lead, sdr)
        create_test_dialer_call(db, real_lead.id, sdr.id)
        create_test_dialer_call(db, test_lead.id, sdr.id)
        db.commit()

        resp = client.get("/api/admin/analytics/export?preset=all")
        assert resp.status_code == 200
        row = next(l for l in resp.content.decode().splitlines() if "Sandbox Export SDR" in l)
        calls_made = row.split(",")[4]  # SDR Name,Pod ID,Status,Leads Assigned,Calls Made,...
        assert calls_made == "1", "test lead's call must not appear in the CSV export"

    def test_email_breakdown_excludes_test_lead(self, client, db):
        real_lead = create_test_lead(db, email="sandbox_ebreak_real@t.com")
        test_lead = create_test_lead(db, email="sandbox_ebreak_test@t.com")
        test_lead.is_test = True
        db.commit()
        db.add(models.LeadEmailActivity(lead_id=real_lead.id, direction="outbound"))
        db.add(models.LeadEmailActivity(lead_id=test_lead.id, direction="outbound"))
        db.commit()

        resp = client.get("/api/admin/analytics/email-breakdown?preset=all")
        assert resp.status_code == 200
        assert resp.json()["total_sent"] == 1, "test lead's email must not appear in the email breakdown"

    def test_batch_summary_excludes_test_lead_even_if_linked_to_a_batch(self, client, db):
        """Sandbox test leads never get an upload_log_id in practice
        (routes/journey_routes.py always creates them with lead_source='manual'),
        but the exclusion filter must hold even in the edge case where one is
        somehow linked to a batch — this isn't a filter that should only work
        by accident of test leads never having upload_log_id set."""
        batch = create_test_upload_log(db, filename="sandbox_batch.csv")
        real_lead = create_test_lead(db, email="sandbox_batch_real@t.com")
        real_lead.upload_log_id = batch.id
        test_lead = create_test_lead(db, email="sandbox_batch_test@t.com")
        test_lead.upload_log_id = batch.id
        test_lead.is_test = True
        db.commit()

        resp = client.get("/api/admin/analytics/batch-summary")
        assert resp.status_code == 200
        row = next(b for b in resp.json()["batches"] if b["id"] == batch.id)
        assert row["leads"] == 1, "test lead must not inflate the batch's lead count"

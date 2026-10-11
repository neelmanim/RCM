"""
Tests for the Phase 1 Semantic Layer (backend/analytics/semantic.py +
adapters.py). Focus: scope enforcement, the event-vs-snapshot correction for
Meetings Scheduled / Disqualified, and data-quality warnings — the specific
things the Phase 0 audit flagged and the master doc's approved business
decisions require.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timedelta, timezone

import pytest

from conftest import (
    create_test_pod,
    create_test_user,
    create_test_lead,
    create_test_dialer_call,
    create_email_activity,
    create_email_thread,
    _make_user_payload,
)
import models
from analytics.semantic import resolve_metric, UnknownMetricError
from analytics.adapters import _validate_rate, _validate_count, _validate_paired_counts


def _set(db, obj, **fields):
    for k, v in fields.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


def test_unknown_metric_raises():
    admin = _make_user_payload("Super Admin")
    with pytest.raises(UnknownMetricError):
        resolve_metric("close_rate", None, admin)


def test_connect_rate_envelope_shape(db):
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P1")
    sdr = create_test_user(db, email="sdr1@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="lead1@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")  # connected
    create_test_dialer_call(db, lead.id, sdr.id, outcome="No Answer")   # not connected

    envelope = resolve_metric("connect_rate", db, admin)
    assert envelope["metric"]["id"] == "connect_rate"
    assert envelope["metric"]["version"] == 1
    assert envelope["metric"]["unit"] == "percent"
    assert envelope["value"] == 50.0
    assert envelope["explanation"]["numerator"] == 1
    assert envelope["explanation"]["denominator"] == 2
    # Registry text describing what the raw numbers mean — not just the bare
    # integers (ponytail-audit: these registry fields existed but were never
    # wired into the envelope until now).
    assert "connected" in envelope["explanation"]["numerator_label"].lower()
    assert "calls made" in envelope["explanation"]["denominator_label"].lower()
    assert envelope["explanation"]["date_basis"] == "call_event_time"
    assert "filters_applied" in envelope["explanation"]
    assert envelope["explanation"]["warnings"] == []


def test_pod_admin_scoped_to_own_pod(db):
    pod_a = create_test_pod(db, name="Pod A")
    pod_b = create_test_pod(db, name="Pod B")
    sdr_a = create_test_user(db, email="a@t.com", role="SDR", pod_id=pod_a.id)
    sdr_b = create_test_user(db, email="b@t.com", role="SDR", pod_id=pod_b.id)
    lead_a = create_test_lead(db, email="la@t.com", pod_id=pod_a.id)
    lead_b = create_test_lead(db, email="lb@t.com", pod_id=pod_b.id)
    create_test_dialer_call(db, lead_a.id, sdr_a.id, outcome="Interested")
    create_test_dialer_call(db, lead_b.id, sdr_b.id, outcome="Interested")

    pod_admin = _make_user_payload("Pod Admin", "pa-1", "pa@t.com", "PA", pod_id=pod_a.id)
    envelope = resolve_metric("connect_rate", db, pod_admin)
    # Server-side scope: Pod Admin sees only Pod A's call, never Pod B's,
    # regardless of what pod_id_param it's given (docs §15 — never trust
    # frontend filters for authorization).
    assert envelope["explanation"]["denominator"] == 1


def test_meetings_scheduled_is_event_not_snapshot(db):
    """Master-doc example, verbatim: a lead that entered Meeting Scheduled
    last period but is now Disqualified must still count for last period."""
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    in_range = datetime.now(timezone.utc) - timedelta(days=3)
    lead = create_test_lead(db, email="ms@t.com", pod_id=pod.id, status="Disqualified")
    _set(db, lead, meeting_scheduled_at=in_range, lead_closed_at=datetime.now(timezone.utc))

    envelope = resolve_metric(
        "meetings_scheduled", db, admin,
        date_from=(in_range - timedelta(days=1)).date().isoformat(),
        date_to=(in_range + timedelta(days=1)).date().isoformat(),
    )
    assert envelope["value"] == 1


def test_disqualified_only_counts_canonical_status(db):
    """Only status == 'Disqualified' counts for the canonical event metric —
    legacy outcome-as-status values ('Not Interested' etc.) that the current
    app no longer writes to Lead.status do NOT count, unlike the legacy
    Dashboard snapshot (see registry.py's known_caveats)."""
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    now = datetime.now(timezone.utc)
    disqualified_lead = create_test_lead(db, email="d1@t.com", pod_id=pod.id, status="Disqualified")
    _set(db, disqualified_lead, lead_closed_at=now)
    legacy_status_lead = create_test_lead(db, email="d2@t.com", pod_id=pod.id, status="Not Interested")
    _set(db, legacy_status_lead, lead_closed_at=now)

    envelope = resolve_metric(
        "disqualified", db, admin,
        date_from=(now - timedelta(days=1)).date().isoformat(),
        date_to=(now + timedelta(days=1)).date().isoformat(),
    )
    assert envelope["value"] == 1


def test_leads_assigned_excludes_parked_and_test_leads(db):
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    create_test_lead(db, email="real@t.com", pod_id=pod.id, status="Lead Assigned")
    parked = create_test_lead(db, email="parked@t.com", pod_id=pod.id, status="Lead Assigned")
    _set(db, parked, status="No Phone - Parked")
    assert "No Phone - Parked" in models.PARKED_STATUSES

    envelope = resolve_metric("leads_assigned", db, admin)
    assert envelope["value"] == 1


def test_account_connect_rate_sums_across_scope(db):
    # "Account" = distinct Lead.company (see analytics_routes._compute_sdr_rows'
    # account_agg — grouped by lower(Lead.company), not by lead id) — each test
    # lead needs its OWN company or they collapse into one account.
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="s@t.com", role="SDR", pod_id=pod.id)
    lead1 = create_test_lead(db, email="l1@t.com", pod_id=pod.id, company="Acme")
    lead2 = create_test_lead(db, email="l2@t.com", pod_id=pod.id, company="Globex")
    create_test_dialer_call(db, lead1.id, sdr.id, outcome="Interested")  # account 1: connected
    create_test_dialer_call(db, lead2.id, sdr.id, outcome="No Answer")   # account 2: called, not connected

    envelope = resolve_metric("account_connect_rate", db, admin)
    assert envelope["explanation"]["denominator"] == 2   # 2 accounts called
    assert envelope["explanation"]["numerator"] == 1      # 1 account connected
    assert envelope["value"] == 50.0


# ─── Data-quality validation (docs §23) ──────────────────────────────────────

def test_validate_rate_flags_out_of_range():
    assert _validate_rate(150, 15, 10) != []
    assert _validate_rate(-5, 0, 10) != []
    assert _validate_rate(50, 5, 10) == []


def test_validate_rate_flags_numerator_exceeding_denominator():
    warnings = _validate_rate(100, 15, 10)
    assert any("exceeds" in w for w in warnings)


def test_validate_count_flags_negative():
    assert _validate_count(-1) != []
    assert _validate_count(0) == []
    assert _validate_count(5) == []


def test_validate_paired_counts_flags_subset_violation():
    warnings = _validate_paired_counts("connected_calls", 11, "conversations", 13)
    assert any("expected connected_calls >= conversations" in w for w in warnings)


def test_validate_paired_counts_allows_equal_or_superset():
    assert _validate_paired_counts("connected_calls", 13, "conversations", 13) == []
    assert _validate_paired_counts("connected_calls", 20, "conversations", 13) == []


# ─── Phase 2: calls / conversations / no-shows / email ──────────────────────

def test_calls_made_connected_conversations_share_one_query_and_hold_invariant(db):
    """RCA 2026-08-18: connected_calls must always be >= conversations. Both
    are now sourced from the same extended _compute_calls_and_connect_rate()
    call, so this asserts the structural fix, not just the arithmetic.

    2026-09-01: provider_disposition is no longer trusted as connect
    evidence (see dialer_call_connected()'s docstring) — a null-outcome,
    short-duration call is now neither connected nor a conversation, same
    as the plain not-answered case."""
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="sdr@t.com", role="SDR", pod_id=pod.id)
    lead = create_test_lead(db, email="l1@t.com", pod_id=pod.id)
    # Positive outcome: counts as both connected and a conversation.
    create_test_dialer_call(db, lead.id, sdr.id, outcome="Interested")
    # No outcome, ANSWERED disposition, short duration: neither connected
    # nor a conversation now that provider_disposition is ignored.
    create_test_dialer_call(db, lead.id, sdr.id, outcome=None, provider_disposition="ANSWERED", duration=5)
    # Not answered: neither connected nor a conversation.
    create_test_dialer_call(db, lead.id, sdr.id, outcome="No Answer")

    calls_made = resolve_metric("calls_made", db, admin)
    connected = resolve_metric("connected_calls", db, admin)
    conversations = resolve_metric("conversations", db, admin)

    assert calls_made["value"] == 3
    assert connected["value"] == 1
    assert conversations["value"] == 1
    assert connected["value"] >= conversations["value"]
    assert connected["explanation"]["warnings"] == []


def test_unique_leads_called(db):
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    sdr = create_test_user(db, email="sdr@t.com", role="SDR", pod_id=pod.id)
    lead1 = create_test_lead(db, email="l1@t.com", pod_id=pod.id)
    lead2 = create_test_lead(db, email="l2@t.com", pod_id=pod.id)
    create_test_dialer_call(db, lead1.id, sdr.id, outcome="Interested")
    create_test_dialer_call(db, lead1.id, sdr.id, outcome="No Answer")
    create_test_dialer_call(db, lead2.id, sdr.id, outcome="Interested")

    envelope = resolve_metric("unique_leads_called", db, admin)
    assert envelope["value"] == 2


def test_no_shows_scoped_to_meeting_reached_window(db):
    """no_shows reuses _compute_meetings_booked_snapshot's tuple — dated by
    COALESCE(lead_closed_at, status_changed_at), scoped to leads that reached
    a MEETING_REACHED_STATUSES status."""
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    now = datetime.now(timezone.utc)
    in_window = create_test_lead(db, email="ns1@t.com", pod_id=pod.id, status="Meeting Scheduled")
    _set(db, in_window, no_show_count=2, lead_closed_at=now)
    out_of_window = create_test_lead(db, email="ns2@t.com", pod_id=pod.id, status="Meeting Scheduled")
    _set(db, out_of_window, no_show_count=5, lead_closed_at=now - timedelta(days=60))

    envelope = resolve_metric(
        "no_shows", db, admin,
        date_from=(now - timedelta(days=1)).date().isoformat(),
        date_to=(now + timedelta(days=1)).date().isoformat(),
    )
    assert envelope["value"] == 2


def test_email_sent_open_reply_rate(db):
    admin = _make_user_payload("Super Admin")
    pod = create_test_pod(db, name="P")
    lead = create_test_lead(db, email="e1@t.com", pod_id=pod.id)
    create_email_thread(db, lead.id, nylas_thread_id="thread-1")
    a1 = create_email_activity(db, lead.id, direction="outbound", nylas_thread_id="thread-1")
    _set(db, a1, opened_at=datetime.now(timezone.utc))
    create_email_activity(db, lead.id, direction="outbound", nylas_thread_id="thread-1")
    create_email_activity(db, lead.id, direction="inbound", nylas_thread_id="thread-1")

    sent = resolve_metric("email_sent", db, admin)
    open_rate = resolve_metric("email_open_rate", db, admin)
    reply_rate = resolve_metric("email_reply_rate", db, admin)

    assert sent["value"] == 2
    assert open_rate["value"] == 50.0
    assert open_rate["explanation"]["numerator"] == 1
    assert open_rate["explanation"]["denominator"] == 2
    # Reply rate denominator is distinct outbound THREADS (1), not raw sends (2).
    assert reply_rate["explanation"]["denominator"] == 1
    assert reply_rate["value"] == 100.0

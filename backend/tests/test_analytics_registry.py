"""Tests for the Phase 1 Metric Registry (backend/analytics/registry.py)."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analytics import registry


def test_all_five_phase1_metrics_registered():
    ids = {m.id for m in registry.list_metrics()}
    assert {
        "connect_rate", "leads_assigned", "account_connect_rate",
        "disqualified", "meetings_scheduled",
    }.issubset(ids)


def test_phase2_metrics_registered():
    ids = {m.id for m in registry.list_metrics()}
    assert {
        "calls_made", "unique_leads_called", "connected_calls", "conversations",
        "no_shows", "email_sent", "email_open_rate", "email_reply_rate",
    }.issubset(ids)


def test_conversations_flags_the_rca_invariant_as_known_caveat():
    # RCA 2026-08-18 ("13 conversations, 11 connected calls") is the concrete
    # incident Phase 5's paired-count validation encodes — the registry
    # caveat must name it, not just assert a bare invariant.
    caveats = " ".join(registry.get_metric("conversations").known_caveats)
    assert "subset" in caveats.lower()


def test_get_metric_returns_definition():
    m = registry.get_metric("connect_rate")
    assert m is not None
    assert m.name == "Connect Rate"
    assert m.version == 1
    assert m.status == "published"
    assert m.date_basis == "call_event_time"


def test_get_metric_unknown_returns_none():
    assert registry.get_metric("close_rate") is None


def test_metric_exists():
    assert registry.metric_exists("disqualified") is True
    assert registry.metric_exists("close_rate") is False


def test_event_metrics_declare_status_transition_date_basis():
    # Master-doc requirement 5.2/5.3: Meetings/Disqualified are event
    # metrics, keyed by the status transition, not lead creation or a
    # current-state field.
    assert registry.get_metric("disqualified").date_basis == "status_transition_time"
    assert registry.get_metric("meetings_scheduled").date_basis == "status_transition_time"


def test_disqualified_and_meetings_flag_snapshot_difference_as_known_caveat():
    # These are the two metrics with an intentional, documented difference
    # from the legacy Dashboard snapshot — the caveat must say so, not bury it.
    disq_caveats = " ".join(registry.get_metric("disqualified").known_caveats)
    meet_caveats = " ".join(registry.get_metric("meetings_scheduled").known_caveats)
    assert "snapshot" in disq_caveats.lower()
    assert "snapshot" in meet_caveats.lower()

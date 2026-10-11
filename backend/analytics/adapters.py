"""
Metric adapters — Phase 1.

Each adapter maps one registered metric_id to an executable calculation.
Per the master doc's Phase 1 instructions, this is NOT a generic query engine:
- connect_rate / leads_assigned reuse the extracted, behavior-preserving
  helpers in analytics_routes.py (same queries the Dashboard already runs).
- account_connect_rate reuses _compute_sdr_rows() (unchanged) and sums across
  the requested scope.
- disqualified / meetings_scheduled are NEW canonical event queries, built on
  Lead.lead_closed_at / Lead.meeting_scheduled_at — existing columns already
  written at the moment of the real-world transition (verified: neither is
  ever reset once written), so no new event-log parsing or backfill is
  required. These intentionally differ from the legacy Dashboard's
  current-state snapshot definitions — see registry.py's known_caveats.

Each adapter returns (value, extra_explanation_dict). semantic.py merges
extra_explanation_dict with the registry's static metadata to build the full
inspection envelope.
"""
from dataclasses import dataclass
import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from routes.analytics_routes import (
    _compute_leads_assigned_count,
    _compute_calls_and_connect_rate,
    _compute_meetings_booked_snapshot,
    _compute_email_stats,
    _compute_sdr_rows,
    _pod_scope_lead_query,
    _lead_source_filter,
)


@dataclass
class AdapterContext:
    db: Session
    effective_pod: Optional[str]
    effective_sdr: Optional[str]
    date_start: Optional[datetime]
    date_end: Optional[datetime]
    date_from_raw: Optional[str]
    date_to_raw: Optional[str]
    preset_raw: Optional[str]
    lead_source: Optional[str]
    upload_log_id: Optional[str]
    conversation_min_seconds: int


def _connect_rate(ctx: MetricContext):
    calls = _compute_calls_and_connect_rate(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id, ctx.conversation_min_seconds,
    )
    value = calls["connect_rate"]
    return value, {
        "numerator": calls["calls_connected"],
        "denominator": calls["calls_made"],
        "warnings": _validate_rate(value, calls["calls_connected"], calls["calls_made"]),
    }


def _leads_assigned(ctx: MetricContext):
    value = _compute_leads_assigned_count(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id,
    )
    return value, {
        "numerator": None,
        "denominator": None,
        "warnings": _validate_count(value),
    }


def _account_connect_rate(ctx: MetricContext):
    rows = _compute_sdr_rows(
        ctx.db, ctx.effective_pod, ctx.date_from_raw, ctx.date_to_raw, ctx.preset_raw,
        ctx.upload_log_id, ctx.lead_source, ctx.effective_sdr,
    )
    accounts_called = sum(r.get("accounts_called") or 0 for r in rows)
    accounts_connected = sum(r.get("accounts_connected") or 0 for r in rows)
    value = round(accounts_connected / accounts_called * 100, 1) if accounts_called > 0 else None
    return value, {
        "numerator": accounts_connected,
        "denominator": accounts_called,
        "warnings": _validate_rate(value, accounts_connected, accounts_called),
    }


# ─── Phase 2 additions ──────────────────────────────────────────────────────

def _calls_and_connect_rate(ctx: MetricContext):
    return _compute_calls_and_connect_rate(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id, ctx.conversation_min_seconds,
    )


def _calls_made(ctx: MetricContext):
    calls = _calls_and_connect_rate(ctx)
    return calls["calls_made"], {"numerator": None, "denominator": None, "warnings": _validate_count(calls["calls_made"])}


def _unique_leads_called(ctx: MetricContext):
    value = _calls_and_connect_rate(ctx)["unique_leads_called"]
    return value, {"numerator": None, "denominator": None, "warnings": _validate_count(value)}


def _connected_calls(ctx: MetricContext):
    calls = _calls_and_connect_rate(ctx)
    value = calls["calls_connected"]
    warnings = _validate_count(value) + _validate_paired_counts(
        "calls_made", calls["calls_made"], "connected_calls", value,
    ) + _validate_paired_counts(
        "connected_calls", value, "conversations", calls["conversations"],
    )
    return value, {"numerator": None, "denominator": None, "warnings": warnings}


def _conversations(ctx: MetricContext):
    value = _calls_and_connect_rate(ctx)["conversations"]
    return value, {"numerator": None, "denominator": None, "warnings": _validate_count(value)}


def _no_shows(ctx: MetricContext):
    _, no_shows = _compute_meetings_booked_snapshot(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id,
    )
    return no_shows, {"numerator": None, "denominator": None, "warnings": _validate_count(no_shows)}


def _email_sent(ctx: MetricContext):
    stats = _compute_email_stats(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id,
    )
    value = stats["emails_sent"]
    return value, {"numerator": None, "denominator": None, "warnings": _validate_count(value)}


def _email_open_rate(ctx: MetricContext):
    stats = _compute_email_stats(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id,
    )
    value = stats["open_rate"]
    return value, {
        "numerator": stats["emails_opened"],
        "denominator": stats["emails_sent"],
        "warnings": _validate_rate(value, stats["emails_opened"], stats["emails_sent"]),
    }


def _email_reply_rate(ctx: MetricContext):
    stats = _compute_email_stats(
        ctx.db, ctx.effective_pod, ctx.effective_sdr, ctx.date_start, ctx.date_end,
        ctx.lead_source, ctx.upload_log_id,
    )
    value = stats["reply_rate"]
    return value, {
        "numerator": stats["emails_replied"],
        "denominator": stats["sent_threads"],
        "warnings": _validate_rate(value, stats["emails_replied"], stats["sent_threads"]),
    }


def _disqualified(ctx: MetricContext):
    q = ctx.db.query(func.count(models.Lead.id)).filter(models.Lead.status == "Disqualified")
    q = _pod_scope_lead_query(q, ctx.effective_pod, ctx.effective_sdr)
    q = models.exclude_test_and_deleted_leads(q)
    if ctx.lead_source:
        q = _lead_source_filter(q, ctx.lead_source)
    if ctx.upload_log_id:
        q = q.filter(models.Lead.upload_log_id == ctx.upload_log_id)
    if ctx.date_start:
        q = q.filter(models.Lead.lead_closed_at >= ctx.date_start)
    if ctx.date_end:
        q = q.filter(models.Lead.lead_closed_at <= ctx.date_end)
    value = q.scalar() or 0
    return value, {
        "numerator": None,
        "denominator": None,
        "warnings": _validate_count(value),
    }


def _meetings_scheduled(ctx: MetricContext):
    q = ctx.db.query(func.count(models.Lead.id)).filter(models.Lead.meeting_scheduled_at.isnot(None))
    q = _pod_scope_lead_query(q, ctx.effective_pod, ctx.effective_sdr)
    q = models.exclude_test_and_deleted_leads(q)
    if ctx.lead_source:
        q = _lead_source_filter(q, ctx.lead_source)
    if ctx.upload_log_id:
        q = q.filter(models.Lead.upload_log_id == ctx.upload_log_id)
    if ctx.date_start:
        q = q.filter(models.Lead.meeting_scheduled_at >= ctx.date_start)
    if ctx.date_end:
        q = q.filter(models.Lead.meeting_scheduled_at <= ctx.date_end)
    value = q.scalar() or 0
    return value, {
        "numerator": None,
        "denominator": None,
        "warnings": _validate_count(value),
    }


# ─── Data-quality checks (Phase 1: a handful of assertions, not a framework) ──

def _validate_rate(value, numerator, denominator) -> list:
    warnings = []
    if value is not None and not (0 <= value <= 100):
        warnings.append(f"Rate {value} is outside the valid 0-100 range.")
    if numerator is not None and denominator is not None and numerator > denominator:
        warnings.append(f"Numerator ({numerator}) exceeds denominator ({denominator}).")
    if (numerator is not None and numerator < 0) or (denominator is not None and denominator < 0):
        warnings.append("Numerator or denominator is negative.")
    return warnings


def _validate_count(value) -> list:
    return ["Count is negative."] if value is not None and value < 0 else []


def _validate_paired_counts(label_a, value_a, label_b, value_b) -> list:
    """Superset/subset invariant for two counts drawn from the same query
    (e.g. connected_calls >= conversations). RCA 2026-08-18 ('13 conversations,
    11 connected calls') is the real incident this encodes — see
    AGENT_PROTOCOL.md Rule 16. A warning, not a hard failure: matches the
    existing _validate_rate/_validate_count precedent (never raises), since a
    single bad request shouldn't 500 over a paired-metric comparison."""
    if value_a is not None and value_b is not None and value_a < value_b:
        return [f"{label_a} ({value_a}) is less than {label_b} ({value_b}) — expected {label_a} >= {label_b}."]
    return []


ADAPTERS = {
    "connect_rate": _connect_rate,
    "leads_assigned": _leads_assigned,
    "account_connect_rate": _account_connect_rate,
    "disqualified": _disqualified,
    "meetings_scheduled": _meetings_scheduled,
    "calls_made": _calls_made,
    "unique_leads_called": _unique_leads_called,
    "connected_calls": _connected_calls,
    "conversations": _conversations,
    "no_shows": _no_shows,
    "email_sent": _email_sent,
    "email_open_rate": _email_open_rate,
    "email_reply_rate": _email_reply_rate,
}

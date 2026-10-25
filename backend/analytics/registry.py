"""
Metric Registry — Phase 1 (Analytics Transformation, see
docs/Alternate CRM Analytics Transformation — Master Claude Code Implementation
Prompt.md).

A plain in-code registry, not a database table. Phase 1 has exactly one
version of each of 5 metrics, all "v1 / published", and nothing here is
user-editable — a dataclass  is the whole registry. Phase 3
("Metric Governance + Versioning" in the master doc) is where a draft/publish
workflow needs persistence and an audit trail; this module's field names map
1:1 onto a future table so that mapping is straightforward, not a redesign.

The registry describes BUSINESS MEANING, not SQL — see MetricDefinition's
docstring. Execution lives in adapters.py; resolution/scoping/logging lives
in semantic.py.
"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class MetricDefinition:
    id: str
    name: str
    description: str                    # business meaning, plain language
    category: str                       # e.g. "calls", "pipeline"
    unit: str                           # "percent" | "count"
    formula_description: str            # human-readable formula, not SQL
    numerator_description: Optional[str]
    denominator_description: Optional[str]
    date_basis: str                     # which timestamp the metric is scoped by
    supported_dimensions: list          # metadata only in Phase 1 — not yet executable
    status: str                         # "published" | "draft"
    version: int
    owner: str
    known_caveats: list = field(default_factory=list)


_REGISTRY = {
    "connect_rate": MetricDefinition(
        id="connect_rate",
        name="Connect Rate",
        description="Percentage of outbound calls that resulted in a human connection.",
        category="calls",
        unit="percent",
        formula_description="connected calls ÷ calls made × 100",
        numerator_description="Calls where dialer_call_connected() (or the CallLog equivalent) is true.",
        denominator_description="Canonical Calls Made population (DialerCall + non-mirrored CallLog).",
        date_basis="call_event_time",
        supported_dimensions=["pod", "sdr", "batch"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "Calls with a NULL outcome are excluded from both numerator and denominator.",
            "For a call with no logged outcome, duration must exceed SyncSettings."
            "conversation_min_seconds (org-configurable, default 120s) to count as connected — "
            "the same threshold Conversations uses, by design (see Connected Calls' caveat below).",
        ],
    ),
    "leads_assigned": MetricDefinition(
        id="leads_assigned",
        name="Leads Assigned",
        description="Count of lead entities created in the selected period.",
        category="pipeline",
        unit="count",
        formula_description="COUNT(leads created in period), excluding parked/test/deleted leads",
        numerator_description=None,
        denominator_description=None,
        date_basis="lead_created_at",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "This is an entity count, not an assignment-relationship count — a lead reassigned "
            "mid-period is still counted once, at its creation date.",
        ],
    ),
    "account_connect_rate": MetricDefinition(
        id="account_connect_rate",
        name="Account Connect Rate",
        description="Percentage of accounts (leads) reached that had at least one connected call.",
        category="calls",
        unit="percent",
        formula_description="accounts with ≥1 connected call ÷ accounts called × 100",
        numerator_description="Distinct leads with at least one connected call in the period.",
        denominator_description="Distinct leads called at least once in the period.",
        date_basis="call_event_time",
        supported_dimensions=["pod", "sdr"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "Computed by summing the existing per-SDR breakdown (_compute_sdr_rows) across the "
            "requested scope, not from a dedicated org-wide query.",
        ],
    ),
    "disqualified": MetricDefinition(
        id="disqualified",
        name="Disqualified",
        description="Count of leads that transitioned into Disqualified during the selected period.",
        category="pipeline",
        unit="count",
        formula_description='COUNT(leads where status == "Disqualified" AND lead_closed_at in period)',
        numerator_description=None,
        denominator_description=None,
        date_basis="status_transition_time",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            'Event metric, not a current-state snapshot — a lead disqualified last period still '
            'counts for last period even if later reopened.',
            'Only status == "Disqualified" is treated as canonical. The legacy Dashboard widget '
            'additionally counts 3 legacy outcome-as-status values ("Not Interested", '
            '"Unreachable", "Customer Declined") that current application code no longer writes '
            'to Lead.status — expect a real, intentional difference vs. the legacy snapshot for '
            'any data containing those older statuses.',
        ],
    ),
    # ─── Phase 2 additions ────────────────────────────────────────────────────
    "calls_made": MetricDefinition(
        id="calls_made",
        name="Calls Made",
        description="Total outbound call events (dialer + manually-logged), excluding auto-mirrored duplicates.",
        category="calls",
        unit="count",
        formula_description="COUNT(DialerCall outbound) + COUNT(manual CallLog outbound, not dialer-mirrored)",
        numerator_description=None,
        denominator_description=None,
        date_basis="call_event_time",
        supported_dimensions=["pod", "sdr", "batch"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "Calls made from a DialerCall.lead_id are only ~3.6% populated, so this metric is not "
            "reliably scopeable by batch — matches the existing Dashboard/Ask AI limitation.",
        ],
    ),
    "unique_leads_called": MetricDefinition(
        id="unique_leads_called",
        name="Unique Leads Called",
        description="Count of distinct leads that received at least one outbound call in the period.",
        category="calls",
        unit="count",
        formula_description="COUNT(DISTINCT lead_id) across the Calls Made population",
        numerator_description=None,
        denominator_description=None,
        date_basis="call_event_time",
        supported_dimensions=["pod", "sdr", "batch"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "An entity count, not a call-event count — see Calls Made for the distinction "
            "(Principle 6, master doc).",
        ],
    ),
    "connected_calls": MetricDefinition(
        id="connected_calls",
        name="Connected Calls",
        description="Calls where dialer_call_connected() (or the CallLog equivalent) is true.",
        category="calls",
        unit="count",
        formula_description="COUNT(calls matching dialer_call_connected())",
        numerator_description=None,
        denominator_description=None,
        date_basis="call_event_time",
        supported_dimensions=["pod", "sdr", "batch"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "Connected is a superset of Conversations by definition (RCA 2026-08-18) — the "
            "semantic layer validates connected_calls >= conversations and warns, not fails, on "
            "violation (see adapters.py:_validate_paired_counts).",
            "That superset relationship holds only because Connected and Conversations share one "
            "duration threshold (SyncSettings.conversation_min_seconds, default 120s) for their "
            "disposition-unknown fallback — do not give this metric a separately-configured, "
            "higher threshold than Conversations without re-deriving the invariant.",
        ],
    ),
    "conversations": MetricDefinition(
        id="conversations",
        name="Conversations",
        description="Calls where dialer_call_is_conversation() (or the CallLog equivalent) is true.",
        category="calls",
        unit="count",
        formula_description="COUNT(calls matching dialer_call_is_conversation())",
        numerator_description=None,
        denominator_description=None,
        date_basis="call_event_time",
        supported_dimensions=["pod", "sdr", "batch"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "A strict subset of Connected Calls (RCA 2026-08-18: 'Sumiti Dangi, 13 conversations, "
            "11 connected calls' was a bug, not a valid state) — both come from the same query as "
            "of Phase 2, so this invariant now holds structurally, not just by convention.",
        ],
    ),
    "no_shows": MetricDefinition(
        id="no_shows",
        name="No Shows",
        description="Sum of no-show counts for leads currently at-or-past the Meeting Scheduled stage.",
        category="pipeline",
        unit="count",
        formula_description="SUM(Lead.no_show_count) for leads in the meeting-reached snapshot population",
        numerator_description=None,
        denominator_description=None,
        date_basis="status_transition_time",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "There is no dedicated no-show event timestamp anywhere in the schema — this reuses "
            "the existing Dashboard meetings-snapshot query's date scoping (COALESCE(lead_closed_at, "
            "status_changed_at)), the same window used for the legacy Meetings widget, not the date "
            "the no-show itself occurred.",
            "Previously only exposed to Ask AI (smart_analytics.py's _q_no_shows), which applied no "
            "date filter at all — this is the first date-scoped version of this metric.",
        ],
    ),
    "email_sent": MetricDefinition(
        id="email_sent",
        name="Email Sent",
        description="Count of outbound email sends in the selected period.",
        category="email",
        unit="count",
        formula_description="COUNT(LeadEmailActivity where direction='outbound')",
        numerator_description=None,
        denominator_description=None,
        date_basis="email_sent_at",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[],
    ),
    "email_open_rate": MetricDefinition(
        id="email_open_rate",
        name="Email Open Rate",
        description="Percentage of outbound emails that were opened.",
        category="email",
        unit="percent",
        formula_description="emails opened ÷ emails sent × 100",
        numerator_description="Outbound emails with a recorded open event.",
        denominator_description="Outbound emails sent.",
        date_basis="email_sent_at",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[],
    ),
    "email_reply_rate": MetricDefinition(
        id="email_reply_rate",
        name="Email Reply Rate",
        description="Percentage of outbound email threads that received an inbound reply.",
        category="email",
        unit="percent",
        formula_description="distinct threads with an inbound reply ÷ distinct outbound threads × 100",
        numerator_description="Distinct email threads with at least one inbound reply.",
        denominator_description="Distinct email threads with at least one outbound send.",
        date_basis="email_sent_at",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "Thread-based, not row-based — a thread with 3 outbound touches and 1 reply is a "
            "100% reply rate, not 33%.",
        ],
    ),
    "meetings_scheduled": MetricDefinition(
        id="meetings_scheduled",
        name="Meetings Scheduled",
        description="Count of leads that transitioned into Meeting Scheduled during the selected period.",
        category="pipeline",
        unit="count",
        formula_description="COUNT(leads where meeting_scheduled_at falls in period)",
        numerator_description=None,
        denominator_description=None,
        date_basis="status_transition_time",
        supported_dimensions=["pod", "sdr", "batch", "source"],
        status="published",
        version=1,
        owner="analytics-platform",
        known_caveats=[
            "Event metric, not a current-state snapshot — a lead that entered Meeting Scheduled "
            "last period but is now Disqualified still counts for last period. "
            "Lead.meeting_scheduled_at is set once and never cleared, so this holds even across "
            "later status changes.",
            'Differs from the legacy Dashboard "Meetings" widget, which counts leads CURRENTLY '
            "at-or-past the Meeting Scheduled stage (a snapshot) — expect a real, intentional "
            "difference vs. the legacy snapshot.",
        ],
    ),
}


_VERSIONABLE_FIELDS = (
    "description", "formula_description", "numerator_description",
    "denominator_description", "date_basis", "known_caveats",
)


def get_metric(metric_id: str, db=None) -> Optional[MetricDefinition]:
    """db is optional — callers without a session (tests, the static catalog)
    get the v1 static definition. When given, a published MetricVersion row
    overrides only the descriptive/business-meaning fields above (Phase 3);
    calculation logic stays code, gated on version in adapters.py, not
    something this table can change."""
    static = _REGISTRY.get(metric_id)
    if static is None or db is None:
        return static

    import models
    from dataclasses import replace
    published = db.query(models.MetricVersion).filter(
        models.MetricVersion.metric_id == metric_id,
        models.MetricVersion.status == "published",
    ).order_by(models.MetricVersion.version_number.desc()).first()
    if published is None:
        return static

    d = published.definition_json or {}
    overrides = {f: d[f] for f in _VERSIONABLE_FIELDS if f in d}
    return replace(static, version=published.version_number, **overrides)


def list_metrics(db=None) -> list:
    if db is None:
        return list(_REGISTRY.values())
    return [get_metric(metric_id, db) for metric_id in _REGISTRY.keys()]


def metric_exists(metric_id: str) -> bool:
    return metric_id in _REGISTRY

import logging
import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Table, Text, Boolean, Integer, BigInteger, or_, and_, Index, UniqueConstraint, JSON, text, exists
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship, backref, aliased
from sqlalchemy.sql import func
import enum
from database import Base

logger = logging.getLogger(__name__)

# Dual-DB JSON column: JSONB on Postgres (GIN-indexable), plain JSON on SQLite
# (dev/test — no GIN support there, but the dialect-specific kwarg is simply
# ignored rather than erroring, so the column degrades gracefully).
_JSONVariant = JSON().with_variant(JSONB(), "postgresql")

def generate_uuid():
    return str(uuid.uuid4())

# Mapping Table
lead_assignments = Table(
    'lead_assignments', Base.metadata,
    Column('user_id', String, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('lead_id', String, ForeignKey('leads.id', ondelete='CASCADE'), primary_key=True, index=True),
    Column('assigned_at', DateTime(timezone=True), server_default=func.now())
)

# Lead <-> Tag mapping table (a lead can carry several tags; a tag can span many uploads/leads).
lead_tags = Table(
    'lead_tags', Base.metadata,
    Column('lead_id', String, ForeignKey('leads.id', ondelete='CASCADE'), primary_key=True),
    Column('tag_id', String, ForeignKey('tags.id', ondelete='CASCADE'), primary_key=True, index=True),
)

class AllowedUser(Base):
    """Access control table — source of truth for who can log into the CRM."""
    __tablename__ = "allowed_users"

    email    = Column(String, primary_key=True, index=True)
    name     = Column(String)
    role     = Column(String, default="SDR")   # "SDR", "Pod Admin", or "Super Admin"
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    added_by = Column(String, default="system")

class Role(str, enum.Enum):
    Super_Admin = "Super Admin"
    Pod_Admin   = "Pod Admin"
    SDR         = "SDR"

class Status(str, enum.Enum):
    Lead_Assigned       = "Lead Assigned"
    Research            = "Research"
    Calling             = "Calling"
    Meeting_Scheduled   = "Meeting Scheduled"
    First_Discovery     = "1st Discovery Meeting"
    Discovery_Complete  = "Discovery Complete"
    Demo_Scheduled      = "Demo Scheduled"
    Demo_Done           = "Demo Done"
    Pending_Review      = "Pending Review"   # v5.5: failed-demo holding state (Pod Admin re-routes)
    Completed           = "Completed"
    Disqualified        = "Disqualified"

TERMINAL_STATUSES = {"Demo Done", "Completed", "Disqualified"}
ACTIVE_STATUSES   = {"Lead Assigned", "Research", "Calling", "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled"}

# Legacy statuses kept for backwards compat with existing data
LEGACY_STATUSES = {"Customer Declined", "Unreachable"}

# Parked statuses — leads that are in the system but excluded from SDR queues,
# active lead cap calculations, and analytics dashboards.
# "Pending Review" is also parked — it is a Pod Admin holding state for failed demos.
PARKED_STATUSES = {"No Phone - Parked", "Pending Review"}

class CallOutcome(str, enum.Enum):
    """Call outcome enum — kept for backward compatibility.
    New outcomes should be added here AND to DEFAULT_OUTCOME_CONFIG below.
    Validation in routes uses DEFAULT_OUTCOME_CONFIG, not this enum."""
    # ── ANSWERED group (green) ──
    Call_Back_Later       = "Call Back Later"
    Meeting_Scheduled     = "Meeting Scheduled"
    Meeting_Confirmed     = "Meeting Confirmed"
    Meeting_Complete      = "Meeting Complete"      # v5.5: SDR confirms meeting actually happened
    Text_Me               = "Text Me"
    Not_Right_Person      = "Not the Right Person"
    Referred_Someone_Else = "Referred Someone Else"
    # ── NOT ANSWERED group (gray) ──
    No_Answer             = "No Answer"
    Left_Voicemail        = "Left Voicemail"
    Wrong_Number          = "Wrong Number"
    # ── DISCOVERY / DEMO group ──
    Demo_Failed           = "Demo Failed"           # v5.5: triggers Pending Review workflow
    # ── TERMINAL group (red) ──
    Not_Interested        = "Not Interested"
    Unreachable           = "Unreachable"
    Left_the_Company      = "Left the Company"

# Grouped outcome sets (used by frontend + validation)
ANSWERED_OUTCOMES     = {"Call Back Later", "Meeting Scheduled", "Meeting Confirmed",
                         "Text Me", "Not the Right Person", "Referred Someone Else"}
NOT_ANSWERED_OUTCOMES = {"No Answer", "Left Voicemail", "Wrong Number"}
TERMINAL_OUTCOMES     = {"Not Interested", "Unreachable", "Left the Company"}

# Outcomes that increment call_attempt_count (unsuccessful contact attempts)
ATTEMPT_OUTCOMES = {"No Answer", "Left Voicemail", "Wrong Number", "Unreachable", "Left the Company"}

# Outcomes that resolve a company — no more calls needed to other contacts
COMPANY_RESOLVED_OUTCOMES = {"Meeting Scheduled", "Meeting Confirmed"}

# ── Configurable outcome action sets ─────────────────────────────────────────
# These drive auto-transitions in log_call — edit these sets to change behavior.

# Outcomes that auto-disqualify the lead when logged
DISQUALIFYING_OUTCOMES = {"Left the Company"}

# Outcomes that auto-promote to "Meeting Scheduled" status
MEETING_OUTCOMES = {"Meeting Confirmed"}

# Outcomes that require mandatory notes
NOTES_REQUIRED_OUTCOMES = {"Meeting Confirmed", "Not Interested"}

# ── Default outcome configuration ────────────────────────────────────────────
# Master list of all call outcomes with their properties.
# enabled=True means visible in SDR picker; False means hidden but historical data preserved.
# Phase 2 will store this in SyncSettings.outcome_config JSON column.
DEFAULT_OUTCOME_CONFIG = [
    {"value": "Call Back Later",       "group": "answered",     "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Meeting Scheduled",     "group": "answered",     "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Meeting Confirmed",     "group": "answered",     "action": "meeting_scheduled", "notes_required": True,  "builtin": True, "enabled": True},
    # v5.5: SDR taps "Mark Meeting Complete" CTA — not in normal call picker (enabled=False)
    {"value": "Meeting Complete",      "group": "answered",     "action": "meeting_complete",  "notes_required": False, "builtin": True, "enabled": False},
    {"value": "Text Me",               "group": "answered",     "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Not the Right Person",  "group": "answered",     "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Referred Someone Else", "group": "answered",     "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "No Answer",             "group": "not_answered", "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Left Voicemail",        "group": "not_answered", "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Wrong Number",          "group": "terminal",      "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Not Interested",        "group": "terminal",     "action": "none",              "notes_required": True,  "builtin": True, "enabled": True},
    {"value": "Unreachable",           "group": "terminal",     "action": "none",              "notes_required": False, "builtin": True, "enabled": True},
    {"value": "Left the Company",      "group": "terminal",     "action": "disqualify",        "notes_required": False, "builtin": True, "enabled": True},
    # v5.5: SDR taps "Demo Failed" CTA — routes lead to Pending Review (Pod Admin queue)
    {"value": "Demo Failed",           "group": "demo",         "action": "pending_review",    "notes_required": True,  "builtin": True, "enabled": False},
]


def get_outcome_config(db=None):
    """Return the current outcome configuration.
    If db is provided, reads from SyncSettings.outcome_config JSON column.
    Falls back to DEFAULT_OUTCOME_CONFIG if column is NULL, missing, or corrupted.
    Always merges in any missing builtin outcomes from DEFAULT_OUTCOME_CONFIG."""
    if db is not None:
        try:
            settings = db.query(SyncSettings).first()
            if settings and settings.outcome_config:
                import json
                import logging
                logger = logging.getLogger(__name__)
                try:
                    db_config = json.loads(settings.outcome_config)
                    if isinstance(db_config, list) and len(db_config) > 0:
                        # Merge: ensure all builtins from DEFAULT exist
                        db_values = {o["value"] for o in db_config}
                        for default_item in DEFAULT_OUTCOME_CONFIG:
                            if default_item["value"] not in db_values:
                                db_config.append(dict(default_item))
                        # Audit: warn for non-enum custom outcomes
                        enum_values = {e.value for e in CallOutcome}
                        for o in db_config:
                            if o["value"] not in enum_values and not o.get("builtin", True):
                                logger.info(
                                    "Custom outcome '%s' has no CallOutcome enum entry",
                                    o["value"]
                                )
                        return db_config
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    import logging
                    logging.getLogger(__name__).warning(
                        "Corrupted outcome_config in SyncSettings, falling back to default: %s", e
                    )
        except Exception:
            pass  # DB not available — use default
    return list(DEFAULT_OUTCOME_CONFIG)


def get_valid_outcomes(db=None):
    """Return the set of all valid outcome values (enabled + disabled)."""
    return {o["value"] for o in get_outcome_config(db)}


def get_enabled_outcomes(db=None):
    """Return only enabled outcomes (shown in SDR picker)."""
    return [o for o in get_outcome_config(db) if o["enabled"]]


def get_outcome_by_value(value, db=None):
    """Look up a single outcome config by its value string. Returns None if not found."""
    return next((o for o in get_outcome_config(db) if o["value"] == value), None)

# Legacy outcome mapping for data migration
LEGACY_OUTCOME_MAP = {
    "Call Completed":      "Meeting Scheduled",
    "Customer Declined":   "Not Interested",
    "Callback Scheduled":  "Call Back Later",
}

class Pod(Base):
    """A POD is a team of SDRs managed by one or more Pod Admins."""
    __tablename__ = "pods"

    id              = Column(String, primary_key=True, default=generate_uuid)
    name            = Column(String, nullable=False)
    # admin_id removed — use pod_admins table for multi-admin support
    active_lead_cap = Column(Integer, default=500, nullable=False)   # per-POD SDR lead cap (matches global default)
    timezone        = Column(String, nullable=True)   # IANA name (e.g. "America/New_York"); unset = UTC.
                                                        # Lets Analytics bucket "a day" by this team's own
                                                        # working hours instead of a UTC-anchored day boundary.
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    pod_admins_rel = relationship("PodAdmin", back_populates="pod", cascade="all, delete-orphan")
    members        = relationship("User", back_populates="pod", foreign_keys="User.pod_id")


class PodAdmin(Base):
    """Many-to-many: which users are admins of which pods.

    Replaces the single pods.admin_id FK to support multiple Pod Admins per pod
    and provide an audit trail (who was added and when).
    """
    __tablename__ = "pod_admins"

    id          = Column(String, primary_key=True, default=generate_uuid)
    pod_id      = Column(String, ForeignKey("pods.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id     = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    assigned_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # audit: who added them

    pod  = relationship("Pod", back_populates="pod_admins_rel")
    user = relationship("User", foreign_keys=[user_id], back_populates="pod_admin_entries")

    __table_args__ = (
        __import__("sqlalchemy").UniqueConstraint("pod_id", "user_id", name="uq_pod_admins_pod_user"),
    )


class User(Base):
    __tablename__ = "users"

    id           = Column(String, primary_key=True, default=generate_uuid)
    google_id    = Column(String, unique=True, index=True)
    email        = Column(String, unique=True, index=True, nullable=False)
    name         = Column(String)
    role         = Column(String, default="SDR")
    sf_sdr_id    = Column(String, unique=True, index=True)
    pod_id       = Column(String, ForeignKey("pods.id", ondelete="SET NULL"), nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    dialer_user_id      = Column(String, nullable=True)                          # Optional manual Aircall/dialer user ID override
    rcm_user_id  = Column(String, nullable=True)                          # Per-SDR RCM Built-in Messaging user ID for conversation tagging
    dialer_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")  # v4: per-SDR dialer access toggle
    dialer_provider_override = Column(String, nullable=True)                     # v5.4: per-SDR dialer provider — "aircall" | "rcm" | null (use global)
    rcm_from_number   = Column(String, nullable=True)                     # v5.6: per-SDR RCM caller ID (senderId)
    rcm_email         = Column(String, nullable=True)                     # v5.16: per-SDR RCM login email (display/audit only)
    email_sync_enabled = Column(Boolean, default=False, nullable=False, server_default="false")  # v4: per-SDR email sync toggle
    klenty_username    = Column(String, nullable=True)                           # V43: per-SDR Klenty login username; falls back to email at call-site if null
    hide_branding_in_email = Column(Boolean, default=False, nullable=False, server_default="false")  # per-user: suppress the "RCM · Powered by RCM" footer on sent mail
    email_signature_html   = Column(Text, nullable=True)                        # per-user rich-text email signature (sanitized HTML — links/images allowed)

    # Relationships
    pod               = relationship("Pod", back_populates="members", foreign_keys=[pod_id])
    assigned_leads    = relationship("Lead", secondary=lead_assignments, back_populates="assigned_users")
    call_logs         = relationship("CallLog", back_populates="user")
    pod_admin_entries = relationship("PodAdmin", foreign_keys="PodAdmin.user_id", back_populates="user")


class Lead(Base):
    __tablename__ = "leads"

    id              = Column(String, primary_key=True, default=generate_uuid)
    sf_lead_id      = Column(String, unique=True, index=True, nullable=True)   # nullable for uploaded leads
    first_name      = Column(String)
    last_name       = Column(String, nullable=False)
    email           = Column(String)
    phone           = Column(String)
    phone_secondary = Column(String, nullable=True)
    company         = Column(String, index=True)
    title           = Column(String)
    status          = Column(String, default="Lead Assigned", index=True)
    lead_source     = Column(String, index=True)      # "salesforce" | "uploaded" | "manual" | ... — set explicitly by every creation path, no default (a silently-defaulted value here previously mislabeled non-Salesforce leads as "Salesforce")
    record_type_id  = Column(String, nullable=True)             # Salesforce RecordTypeId
    pod_id          = Column(String, ForeignKey("pods.id", ondelete="SET NULL"), nullable=True, index=True)
    upload_log_id   = Column(String, ForeignKey("lead_upload_logs.id", ondelete="SET NULL"), nullable=True, index=True)
    is_test         = Column(Boolean, default=False, nullable=False, server_default="false")  # Cadence/Messaging Sandbox test lead — excluded from all analytics/reporting

    # Enrichment fields (from uploaded enriched sheets)
    linkedin_url         = Column(String, nullable=True)
    person_linkedin      = Column(String, nullable=True)
    website              = Column(String, nullable=True)
    city                 = Column(String, nullable=True)
    state                = Column(String, nullable=True)
    country              = Column(String, nullable=True)
    industry             = Column(String, nullable=True)
    employee_count       = Column(Integer, nullable=True)
    annual_revenue       = Column(String, nullable=True)
    total_funding        = Column(String, nullable=True)
    company_phone        = Column(String, nullable=True)
    company_linkedin     = Column(String, nullable=True)
    company_street       = Column(String, nullable=True)
    company_city         = Column(String, nullable=True)
    company_postal_code  = Column(String, nullable=True)
    company_state        = Column(String, nullable=True)
    company_country      = Column(String, nullable=True)
    company_founded      = Column(String, nullable=True)

    # SDR Research fields (mandatory before moving to Calling when gate is ON)
    research_company         = Column(Text, nullable=True)
    research_contact         = Column(Text, nullable=True)
    research_hypothesis      = Column(Text, nullable=True)
    research_personalization = Column(Text, nullable=True)
    # Extended research fields (guided form)
    research_industry        = Column(String, nullable=True)
    research_company_size    = Column(String, nullable=True)
    research_services        = Column(Text, nullable=True)
    research_geo             = Column(String, nullable=True)
    research_timezone        = Column(String, nullable=True)
    research_hook            = Column(Text, nullable=True)
    research_channels        = Column(Text, nullable=True)  # comma-separated
    # v8 Research v2: Pre-Call Intelligence Card fields
    research_heat            = Column(String, nullable=True)   # "hot" | "warm" | "cold"
    research_opening         = Column(Text, nullable=True)     # ready-to-say opening line (≤280 chars)

    # V3 Phase 3: Attempt tracking & lead lifecycle
    call_attempt_count  = Column(Integer, default=0, nullable=False)
    no_show_count              = Column(Integer, default=0, nullable=False)     # v4: no-show tracking
    discovery_meeting_count    = Column(Integer, default=0, nullable=False, server_default="0")  # v5: discovery call tracking
    last_call_timestamp = Column(DateTime(timezone=True), nullable=True)

    # V24: Total outbound dial attempts (any source — RCM or Aircall direct)
    times_called        = Column(Integer, default=0, nullable=False, server_default="0")
    lead_started_at     = Column(DateTime(timezone=True), nullable=True)   # set on first assignment

    # V22: Priority score for lead deprioritization (100=High, 50=Medium, 25=Deprioritized)
    priority_score      = Column(Integer, default=100, nullable=False, server_default="100")
    lead_closed_at      = Column(DateTime(timezone=True), nullable=True)   # set when entering terminal status
    closed_reason       = Column(String, nullable=True)                    # "Not Interested" | "Unreachable" | "Meeting Scheduled"

    # Unified calendar: actual scheduled meeting date/time (distinct from
    # status_changed_at, which is when the status transition happened).
    # Set when a call outcome or status change confirms "Meeting Scheduled";
    # left untouched if the meeting is later rescheduled onto a new value.
    meeting_scheduled_at = Column(DateTime(timezone=True), nullable=True)

    # Real Nylas calendar event created for the meeting above (see call_routes.py's
    # "Meeting Confirmed" handling) — nullable, never created if the SDR has no
    # connected mailbox or the Nylas call fails.
    nylas_event_id      = Column(String, nullable=True)
    calendar_event_url  = Column(String, nullable=True)   # "View in Calendar" link, when Nylas returns one
    calendar_event_title  = Column(String, nullable=True)  # resolved (custom-or-default) event title, for Calendar Hub
    calendar_event_agenda = Column(Text, nullable=True)    # SDR-written/AI-drafted agenda, if one was set

    # V18: Audience Manager (RCM messaging) contact reference
    am_record_id        = Column(String, nullable=True)                    # Audience Manager contact record ID

    # V8: Opportunity outcome tracking (set by Pod Admin / Super Admin)
    opportunity_status     = Column(String, nullable=True)     # "Won" | "Lost" | null
    opportunity_notes      = Column(Text, nullable=True)       # Context from admin
    opportunity_updated_at = Column(DateTime(timezone=True), nullable=True)
    opportunity_updated_by = Column(String, nullable=True)      # Name of who set it

    status_changed_at = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md, Gap 1): no part of
    # RCM enforced contact suppression before this — checked fresh on
    # every automated send, not just at enrollment time.
    do_not_contact   = Column(Boolean, nullable=False, default=False)
    unsubscribed_at  = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    assigned_users = relationship("User", secondary=lead_assignments, back_populates="assigned_leads")
    notes          = relationship("Note", back_populates="lead", cascade="all, delete-orphan", order_by="Note.created_at.desc()")
    tasks          = relationship("Task", back_populates="lead", cascade="all, delete-orphan", order_by="Task.created_at.asc()")
    call_logs      = relationship("CallLog", back_populates="lead", cascade="all, delete-orphan", order_by="CallLog.called_at.desc()")
    status_logs    = relationship("LeadStatusLog", back_populates="lead", cascade="all, delete-orphan", order_by="LeadStatusLog.changed_at.desc()")
    attachments    = relationship("LeadAttachment", back_populates="lead", cascade="all, delete-orphan", order_by="LeadAttachment.created_at.desc()")
    tags           = relationship("Tag", secondary=lead_tags, backref="leads")
    upload_log     = relationship("LeadUploadLog", foreign_keys=[upload_log_id])

class Note(Base):
    __tablename__ = "notes"

    id         = Column(String, primary_key=True, default=generate_uuid)
    lead_id    = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    content    = Column(String, nullable=False)
    author     = Column(String, default="You")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="notes")

class Task(Base):
    __tablename__ = "tasks"

    id            = Column(String, primary_key=True, default=generate_uuid)
    lead_id       = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    user_id       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title         = Column(String, nullable=False)
    done          = Column(String, default="false")   # "true" / "false" — simple for SQLite compat
    due_date      = Column(String)
    due_time      = Column(DateTime(timezone=True), nullable=True)   # precise reminder time
    snoozed_until = Column(DateTime(timezone=True), nullable=True)   # snooze expiry
    dismissed     = Column(String, default="false")                  # notification dismissed
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="tasks")
    user = relationship("User", foreign_keys=[user_id])

class CallLog(Base):
    """Records every call attempt an SDR makes on a lead."""
    __tablename__ = "call_logs"

    id         = Column(String, primary_key=True, default=generate_uuid)
    lead_id    = Column(String, ForeignKey("leads.id",  ondelete="CASCADE"), nullable=False, index=True)
    user_id    = Column(String, ForeignKey("users.id",  ondelete="SET NULL"), nullable=True, index=True)
    outcome    = Column(String, nullable=False)
    notes      = Column(Text)
    called_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    lead = relationship("Lead", back_populates="call_logs")
    user = relationship("User", back_populates="call_logs")


class LeadStatusLog(Base):
    """Audit trail for every lead status transition."""
    __tablename__ = "lead_status_logs"

    id          = Column(String, primary_key=True, default=generate_uuid)
    lead_id     = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    from_status = Column(String, nullable=True)    # null = initial creation
    to_status   = Column(String, nullable=False)
    changed_by  = Column(String, nullable=True)    # user name/email or "system"
    changed_at  = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="status_logs")


def log_status_change(db, lead_id, from_status, to_status, changed_by="system"):
    """Reusable helper — call from any route to record a status transition."""
    entry = LeadStatusLog(
        lead_id=lead_id,
        from_status=from_status,
        to_status=to_status,
        changed_by=changed_by,
    )
    db.add(entry)

    # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md, Gap 4): every status
    # change funnels through here, so this is the one place to check for a
    # matching auto-enrollment trigger rather than adding a call at each of
    # this function's ~12 call sites. Lazy import avoids a models<->journey_engine
    # circular import (journey_engine imports models at its own module load
    # time). commit=False: this function doesn't commit itself, its callers
    # do — never raises, a trigger-check bug must not break a real status change.
    if to_status:
        try:
            from journey_engine.engine import check_entry_triggers, check_exit_triggers
            lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if lead:
                check_entry_triggers(db, "status_changed", lead, commit=False, to_status=to_status)
                # Phase 1 (Gap: conditional branching) — a lead currently parked on
                # a condition node waiting for this status change gets its early-exit
                # signal here too. commit=False for the same reason as above; the
                # 30s poller tick is the guaranteed backstop for the actual branch.
                check_exit_triggers(db, "status_changed", lead, commit=False, to_status=to_status)
        except Exception as e:
            logger.error(f"[JourneyEngine] trigger check failed for lead {lead_id}: {e}")

    return entry


def assign_lead(user, lead) -> bool:
    """Assign `lead` to `user` if not already assigned, syncing lead.pod_id to
    the assignee's pod. Every direct-assignment call site should route through
    this — a lead assigned outside a pod-based round-robin (which sets pod_id
    itself) previously left pod_id untouched, so it silently fell out of every
    pod-scoped query (analytics, pod dashboards) despite having an active SDR.
    Returns True if the assignment happened."""
    if lead in user.assigned_leads:
        return False
    user.assigned_leads.append(lead)
    lead.pod_id = user.pod_id
    return True


def disqualify_lead(db, lead, reason: str, actor_name: str = "system"):
    """Terminal-disqualify a lead: status, status_changed_at, lead_closed_at,
    closed_reason, and the status-change log entry, all in one place — so no
    call site can set status="Disqualified" without also setting the fields
    the analytics trend/funnel queries key off of (lead_closed_at)."""
    from datetime import datetime, timezone
    old_status = lead.status
    lead.status = "Disqualified"
    lead.status_changed_at = datetime.now(timezone.utc)
    lead.lead_closed_at = datetime.now(timezone.utc)
    lead.closed_reason = reason
    log_status_change(db, lead.id, old_status, "Disqualified", actor_name)


class DisqualifyRequest(Base):
    """Maker-checker approval for bulk-disqualifying every lead under an account
    (ICP mismatch). AE/SDR requests, Pod Admin (or above) approves/rejects — see
    routes/disqualify_routes.py. lead_ids is a JSON-encoded list (small N per
    request; no join table needed at this scale)."""
    __tablename__ = "disqualify_requests"

    id                = Column(String, primary_key=True, default=generate_uuid)
    company           = Column(String, nullable=False, index=True)
    lead_ids          = Column(Text, nullable=False)   # json.dumps(list[str])
    reason            = Column(String, nullable=False)
    requested_by      = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    requested_at      = Column(DateTime(timezone=True), server_default=func.now())
    status            = Column(String, nullable=False, default="pending")  # pending|approved|rejected
    reviewed_by       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at       = Column(DateTime(timezone=True), nullable=True)
    rejection_reason  = Column(String, nullable=True)


class SmsLog(Base):
    """Records every outbound / inbound SMS or WhatsApp message — both the
    Cadence engine's automated sends and the RCM Widget's manual sends
    write here, so one table backs the Activity feed regardless of which
    triggered it or which provider carried it."""
    __tablename__ = "sms_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)
    message_id   = Column(String, nullable=True, index=True)  # RCM messageId (rcm-xxx) or temp_unique_id (Widget)
    lead_id      = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id      = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    direction    = Column(String, nullable=False)              # "outbound" | "inbound"
    status       = Column(String, default="sent", nullable=False)  # "sent" | "delivered" | "failed"
    phone_number = Column(String, nullable=True)               # recipient (outbound) or sender (inbound)
    message_text = Column(Text, nullable=True)
    sent_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    # Sales Journey linkage — NULL for a manually-sent message (Widget).
    journey_id      = Column(String, ForeignKey("journeys.id", ondelete="SET NULL"), nullable=True, index=True)
    enrollment_id   = Column(String, ForeignKey("journey_enrollments.id", ondelete="SET NULL"), nullable=True, index=True)
    journey_node_id = Column(String, nullable=True)
    # v10.9.13: Widget persistence + provider-agnostic groundwork.
    channel         = Column(String, default="sms", nullable=False)       # "sms" | "whatsapp"
    provider        = Column(String, default="rcm", nullable=False)  # "rcm" | "aircall" (future)
    conversation_id = Column(String, nullable=True)  # RCM Converse Desk thread id (Widget sends only)
    template_name   = Column(String, nullable=True)  # WhatsApp MTM template used, if any

    lead = relationship("Lead", foreign_keys=[lead_id], backref="sms_logs")




class SyncSettings(Base):
    """
    Single-row configuration table for Salesforce lead sync.
    Row id is always 1 (get-or-create pattern).
    """
    __tablename__ = "sync_settings"

    id               = Column(Integer, primary_key=True, default=1)
    lead_limit       = Column(Integer, default=1000, nullable=False)
    # JSON array string of selected Salesforce RecordType IDs, e.g. '["012...","012..."]'
    # NULL means no filter (all record types)
    record_type_ids  = Column(Text, nullable=True)
    sf_push_stage    = Column(String, default="Meeting Scheduled")   # Stage at which leads are pushed to SF
    sync_direction   = Column(String, default="push_only")  # "push_only" (CRM→SF) or "both" (2-way)
    allow_multi_pod_sdr = Column(Boolean, default=False, nullable=False, server_default="false")  # Allow SDR in multiple pods

    # Phase 3: Configurable caps & attempt limits
    active_lead_cap                  = Column(Integer, default=5, nullable=False)     # global default SDR lead cap
    max_call_attempts                = Column(Integer, default=5, nullable=False)     # warn after this many No Answer/Voicemail
    min_call_attempts_for_unreachable = Column(Integer, default=3, nullable=False)    # min before allowing Unreachable
    sync_declined_to_salesforce      = Column(Boolean, default=False, nullable=False) # push Customer Declined to SF
    sync_unreachable_to_salesforce   = Column(Boolean, default=False, nullable=False) # push Unreachable to SF
    terminal_lead_cooldown_days      = Column(Integer, default=30, nullable=False)    # days before terminal leads recycle
    conversation_min_seconds         = Column(Integer, default=30, nullable=False, server_default="30")  # Analytics "Conversations" column threshold

    # AI / LLM settings (Super Admin configurable)
    llm_provider    = Column(String, default="groq", nullable=False)       # "groq" | "gemini" | "openai"
    llm_api_key     = Column(Text, nullable=True)                          # encrypted API key
    llm_model       = Column(String, default="gemma2-9b-it", nullable=False)
    research_prompt = Column(Text, nullable=True)                          # custom system prompt override (NULL = use default)
    # v8 Research v2: admin-controlled research gate toggle
    require_research_before_calling = Column(Boolean, default=False, nullable=False, server_default="false")  # False = gate off (default); True = 4 fields required

    # Dialer / Calling provider settings (Super Admin configurable)
    dialer_provider      = Column(String, default="none", nullable=False)    # "none" | "aircall" | "rcm"
    dialer_api_id        = Column(String, nullable=True)                     # Provider API ID (e.g. Aircall API ID)
    dialer_api_token     = Column(Text, nullable=True)                       # Encrypted provider API token
    dialer_webhook_token = Column(String, nullable=True)                     # Webhook verification token

    # V45: Aircall Everywhere (embedded browser softphone) — org-wide kill switch.
    # Default False until piloted; SDR-level adoption is client-side (localStorage),
    # not a DB column — see docs plan for the reasoning.
    aircall_everywhere_enabled = Column(Boolean, default=False, nullable=False, server_default="false")

    # RCM / RCM Messaging messaging component settings (Super Admin configurable)
    rcm_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")
    rcm_base_url    = Column(String, default="https://app.rcm-messaging.com", nullable=True)
    rcm_api_key     = Column(String, nullable=True)                   # RCM Messaging API key
    rcm_user_id     = Column(String, nullable=True)                   # RCM Messaging user ID
    rcm_account_id  = Column(String, nullable=True)                   # RCM account ID (for Converse Desk API)
    rcm_sender_id   = Column(String, nullable=True)                   # WhatsApp/SMS sender number e.g. "918956778474"
    rcm_access_token = Column(Text, nullable=True)                    # JWT access token (encrypted)

    # Messaging provider selection (Widget manual sends + Cadence WhatsApp/SMS
    # channel both resolve through this) — "rcm" or "aircall". Aircall
    # messaging reuses the same dialer_api_id/dialer_api_token credentials
    # already stored above for calling; only the send-from number differs.
    messaging_provider          = Column(String, default="rcm", nullable=False, server_default="rcm")
    aircall_messaging_number_id = Column(String, nullable=True)              # Aircall number_id messages send from

    # Cadence/Messaging Sandbox — every send to an is_test Lead is redirected
    # here regardless of what's on the lead's own phone field (see
    # journey_engine/channels/whatsapp_channel.py + sms_channel.py).
    sandbox_test_phone_number = Column(String, nullable=True)

    # Public API (CMT ↔ SF bridge) — V23
    public_api_key   = Column(Text, nullable=True)                           # AES-256-GCM encrypted key for external tool access

    # V24: Aircall headless sync — tracks last successful nightly catch-up
    aircall_last_sync_at = Column(DateTime(timezone=True), nullable=True)   # UTC timestamp of last successful Aircall pull

    # V25: RCM Contact Center
    rcm_from_number = Column(String, nullable=True)                       # E.164 business caller ID for RCM calls
    rcm_last_sync_at = Column(DateTime(timezone=True), nullable=True)     # UTC timestamp of last successful RCM pull

    # V28: Separate dialer credentials (Contact Center may use a different RCM account)
    dialer_use_shared_creds = Column(Boolean, default=True, nullable=False, server_default="true")  # True = reuse messaging creds
    dialer_base_url         = Column(String, nullable=True)                        # Contact Center base URL (when separate env)
    dialer_api_key          = Column(Text, nullable=True)                        # Encrypted Contact Center API key (when separate)
    dialer_user_id          = Column(String, nullable=True)                      # Contact Center user ID (when separate)

    # V29: Dynamic call outcome configuration (Phase 2)
    outcome_config   = Column(Text, nullable=True)                               # JSON array of outcome definitions

    # V30: Sandbox Refresh — API-to-API tokenized export
    sandbox_token           = Column(Text, nullable=True)                        # AES-256-GCM encrypted sandbox access token (prod-side)
    sandbox_prod_url        = Column(Text, nullable=True)                        # Production API URL (staging-side, encrypted)
    sandbox_prod_token      = Column(Text, nullable=True)                        # Sandbox token for prod (staging-side, encrypted)
    sandbox_last_refresh_at = Column(DateTime(timezone=True), nullable=True)     # Last successful refresh timestamp
    sandbox_last_refresh_status = Column(String, nullable=True)                  # "success" | "failed" | "in_progress"
    sandbox_refresh_lead_count  = Column(Integer, nullable=True)                 # Lead count from last refresh

    # V39: Aircall tag → outcome mapping (JSON object, admin-configurable)
    aircall_tag_mapping = Column(Text, nullable=True)                           # JSON: {"No Answer":"No Answer","Meeting Booked":"Meeting Confirmed",...}

    # V33: RCM Floating Widget settings
    widget_enabled          = Column(Boolean, default=False, nullable=False, server_default="false")
    widget_position         = Column(String, default="bottom-right", nullable=False)  # "bottom-right" | "bottom-left"
    widget_theme            = Column(String, default="dark", nullable=False)           # "dark" | "light"
    widget_allowed_domains  = Column(Text, nullable=True)                             # JSON array of whitelisted domains (Phase 2)

    # V43: Klenty call-activity pull sync (temporary bridge — see docs/RELEASES.md).
    # Pull-only, per-SDR REST API — never wired into dialer_provider/SUPPORTED_PROVIDERS
    # since Klenty cannot place outbound calls.
    klenty_enabled       = Column(Boolean, default=False, nullable=False, server_default="false")
    klenty_api_key       = Column(Text, nullable=True)                                # Encrypted Klenty API key (x-API-key header)
    klenty_last_sync_at  = Column(DateTime(timezone=True), nullable=True)             # UTC timestamp of last successful Klenty pull

    # v10.9.5: email sync health — previously only ran as a side-effect of a
    # user opening a lead's Email tab (no scheduler, no webhook), so a reply
    # could sit unsynced indefinitely. See scheduled_jobs._email_sync_job.
    email_sync_last_run_at = Column(DateTime(timezone=True), nullable=True)

    # V44: Salesforce auto-sync schedule — daily at an admin-configured UTC time,
    # in addition to the existing manual "Sync Salesforce" button. Runs the same
    # pull(if 2-way)+push logic (see salesforce.run_full_salesforce_sync).
    sf_auto_sync_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")
    sf_auto_sync_hour_utc    = Column(Integer, nullable=True)                          # 0-23 UTC; NULL = not configured
    sf_auto_sync_minute_utc  = Column(Integer, default=0, nullable=False, server_default="0")  # 0-59 UTC
    sf_auto_sync_last_run_at = Column(DateTime(timezone=True), nullable=True)          # UTC timestamp of last successful auto-sync

    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Tag(Base):
    """A label applied to leads at upload time — independent of any single
    upload batch (a tag can span multiple imports; a lead can carry several)."""
    __tablename__ = "tags"

    id         = Column(String, primary_key=True, default=generate_uuid)
    name       = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LeadUploadLog(Base):
    """Tracks every enriched lead sheet upload."""
    __tablename__ = "lead_upload_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)
    uploaded_by  = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    filename     = Column(String, nullable=True)
    total_rows   = Column(Integer, default=0)
    created      = Column(Integer, default=0)
    skipped      = Column(Integer, default=0)
    updated      = Column(Integer, default=0)              # V9: leads updated via "update existing" mode
    errors       = Column(Integer, default=0)
    error_detail = Column(Text, nullable=True)       # JSON list of first 10 error messages
    status       = Column(String, default="completed")   # "completed" | "partial" | "failed"
    tag          = Column(String, nullable=True)          # Optional upload tag (e.g. "Apollo", "Lusha", "Hunter")
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

    uploader = relationship("User", foreign_keys=[uploaded_by])


class SalesforceIntegrationLog(Base):
    """Logs every Salesforce API interaction for admin diagnostics."""
    __tablename__ = "salesforce_integration_logs"

    id                = Column(String, primary_key=True, default=generate_uuid)
    timestamp         = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    operation_type    = Column(String, nullable=False)          # create, update, fetch, upsert, query
    sf_object         = Column(String, default="Lead")          # Lead, RecordType, User
    record_identifier = Column(String, nullable=True)           # SF ID or local ID
    first_name        = Column(String, nullable=True)
    last_name         = Column(String, nullable=True)
    email             = Column(String, nullable=True)
    fields_updated    = Column(Text, nullable=True)             # JSON list of field names
    status            = Column(String, nullable=False)           # success / failed
    error_message     = Column(Text, nullable=True)
    request_payload   = Column(Text, nullable=True)             # JSON
    response_payload  = Column(Text, nullable=True)             # JSON
    source_system     = Column(String, default="api")           # sync_button, background_push, call_completed, manual_create


class LoginLog(Base):
    """Records every user login for audit trail with session duration tracking."""
    __tablename__ = "login_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)
    user_id      = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email        = Column(String, nullable=False)
    name         = Column(String, nullable=True)
    role         = Column(String, nullable=True)
    ip_address   = Column(String, nullable=True)
    user_agent   = Column(String, nullable=True)
    login_at     = Column(DateTime(timezone=True), server_default=func.now())
    logout_at    = Column(DateTime(timezone=True), nullable=True)   # set on explicit logout or next login
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True)  # updated by frontend activity pings

    # passive_deletes=True: trust the DB's ON DELETE CASCADE — do NOT nullify user_id before deleting
    # Without this, SQLAlchemy tries SET user_id=NULL which violates the NOT NULL constraint.
    user = relationship("User", backref=backref("login_logs", passive_deletes=True))


def log_user_login(db, user_id, email, name=None, role=None, ip_address=None, user_agent=None):
    """Record a login event. Also closes any previous open session."""
    # Close previous open session (no explicit logout)
    open_sessions = db.query(LoginLog).filter(
        LoginLog.user_id == user_id,
        LoginLog.logout_at == None
    ).all()
    from datetime import datetime, timezone as tz
    for s in open_sessions:
        s.logout_at = datetime.now(tz.utc)

    entry = LoginLog(
        user_id=user_id,
        email=email,
        name=name,
        role=role,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(entry)
    return entry


class SalesforceConnection(Base):
    """
    Stores Salesforce org connection details with encrypted credentials.
    At most one active connection (is_active=True) exists at a time.
    """
    __tablename__ = "salesforce_connections"

    id                    = Column(String, primary_key=True, default=generate_uuid)
    instance_url          = Column(String, nullable=True)
    environment           = Column(String, default="sandbox")           # "sandbox" | "production"
    username              = Column(String, nullable=False)
    password_encrypted    = Column(Text, nullable=False)                # AES-256-GCM encrypted
    security_token_encrypted = Column(Text, nullable=False)            # AES-256-GCM encrypted
    org_id                = Column(String, nullable=True)
    org_name              = Column(String, nullable=True)
    connected_by_user_id  = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    connected_by_name     = Column(String, nullable=True)
    connected_at          = Column(DateTime(timezone=True), server_default=func.now())
    last_sync_at          = Column(DateTime(timezone=True), nullable=True)
    last_sync_status      = Column(String, nullable=True)              # "success" | "failed" | "in_progress"
    last_sync_error       = Column(Text, nullable=True)
    records_synced_last_run = Column(Integer, default=0)
    connection_status     = Column(String, default="connected")        # "connected" | "auth_required" | "disconnected" | "error"
    is_active             = Column(Boolean, default=True, nullable=False)

    connected_by = relationship("User", foreign_keys=[connected_by_user_id])


class UserActivityLog(Base):
    """
    Fire-and-forget activity log for SDR/admin actions.
    Used for metrics dashboard aggregation.
    """
    __tablename__ = "user_activity_logs"

    id          = Column(String, primary_key=True, default=generate_uuid)
    user_id     = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email  = Column(String, nullable=True)
    user_name   = Column(String, nullable=True)
    action_type = Column(String, nullable=False, index=True)           # LOGIN, VIEW_LEAD, UPDATE_LEAD_STATUS, etc.
    object_type = Column(String, nullable=True)                        # "lead", "call", "sync", etc.
    object_id   = Column(String, nullable=True)
    metadata_json = Column(Text, nullable=True)                        # JSON string for extra context
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class UserActivityDailySummary(Base):
    """
    Pre-aggregated daily metrics per user, including time spent (from LoginLog).
    Populated by nightly aggregation job.
    """
    __tablename__ = "user_activity_daily_summary"

    id              = Column(String, primary_key=True, default=generate_uuid)
    summary_date    = Column(String, nullable=False, index=True)       # "YYYY-MM-DD"
    user_id         = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_email      = Column(String, nullable=True)
    user_name       = Column(String, nullable=True)
    login_count     = Column(Integer, default=0)
    lead_views      = Column(Integer, default=0)
    status_updates  = Column(Integer, default=0)
    meetings_scheduled = Column(Integer, default=0)
    calls_logged    = Column(Integer, default=0)
    leads_assigned  = Column(Integer, default=0)
    exports         = Column(Integer, default=0)
    total_actions   = Column(Integer, default=0)
    time_spent_minutes = Column(Integer, default=0)                    # from LoginLog session durations
    created_at      = Column(DateTime(timezone=True), server_default=func.now())


class Feedback(Base):
    """Stores user-submitted feedback, bug reports, and feature requests."""
    __tablename__ = "feedback"

    id         = Column(String, primary_key=True, default=generate_uuid)
    user_id    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_email = Column(String, nullable=True)
    user_name  = Column(String, nullable=True)
    type       = Column(String, nullable=False, default="general")   # "bug" | "feature" | "general"
    message    = Column(Text, nullable=False)
    status     = Column(String, default="new")                       # "new" | "reviewed" | "resolved"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="feedback_entries")


# ═══════════════════════════════════════════════════════════════════════════════
# Nylas Email Integration (V11)
# ═══════════════════════════════════════════════════════════════════════════════

class NylasConfig(Base):
    """
    Single-row configuration table for Nylas email integration.
    Super Admin manages via Settings page. API key and webhook secret are encrypted.
    """
    __tablename__ = "nylas_config"

    id                       = Column(Integer, primary_key=True, default=1)
    client_id                = Column(String, nullable=True)
    api_key_encrypted        = Column(Text, nullable=True)           # AES-256-GCM via crypto.py
    redirect_uri             = Column(String, nullable=True)
    webhook_secret_encrypted = Column(Text, nullable=True)           # AES-256-GCM via crypto.py
    configured_by_user_id    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    configured_by_name       = Column(String, nullable=True)
    configured_at            = Column(DateTime(timezone=True), nullable=True)
    is_active                = Column(Boolean, default=False, nullable=False)


class UserMailbox(Base):
    """
    One Nylas grant per user. Users can only connect their SSO email.
    Stores the Nylas grant_id — never stores OAuth tokens.
    """
    __tablename__ = "user_mailboxes"

    id             = Column(String, primary_key=True, default=generate_uuid)
    user_id        = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    email_address  = Column(String, nullable=False)                  # Must match user's SSO email
    provider       = Column(String, nullable=True)                   # "google" | "microsoft" | etc.
    nylas_grant_id = Column(String, nullable=False)
    status         = Column(String, default="connected")             # "connected" | "disconnected" | "error"
    connected_at   = Column(DateTime(timezone=True), server_default=func.now())

    # passive_deletes=True: trust the DB's ON DELETE CASCADE — do NOT nullify user_id before deleting.
    # Without this, SQLAlchemy tries SET user_id=NULL which violates the NOT NULL constraint on user_mailboxes.
    user = relationship("User", backref=backref("mailbox", passive_deletes=True))


class LeadEmailActivity(Base):
    """
    Log of every email sent to or received from a lead.
    Outbound: logged on send. Inbound: logged by webhook.
    """
    __tablename__ = "lead_email_activity"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    direction        = Column(String, nullable=False)                # "outbound" | "inbound"
    subject          = Column(String, nullable=True)
    body_preview     = Column(Text, nullable=True)                   # Full sanitized body (HTML stripped, quotes removed)
    from_email       = Column(String, nullable=True)
    to_email         = Column(String, nullable=True)
    nylas_message_id = Column(String, nullable=True, index=True)
    nylas_thread_id  = Column(String, nullable=True, index=True)
    timestamp        = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    opened_at        = Column(DateTime(timezone=True), nullable=True)   # First open timestamp
    open_count       = Column(Integer, nullable=True, default=0)        # Total open count
    clicked_at       = Column(DateTime(timezone=True), nullable=True)   # First link-click timestamp
    click_count      = Column(Integer, nullable=True, default=0)        # Total click count
    is_auto_reply    = Column(Boolean, nullable=True, default=False)    # inbound only — OOO/auto-responder, not a real reply
    attachments_json = Column(Text, nullable=True)                      # JSON: [{"id":"...","filename":"...","content_type":"...","size":123}]
    # Sales Journey linkage — NULL for non-cadence email (regular compose/reply).
    journey_id       = Column(String, ForeignKey("journeys.id", ondelete="SET NULL"), nullable=True, index=True)
    enrollment_id    = Column(String, ForeignKey("journey_enrollments.id", ondelete="SET NULL"), nullable=True, index=True)
    journey_node_id  = Column(String, nullable=True)   # which node in the graph sent this (not a separate table — lives in JSONB graph_definition)
    variant_key      = Column(String, nullable=True)    # which A/B variant this send used, if the node has variants

    lead = relationship("Lead", backref="email_activities")
    user = relationship("User")


class EmailThread(Base):
    """
    Maps a Nylas thread_id to a lead_id.
    Created on first outbound email; used by webhook to route inbound replies.
    """
    __tablename__ = "email_threads"

    id              = Column(String, primary_key=True, default=generate_uuid)
    nylas_thread_id = Column(String, nullable=False, unique=True, index=True)
    lead_id         = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead")


class CompanyResearch(Base):
    """
    Caches AI-generated research per company name.
    When AI research is triggered for a lead, the results are stored here
    so that all contacts from the same company share the same research.
    """
    __tablename__ = "company_research"

    id                = Column(String, primary_key=True, default=generate_uuid)
    company_name      = Column(String, nullable=False, unique=True, index=True)
    research_company  = Column(Text, nullable=True)
    research_industry = Column(String, nullable=True)
    research_company_size = Column(String, nullable=True)
    research_services = Column(Text, nullable=True)
    research_geo      = Column(String, nullable=True)
    research_timezone = Column(String, nullable=True)
    research_hook     = Column(Text, nullable=True)
    research_hypothesis = Column(Text, nullable=True)
    research_personalization = Column(Text, nullable=True)
    research_contact  = Column(Text, nullable=True)
    research_channels = Column(Text, nullable=True)
    raw_ai_response   = Column(Text, nullable=True)
    # v8 Research v2: Pre-Call Intelligence Card fields (cached at company level)
    research_heat     = Column(String, nullable=True)   # "hot" | "warm" | "cold"
    research_opening  = Column(Text, nullable=True)     # ready-to-say opening line
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LeadAttachment(Base):
    """File attachments uploaded by SDRs for a lead (V22)."""
    __tablename__ = "lead_attachments"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    original_filename = Column(String, nullable=False)          # The file name the user uploaded
    stored_filename  = Column(String, nullable=False)           # UUID-based name on disk
    file_size        = Column(BigInteger, default=0)            # bytes
    mime_type        = Column(String, nullable=True)
    uploaded_by_name = Column(String, nullable=True)            # Display name of uploader
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="attachments")
    user = relationship("User")


class DialerCall(Base):
    """Unified call record from any dialer provider (Aircall, RCM, etc.)."""
    __tablename__ = "dialer_calls"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    provider         = Column(String, nullable=False)           # "aircall" | "rcm" | "manual"
    provider_call_id = Column(String, nullable=True, index=True) # External call ID from provider
    phone_number     = Column(String, nullable=True)
    status           = Column(String, nullable=False)           # CALL_STARTED | CALL_ANSWERED | CALL_ENDED | FAILED
    direction        = Column(String, nullable=True)            # "inbound" | "outbound"
    duration         = Column(Integer, nullable=True)           # Call duration in seconds
    recording_url    = Column(String, nullable=True)
    outcome          = Column(String, nullable=True)            # SDR-set: "Interested", "No Answer", "Call Back Later", etc.
    provider_disposition = Column(String, nullable=True)        # Raw telephony disposition from the provider itself
                                                                  # (e.g. Klenty's ANSWERED/NOT_ANSWERED/VOICE_MAIL) —
                                                                  # distinct from `outcome`, which batch-synced calls
                                                                  # never get since no SDR tags them through the app.
    notes            = Column(Text, nullable=True)              # SDR notes about the call
    transcript       = Column(Text, nullable=True)              # Call transcript JSON
    started_at       = Column(DateTime(timezone=True), nullable=True)
    answered_at      = Column(DateTime(timezone=True), nullable=True)
    ended_at         = Column(DateTime(timezone=True), nullable=True)
    raw_payload      = Column(Text, nullable=True)              # JSON payload for debugging
    source           = Column(String, default="rcm",      # V24: "rcm" | "aircall_direct"
                             nullable=True, server_default="'rcm'")
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", backref="dialer_calls")
    user = relationship("User", backref="dialer_calls")


def dialer_call_event_time():
    """Real call time for date-range filtering/grouping.

    Prefers started_at (the provider's own call timestamp) over created_at
    (row-insertion time), because batch/catch-up syncs — Klenty (pull-only,
    no webhooks) and Aircall's nightly catch-up — insert historical calls
    with an accurate started_at but a created_at of "whenever the sync ran",
    which can be hours or days after the real call. Falls back to created_at
    for the rare row where started_at was never set (e.g. a directly-dialed
    Aircall call caught by webhook before any started_at is known).
    """
    return func.coalesce(DialerCall.started_at, DialerCall.created_at)


def dialer_call_connected(outcome_values):
    """True when a DialerCall counts as connected: a CRM-tagged outcome (set
    by the SDR through RCM's own dialer) OR a raw provider disposition
    of "ANSWERED" (each provider's own telephony signal — Klenty's synced
    disposition field, Aircall/RCM's answered_at). Many provider-direct
    calls never get an SDR-tagged outcome, so outcome alone reads near-0%
    connect for them — provider_disposition is the only connect signal those
    calls ever carry.
    """
    return or_(
        DialerCall.outcome.in_(outcome_values),
        DialerCall.provider_disposition == "ANSWERED",
    )


CONVERSATION_MIN_SECONDS = 30


def dialer_call_is_conversation(min_seconds: int = CONVERSATION_MIN_SECONDS):
    """True when a DialerCall counts as a real conversation (Analytics'
    "Conversations" column, added 2026-08-14).

    Rule: outcome isn't a not-answered one (voicemail/no-answer/wrong number
    — the only signal for "not a real conversation" this system has today),
    AND duration is either unknown or over min_seconds (org-configurable via
    SyncSettings.conversation_min_seconds; defaults to CONVERSATION_MIN_SECONDS
    for callers — e.g. tests — that don't have a settings row to read).

    Most DialerCall rows (auto-synced, no SDR-tagged outcome) fall through
    the outcome check for free (NULL isn't "in" anything) and let duration
    alone decide — accepted noise: a provider's voicemail pickup can itself
    run 20-30s, and there's no reliable signal to tell that apart from a
    short real answer without an SDR explicitly tagging "Left Voicemail".
    """
    return and_(
        or_(DialerCall.outcome.is_(None), DialerCall.outcome.notin_(list(NOT_ANSWERED_OUTCOMES))),
        or_(DialerCall.duration.is_(None), DialerCall.duration > min_seconds),
    )


def exclude_test_leads(query, model=None):
    """Cadence/Messaging Sandbox test leads (Lead.is_test=True) must never
    appear in real analytics/reporting — excludes rows belonging to one,
    whether the query is anchored on Lead directly or on a table with its
    own lead_id (DialerCall, CallLog, LeadEmailActivity, SmsLog,
    JourneyEnrollment, etc.). Pass the anchor model when Lead isn't
    guaranteed to already be joined into the query — the EXISTS form needs
    no extra join to work.

    Uses an aliased Lead rather than the bare model — some callers (pod/
    lead_source/batch scoping) outerjoin the real Lead into this same query
    further down; without the alias, SQLAlchemy's auto-correlation treats
    that later join as "the same Lead" as this EXISTS's own Lead and
    correlates it away entirely, leaving the EXISTS with zero FROM clauses
    (InvalidRequestError at compile time). Shared by analytics_routes.py and
    journey_routes.py — was two near-identical copies, one per file."""
    if model is None or model is Lead:
        return query.filter(Lead.is_test.is_(False))
    test_lead = aliased(Lead)
    return query.filter(~exists().where(
        (test_lead.id == model.lead_id) & (test_lead.is_test.is_(True))
    ))


def call_log_is_conversation():
    """True when a manually-logged CallLog counts as a real conversation.

    CallLog has no duration column at all (it's an SDR's own outcome note,
    not a telephony record) — so the outcome tag is the *only* signal here,
    unlike dialer_call_is_conversation() where duration is the primary
    signal and outcome is just an override.
    """
    return CallLog.outcome.notin_(list(NOT_ANSWERED_OUTCOMES))


class DialerQueueStatus(Base):
    """Per-lead, per-rep progress through the Power Dialer queue.

    A lead with no row here is untouched ("Pending"). Persisting this
    server-side (rather than the queue's own client-side session Map) is
    what lets the queue survive a page reload, and lets a "called" lead
    drop out of the next fetch instead of reappearing as Pending — see
    2026-08-10 Power Dialer review. One row per (lead, user); a lead
    reassigned to a different rep starts fresh for them.
    """
    __tablename__ = "dialer_queue_status"

    id          = Column(String, primary_key=True, default=generate_uuid)
    lead_id     = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id     = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status      = Column(String, nullable=False)   # "called" | "skipped" | "skipped_dnc"
    skip_reason = Column(String, nullable=True)     # only set for status="skipped" — rep's own words, optional
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lead = relationship("Lead", backref="dialer_queue_statuses")
    user = relationship("User", backref="dialer_queue_statuses")

    __table_args__ = (
        UniqueConstraint("lead_id", "user_id", name="uq_dialer_queue_status_lead_user"),
    )


# ── Error Logs ────────────────────────────────────────────────────────────────
class ErrorLog(Base):
    """
    System-wide error log — captures frontend + backend errors in plain English.
    Designed so non-technical admins can understand issues without Render logs.
    Includes dedup_count to collapse repeated errors (error storm prevention).
    """
    __tablename__ = "error_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)

    # ── Who was affected ──────────────────────────────────────────────────────
    user_id      = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    user_email   = Column(String, nullable=True)
    user_name    = Column(String, nullable=True)
    user_role    = Column(String, nullable=True)

    # ── Classification ────────────────────────────────────────────────────────
    severity     = Column(String, nullable=False, default="warning")
    # "critical" | "warning" | "info"
    source       = Column(String, nullable=False, default="backend")
    # "frontend" | "backend"
    category     = Column(String, nullable=False, default="general")
    # "api" | "research" | "dialer" | "upload" | "auth" | "salesforce" | "general"
    feature      = Column(String, nullable=True)
    # Human-friendly feature name: "Lead Detail", "Upload Center", "Dialer", etc.

    # ── Plain-English content (shown to admins) ───────────────────────────────
    title        = Column(String, nullable=False)          # One-liner: what went wrong
    description  = Column(Text, nullable=True)             # Why it happened (no jargon)
    action_hint  = Column(String, nullable=True)           # What the admin can do now

    # ── Technical context (collapsed in UI, Super Admin only) ────────────────
    http_status  = Column(Integer, nullable=True)          # 500, 422, 503, etc.
    endpoint     = Column(String, nullable=True)           # /api/leads/xyz
    raw_error    = Column(Text, nullable=True)             # Sanitised exception message
    context_json = Column(Text, nullable=True)             # JSON: lead_id, sdr_id, etc.

    # ── Deduplication (error storm collapse) ──────────────────────────────────
    dedup_key    = Column(String, nullable=True, index=True)
    # hash of (category + endpoint + http_status + user_id)
    dedup_count  = Column(Integer, nullable=False, default=1, server_default="1")
    # incremented instead of creating a new row if same error within 5 min
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    # ── Resolution tracking ───────────────────────────────────────────────────
    resolved     = Column(Boolean, nullable=False, default=False, server_default="false")
    resolved_by  = Column(String, nullable=True)           # Name of admin who resolved
    resolved_at  = Column(DateTime(timezone=True), nullable=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    user = relationship("User", foreign_keys=[user_id])


# ── Smart Analytics (v8.5.0) ──────────────────────────────────────────────────

class AnalyticsSavedReport(Base):
    """
    Saved Smart Analytics reports — per-user storage of NL queries + DSL.
    Super Admins see all reports. Pod Admins see their own only.
    Never stores SQL — stores DSL JSON only.
    """
    __tablename__ = "analytics_saved_reports"

    id                     = Column(String, primary_key=True, default=generate_uuid)
    name                   = Column(String, nullable=False)
    created_by             = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role_scope             = Column(String, nullable=True)           # "super_admin" | "pod_admin" — informational
    natural_language_query = Column(Text, nullable=False)
    dsl_json               = Column(Text, nullable=False)            # JSON: {metric, group_by, period, sort, limit}
    chart_type             = Column(String, nullable=True)           # "bar" | "line" | "pie" | "table"
    is_pinned              = Column(Boolean, nullable=False, default=False)  # pinned to Dashboard tab
    pin_order              = Column(Integer, nullable=False, default=0)      # sort order in Dashboard (ASC)
    created_at             = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at             = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class AnalyticsQueryHistory(Base):
    """
    Audit log of every Smart Analytics query attempt.
    Last 5 shown to user as 'Recent Queries' chips. Full table is internal.
    Never stores SQL.
    """
    __tablename__ = "analytics_query_history"

    id                     = Column(String, primary_key=True, default=generate_uuid)
    user_id                = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    natural_language_query = Column(Text, nullable=False)
    dsl_json               = Column(Text, nullable=True)             # NULL if NL parsing failed
    success                = Column(Boolean, nullable=False, default=False)
    execution_time_ms      = Column(Integer, nullable=True)
    error_message          = Column(Text, nullable=True)
    created_at             = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    user = relationship("User", foreign_keys=[user_id])


# ═════════════════════════════════════════════════════════════════════════════
# Sales Journey — workflow automation engine.
# Full design: docs/SALES_JOURNEY_ARCHITECTURE.md (execution model, idempotency,
# guardrails, gap analysis). This is the Phase 0 backbone.
# ═════════════════════════════════════════════════════════════════════════════

class Journey(Base):
    __tablename__ = "journeys"

    id              = Column(String, primary_key=True, default=generate_uuid)
    name            = Column(String, nullable=False)
    owner_id        = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status          = Column(String, nullable=False, default="draft")   # draft | active | paused | archived
    # NULL = all pods (default, matches pre-existing behavior). Set = only leads
    # in this pod can be auto-enrolled — checked in journey_engine.check_entry_triggers.
    pod_id          = Column(String, ForeignKey("pods.id", ondelete="SET NULL"), nullable=True, index=True)
    # Send-time window (all nullable = no restriction, matches pre-existing
    # behavior of sending immediately whenever a step is due). IANA tz name;
    # start/end are local hours in that tz (end exclusive, same-day only —
    # no overnight-wraparound window). send_days is a CSV of weekday ints,
    # Mon=0..Sun=6; NULL = every day. Applied only to nodes that fire an
    # automated send (email/sms) — see journey_engine.engine._apply_send_window.
    send_tz               = Column(String, nullable=True)
    send_window_start_hour = Column(Integer, nullable=True)
    send_window_end_hour   = Column(Integer, nullable=True)
    send_days              = Column(String, nullable=True)
    # use_alter: journeys <-> journey_versions is a circular FK (a journey points
    # at its live version; a version points back at its journey) — use_alter lets
    # create_all() create both tables first, then ALTER TABLE to add this FK.
    live_version_id = Column(String, ForeignKey("journey_versions.id", ondelete="SET NULL", use_alter=True,
                                                  name="fk_journeys_live_version"), nullable=True)
    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    versions = relationship("JourneyVersion", foreign_keys="JourneyVersion.journey_id",
                             back_populates="journey", cascade="all, delete-orphan")
    live_version = relationship("JourneyVersion", foreign_keys=[live_version_id], post_update=True)


class JourneyVersion(Base):
    __tablename__ = "journey_versions"
    __table_args__ = (
        UniqueConstraint("journey_id", "version_number", name="uq_journey_version_number"),
    )

    id               = Column(String, primary_key=True, default=generate_uuid)
    journey_id       = Column(String, ForeignKey("journeys.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number   = Column(Integer, nullable=False)
    # {nodes:[{id,type,position:{x,y},data:{config}}], edges:[{id,source,target,condition_expr?}]}
    # GIN index (ix_journey_versions_graph_gin) is created via migrations.py —
    # Postgres-only, no SQLAlchemy-portable way to declare jsonb_path_ops here.
    graph_definition = Column(_JSONVariant, nullable=False)
    status           = Column(String, nullable=False, default="draft")   # draft | published | superseded
    published_at     = Column(DateTime(timezone=True), nullable=True)
    created_by       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    journey = relationship("Journey", foreign_keys=[journey_id], back_populates="versions")


class JourneyEnrollment(Base):
    __tablename__ = "journey_enrollments"
    __table_args__ = (
        # Partial unique index: any number of historical enrollments per
        # (lead, journey), only one may be 'active' at a time — enforced
        # DB-side, race-safe. Supported on both dialects (SQLite 3.8+ and
        # Postgres both understand partial indexes).
        Index("ix_enrollment_one_active_per_lead_journey", "lead_id", "journey_id", unique=True,
              postgresql_where=text("status = 'active'"), sqlite_where=text("status = 'active'")),
        Index("ix_enrollments_journey_status", "journey_id", "status"),
    )

    id               = Column(String, primary_key=True, default=generate_uuid)
    journey_id       = Column(String, ForeignKey("journeys.id", ondelete="CASCADE"), nullable=False, index=True)
    # RESTRICT: a version with live enrollments can't be deleted out from under them.
    version_id       = Column(String, ForeignKey("journey_versions.id", ondelete="RESTRICT"), nullable=False)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    current_node_id  = Column(String, nullable=False)   # node id from graph_definition.nodes[] — not an FK, lives in JSONB
    node_pass        = Column(Integer, nullable=False, default=0)   # Gap 3: runaway-loop cap counts this
    status           = Column(String, nullable=False, default="active")  # active|completed|failed|exited_early|paused
    trigger_event    = Column(_JSONVariant, nullable=True)   # set by webhook handoff when an event short-circuits a wait node
    enrolled_at      = Column(DateTime(timezone=True), server_default=func.now())
    completed_at     = Column(DateTime(timezone=True), nullable=True)
    exited_reason    = Column(String, nullable=True)   # e.g. "suppressed", "journey_archived", "exceeded_max_node_passes"
    last_error       = Column(String, nullable=True)

    journey = relationship("Journey")
    version = relationship("JourneyVersion")
    lead    = relationship("Lead")


class JourneyExecutionQueue(Base):
    __tablename__ = "journey_execution_queue"
    __table_args__ = (
        # Partial index: done/failed rows (the long-run majority) never need
        # to be found by the poller, so they don't bloat this index.
        Index("ix_queue_claimable", "next_run_at",
              postgresql_where=text("status IN ('pending', 'claimed')"),
              sqlite_where=text("status IN ('pending', 'claimed')")),
    )

    id                = Column(String, primary_key=True, default=generate_uuid)
    enrollment_id     = Column(String, ForeignKey("journey_enrollments.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id           = Column(String, nullable=False)
    next_run_at       = Column(DateTime(timezone=True), nullable=False, index=True)
    status            = Column(String, nullable=False, default="pending")   # pending | claimed | done | failed
    claimed_by        = Column(String, nullable=True)   # worker id (hostname+pid)
    lease_expires_at  = Column(DateTime(timezone=True), nullable=True)
    attempt_count     = Column(Integer, nullable=False, default=0)
    idempotency_key   = Column(String, nullable=False, unique=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    enrollment = relationship("JourneyEnrollment")


class ExecutionLog(Base):
    """Permanent audit trail, designed for billions of rows (range-partitioned
    on Postgres by created_at — see docs/SALES_JOURNEY_ARCHITECTURE.md).
    No FK constraints on enrollment_id/journey_id/lead_id: a real FK would cost
    an index lookup on every insert at this volume, for a fire-and-forget log
    whose integrity is already guaranteed at the application layer (mirrors
    UserActivityLog's existing lack of FK enforcement beyond user_id).
    """
    __tablename__ = "execution_logs"
    __table_args__ = (
        Index("ix_execution_logs_enrollment", "enrollment_id", "created_at"),
        Index("ix_execution_logs_lead", "lead_id", "created_at"),   # Gap 8: GDPR purge-by-lead-id path
        {"postgresql_partition_by": "RANGE (created_at)"},
    )

    # Composite PK (created_at, id): a Postgres requirement for range-partitioned
    # tables — the partition key must be part of the PK. Harmless on SQLite too.
    created_at      = Column(DateTime(timezone=True), primary_key=True, server_default=func.now())
    id              = Column(String, primary_key=True, default=generate_uuid)
    enrollment_id   = Column(String, nullable=False)
    journey_id      = Column(String, nullable=False)   # denormalized — avoids a join for time-range analytics
    lead_id         = Column(String, nullable=False)   # denormalized — Gap 8, survives enrollment cascade-delete
    node_id         = Column(String, nullable=False)
    event_type      = Column(String, nullable=False)   # node_entered | node_completed | node_failed | send_attempted | ...
    channel         = Column(String, nullable=True)     # email | call | linkedin
    status          = Column(String, nullable=False)    # success | failure | skipped
    idempotency_key = Column(String, nullable=True)      # carried through for the duplicate-send check
    detail          = Column(_JSONVariant, nullable=True)   # provider response / error message / condition-eval result


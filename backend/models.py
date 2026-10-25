import logging
import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Table, Text, Boolean, Integer, BigInteger, Float, or_, and_, Index, UniqueConstraint, JSON, text, exists, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship, backref, aliased, Session, attributes
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

# Lead <-> CallList mapping table (a lead can be in several call lists; a
# call list can span leads from any pod/batch — org-wide, user-curated).
call_list_leads = Table(
    'call_list_leads', Base.metadata,
    Column('call_list_id', String, ForeignKey('call_lists.id', ondelete='CASCADE'), primary_key=True, index=True),
    Column('lead_id', String, ForeignKey('leads.id', ondelete='CASCADE'), primary_key=True, index=True),
)

class AllowedUser(Base):
    """Access control table — source of truth for who can log into the CRM."""
    __tablename__ = "allowed_users"

    email    = Column(String, primary_key=True, index=True)
    name     = Column(String)
    role     = Column(String, default="SDR")   # "SDR", "Pod Admin", or "Super Admin"
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    added_by = Column(String, default="system")


class AccessRequest(Base):
    """A Google sign-in attempt from an email not yet in allowed_users — the
    login page's "request access" mechanism. Google already verifies the
    person's identity, so there's no separate request form: trying to sign
    in IS the request (see auth_routes.py's callback). One row per email,
    upserted so repeated attempts just bump requested_at instead of piling
    up duplicates. Deleted automatically the moment a Super Admin adds that
    email via access_db.add_allowed_user (single/CSV add both call it) —
    granting access resolves the request, no separate "dismiss" action."""
    __tablename__ = "access_requests"

    email        = Column(String, primary_key=True, index=True)
    name         = Column(String, nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now())

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

# Pipeline stage of each status: 0 = pre-meeting (Lead Assigned/Research/
# Calling), 1+ = a meeting has been booked. Statuses outside the pipeline
# (Disqualified, Pending Review, Nurture…) are deliberately absent. Used by
# the stage-skip guard, one-owner-before-a-meeting (assign_lead), the
# Aircall "Meeting Set" tag and cadence stop_on_meeting.
STAGE_GROUP = {
    "Lead Assigned": 0, "Research": 0, "Calling": 0,
    "Meeting Scheduled": 1,
    "1st Discovery Meeting": 2, "Discovery Complete": 2,
    "Demo Scheduled": 3, "Demo Done": 3,
    "Completed": 4,
}
ACTIVE_STATUSES   = {"Lead Assigned", "Research", "Calling", "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled"}

# RCA 2026-08-17 (stakeholder report: "wrong-number disqualify not working"):
# lead_detail.js's _activeStatuses shows the "Disqualify Lead" button (Wrong
# Number, Not Interested, etc.) across these 5 statuses, but close_lead()
# hard-required status=="Calling" — a 422 for any lead already past Calling.
# This is the same set the frontend already offers the button on, no wider.
DISQUALIFIABLE_STATUSES = {"Calling", "Meeting Scheduled", "1st Discovery Meeting", "Discovery Complete", "Demo Scheduled"}

# Legacy statuses kept for backwards compat with existing data
LEGACY_STATUSES = {"Customer Declined", "Unreachable"}

# Parked statuses — leads that are in the system but excluded from SDR queues,
# active lead cap calculations, and analytics dashboards.
# "Pending Review" is also parked — it is a Pod Admin holding state for failed demos.
PARKED_STATUSES = {"No Phone - Parked", "Pending Review"}

# Every status value the app itself understands. The status-update paths reject anything else (v13.10.0) — prod
# ended up with `Meeting Booked` ×10 and `Assigned` ×1 because nothing validated the value.
KNOWN_STATUSES = {st.value for st in Status} | PARKED_STATUSES | LEGACY_STATUSES

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
# RCA 2026-08-25: was missing "Unreachable" — a call where the SDR never got
# through is not a live connect, same as No Answer/Voicemail/Wrong Number.
# "Left the Company" stays out on purpose: someone did pick up the phone.
NOT_ANSWERED_OUTCOMES = {"No Answer", "Left Voicemail", "Wrong Number", "Unreachable"}
TERMINAL_OUTCOMES     = {"Not Interested", "Unreachable", "Left the Company"}

# Lowercase mirror for case-insensitive comparisons, plus known malformed
# variants seen in production data — "no_answer" (underscore) isn't just a
# casing difference from "No Answer", it's a distinct literal string a plain
# lower() never folds into the other, so it's listed explicitly. Compare
# func.lower(outcome) against this, not the set above.
NOT_ANSWERED_OUTCOMES_LOWER = {o.lower() for o in NOT_ANSWERED_OUTCOMES} | {"no_answer"}

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
    # RCA 2026-09-29: disabled — sat next to the featured "Meeting Booked"
    # (Meeting Confirmed) card as a lookalike 📆 chip with action "none", so
    # SDRs who picked it logged a meeting that never moved the lead to
    # Meeting Scheduled or counted anywhere (12 prod leads). Kept (disabled)
    # so historical rows and the legacy "Call Completed" mapping stay valid.
    {"value": "Meeting Scheduled",     "group": "answered",     "action": "none",              "notes_required": False, "builtin": True, "enabled": False},
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
                            # RCA 2026-09-29 (staging, Playwright): a saved config is
                            # a copy of the old defaults, so it kept the lookalike
                            # "Meeting Scheduled" (action none) enabled — the trap
                            # disabling it in DEFAULT_OUTCOME_CONFIG was meant to close.
                            if o["value"] == "Meeting Scheduled":
                                o["enabled"] = False
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

# Legacy outcome mapping
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
    active_lead_cap = Column(Integer, default=500, nullable=False)
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
    left_at       = Column(DateTime(timezone=True), nullable=True)   # v13.11.0: set by services/offboarding.py; see left_ids()
    dialer_user_id      = Column(String, nullable=True)                          # Optional manual Aircall/dialer user ID override
    messenger_user_id  = Column(String, nullable=True)                          # Per-SDR Alternate Messenger/Messaging Provider user ID for conversation tagging
    dialer_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")  # v4: per-SDR dialer access toggle
    dialer_provider_override = Column(String, nullable=True)                     # v5.4: per-SDR dialer provider — "aircall" | "messenger" | null (use global)
    messenger_from_number   = Column(String, nullable=True)                     # v5.6: per-SDR Alternate Messenger caller ID (senderId)
    messenger_email         = Column(String, nullable=True)                     # v5.16: per-SDR Alternate Messenger login email (display/audit only)
    # v11.5.22: per-SDR WhatsApp sender number — until now every SDR shared one
    # org-wide sender_id (SyncSettings.messenger_sender_id), unlike calling
    # which already assigns each SDR their own number above. Falls back to the
    # org-wide sender when unset (see journey_engine/channels/whatsapp_channel.py
    # and routes/conversations_routes.py).
    messenger_whatsapp_sender_id = Column(String, nullable=True)
    # v11.10.0: per-SDR messaging access. Until now messaging had no toggle of
    # its own — the Message tab piggybacked on dialer_enabled + a Alternate Messenger
    # dialer provider (see frontend/js/app.js's widget-init gate), so an SDR on
    # Aircall for calling could never message at all and an SDR granted the
    # dialer silently got WhatsApp too. These are the real gates; calling keeps
    # using dialer_enabled above.
    sms_enabled      = Column(Boolean, default=False, nullable=False, server_default="false")
    whatsapp_enabled = Column(Boolean, default=False, nullable=False, server_default="false")
    # Per-SDR messaging vendor — "messenger" | "aircall" | null (use the org
    # default in SyncSettings.messaging_provider). Deliberately separate from
    # dialer_provider_override: an SDR may call on one vendor and message on
    # the other, which is a real supported config.
    messaging_provider_override = Column(String, nullable=True)
    email_sync_enabled = Column(Boolean, default=False, nullable=False, server_default="false")  # v4: per-SDR email sync toggle
    export_blocked     = Column(Boolean, default=False, nullable=False, server_default="false")  # v14.1.0: a Super Admin can switch a Super Admin's (or anyone's) exports OFF; beats every role default
    export_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")  # v14.1.0: may download CSV/Excel exports (Super Admin always may); set by a Super Admin only
    klenty_username    = Column(String, nullable=True)                           # V43: per-SDR Klenty login username; falls back to email at call-site if null
    hide_branding_in_email = Column(Boolean, default=False, nullable=False, server_default="false")  # per-user: suppress the "Alternate CRM · Powered by Alternate Messenger" footer on sent mail
    email_signature_html   = Column(Text, nullable=True)                        # per-user rich-text email signature (sanitized HTML — links/images allowed)
    aircall_everywhere_last_login_at = Column(DateTime(timezone=True), nullable=True)  # v11.4.1: stamped by the embed's onLogin — the only server-side signal of per-SDR Everywhere adoption; the org-wide flag says nothing about who's actually using it

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
    vertical        = Column(String, nullable=True)  # free-text, owner-set (e.g. "Sales/BD", "Patient Ops") — soft guardrail against enrolling into the wrong cadence, see journey_routes.py's enroll()

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

    # V24: Total outbound dial attempts (any source — Alternate CRM or Aircall direct)
    times_called        = Column(Integer, default=0, nullable=False, server_default="0")
    lead_started_at     = Column(DateTime(timezone=True), nullable=True)   # set on first assignment

    # V22: Priority score for lead deprioritization (100=High, 50=Medium, 25=Deprioritized)
    priority_score      = Column(Integer, default=100, nullable=False, server_default="100")
    lead_closed_at      = Column(DateTime(timezone=True), nullable=True)   # set when entering terminal status
    closed_reason       = Column(String, nullable=True)                    # "Not Interested" | "Unreachable" | "Meeting Scheduled"
    deleted_at          = Column(DateTime(timezone=True), nullable=True)   # soft-delete only — see bulk_delete_leads(); row and related data are never hard-deleted

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

    # V18: Audience Manager (Alternate Messenger messaging) contact reference
    am_record_id        = Column(String, nullable=True)                    # Audience Manager contact record ID

    # V8: Opportunity outcome tracking (set by Pod Admin / Super Admin)
    opportunity_status     = Column(String, nullable=True)     # "Won" | "Lost" | null
    opportunity_notes      = Column(Text, nullable=True)       # Context from admin
    opportunity_updated_at = Column(DateTime(timezone=True), nullable=True)

    # Power Dialer call script — per-lead override. Distinct from `Note`
    # (below) and CallLog.notes, which are a history of what was said, not a
    # thing to prep from before the call. When set, this beats the
    # cadence-level default script surfaced via the lead's open Task (see
    # Task.description) — an SDR who tailored a script for this specific
    # lead should see theirs, not the generic one. See CurrentCallCard.jsx.
    talking_points = Column(Text, nullable=True)
    opportunity_updated_by = Column(String, nullable=True)      # Name of who set it

    # v11.4.2: real Salesforce Opportunity Id (006...) this lead is linked to —
    # set when a direct-dial webhook matches an inbound call to an existing SF
    # Opportunity/Contact rather than creating a placeholder lead (see
    # salesforce.find_lead_or_opportunity_by_phone). Distinct from sf_lead_id
    # (the 00Q... Lead record) since a phone can match either object.
    sf_opportunity_id = Column(String, nullable=True)

    status_changed_at = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Sales Journey (docs/SALES_JOURNEY_ARCHITECTURE.md, Gap 1): no part of
    # Alternate CRM enforced contact suppression before this — checked fresh on
    # every automated send, not just at enrollment time.
    do_not_contact   = Column(Boolean, nullable=False, default=False)
    unsubscribed_at  = Column(DateTime(timezone=True), nullable=True)
    # A rep (or an Aircall "wrong number" tag) found the phone doesn't reach this
    # person. Call/text cadence steps skip while set; email is untouched. Cleared
    # when the phone is edited to a different number (lead_service).
    phone_invalid_at = Column(DateTime(timezone=True), nullable=True)

    # Instantly.ai pull-sync (informational only — never written to by
    # anything except _instantly_sync_job, never read by eligibility/journey/
    # kanban-move validation; the SDR still makes every Lead.status change
    # themselves via PATCH /leads/kanban/move).
    instantly_interest_status = Column(Integer, nullable=True)   # raw lt_interest_status
    instantly_interest_label  = Column(String, nullable=True)    # resolved via known enum or lead-labels cache
    instantly_last_synced_at  = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    assigned_users = relationship("User", secondary=lead_assignments, back_populates="assigned_leads")
    notes          = relationship("Note", back_populates="lead", cascade="all, delete-orphan", order_by="Note.created_at.desc()")
    tasks          = relationship("Task", back_populates="lead", cascade="all, delete-orphan", order_by="Task.created_at.asc()")
    call_logs      = relationship("CallLog", back_populates="lead", cascade="all, delete-orphan", order_by="CallLog.called_at.desc()")
    status_logs    = relationship("LeadStatusLog", back_populates="lead", cascade="all, delete-orphan", order_by="LeadStatusLog.changed_at.desc()")
    attachments    = relationship("LeadAttachment", back_populates="lead", cascade="all, delete-orphan", order_by="LeadAttachment.created_at.desc()")
    tags           = relationship("Tag", secondary=lead_tags, backref="leads")
    call_lists     = relationship("CallList", secondary=call_list_leads, backref="leads")
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
    # Populated only when journey_engine creates this Task from a "call"-type
    # cadence node with a script filled in (see NodeConfigPanel.jsx's
    # CallFields) — the cadence-level default script for the Power Dialer
    # card, one level below Lead.talking_points' per-lead override. Blank
    # for every other task (manually-created ones, or a call node with no
    # script set) — not a general-purpose task description field.
    description   = Column(Text, nullable=True)
    done          = Column(String, default="false")   # "true" / "false" — simple for SQLite compat
    due_date      = Column(String)
    due_time      = Column(DateTime(timezone=True), nullable=True)   # precise reminder time
    snoozed_until = Column(DateTime(timezone=True), nullable=True)   # snooze expiry
    dismissed     = Column(String, default="false")                  # notification dismissed
    # A manual cadence step ("task" node) owns this task: completing it is
    # what advances that enrollment (journey_engine.engine.complete_manual_step).
    journey_enrollment_id = Column(String, ForeignKey("journey_enrollments.id", ondelete="SET NULL"), nullable=True, index=True)
    journey_node_id       = Column(String, nullable=True)
    outcome_options       = Column(Text, nullable=True)   # JSON list of {"key","label"} the rep picks from, e.g. Accepted / Not accepted
    outcome               = Column(String, nullable=True) # the picked key
    # v13.1.0 manual-email cadence step (Viren's request): kind="email_approval"
    # marks this Task as a drafted cadence email awaiting the rep's review and
    # send, distinct from a generic manual step (kind=None). draft_subject/
    # draft_body/draft_body_format are the merge-resolved content at the
    # moment the step parked — the rep can edit before sending (the edit
    # flows through journey_engine.engine.complete_manual_email_step, not a
    # rewrite of this row).
    kind              = Column(String, nullable=True)
    draft_subject     = Column(Text, nullable=True)
    draft_body        = Column(Text, nullable=True)
    draft_body_format = Column(String, nullable=True)  # "html" | "text"
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
    # RCA 2026-08-19: the paired CallLog auto-created alongside an Aircall-tag
    # AutoLog'd DialerCall (dialer_service._auto_log_outcome) had no link back
    # to it — an SDR correcting the outcome via log_call() could update the
    # DialerCall (what analytics reads) with no way to find and update this
    # row too, leaving a stale duplicate showing the old wrong outcome.
    dialer_call_id = Column(String, ForeignKey("dialer_calls.id", ondelete="SET NULL"), nullable=True, index=True)

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
    # v13.11.0: the person's id, so reports stop matching on names. NULL on rows older than this release and on system
    # moves (Salesforce sync, cadences). No FK: it is history.
    changed_by_user_id = Column(String, nullable=True)
    changed_at  = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="status_logs")


class LeadOwnershipPeriod(Base):
    """One stretch of a user owning a lead (valid_to NULL = current owner).

    Written by a Postgres trigger on lead_assignments (see ownership_history.py) so no code path or manual SQL can
    skip it; `reason`/`assigned_by` come from per-transaction context and read 'script/unknown' when none was set.
    Intentionally NO foreign keys: it is history and must survive a hard-deleted lead or user."""
    __tablename__ = "lead_ownership_periods"

    id           = Column(String, primary_key=True, default=generate_uuid)
    lead_id      = Column(String, nullable=False)
    user_id      = Column(String, nullable=False)
    valid_from   = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    valid_to     = Column(DateTime(timezone=True), nullable=True)
    reason       = Column(String, nullable=True)       # why it started (bulk-assign, upload, script/unknown, …)
    assigned_by  = Column(String, nullable=True)       # user id of whoever did it, when the app knew
    ended_reason = Column(String, nullable=True)
    ended_by     = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_lop_lead_from", "lead_id", "valid_from"),
        Index("ix_lop_user_from", "user_id", "valid_from"),
        Index("ix_lop_open", "lead_id", postgresql_where=text("valid_to IS NULL")),
    )


class LeadMeeting(Base):
    """One row per meeting booking (v13.11.0). The lead row keeps only the latest meeting date, so it can't say who
    booked, whether it was held, or that a lead booked, missed and rebooked. Written from models.log_status_change (the
    one place every booking path passes through) by meeting_log.py. No FKs on user ids: it is history."""
    __tablename__ = "lead_meetings"

    id                 = Column(String, primary_key=True, default=generate_uuid)
    lead_id            = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    booked_at          = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    booked_by_user_id  = Column(String, nullable=True)     # NULL = not a person (Salesforce sync) or unknown (backfill)
    meeting_at         = Column(DateTime(timezone=True), nullable=True)   # when the meeting is/was due
    status             = Column(String, nullable=False, default="booked")  # booked | held | no_show | cancelled
    held_at            = Column(DateTime(timezone=True), nullable=True)
    no_show_at         = Column(DateTime(timezone=True), nullable=True)
    source             = Column(String, nullable=True)     # app | aircall-tag | salesforce-sync | backfill

    __table_args__ = (
        Index("ix_lead_meetings_lead", "lead_id", "booked_at"),
        Index("ix_lead_meetings_booked_at", "booked_at"),
        Index("ix_lead_meetings_booker", "booked_by_user_id", "booked_at"),
    )


class LeadFieldHistory(Base):
    """Field-level audit trail for a Lead's identity/contact fields.

    RCA 2026-08-17 (LIVE): resolving a "lead lost its name" report required
    raw DB forensics (activity logs, dialer_calls, cross-referencing
    timestamps) because nothing tracked what changed on a Lead, only status
    transitions (LeadStatusLog above) and coarse view/create events
    (user_activity_logs). This closes that gap.

    Rows are written automatically by the `before_flush` listener below —
    never construct this directly from a route.
    """
    __tablename__ = "lead_field_history"

    id         = Column(String, primary_key=True, default=generate_uuid)
    lead_id    = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    field_name = Column(String, nullable=False)
    old_value  = Column(Text, nullable=True)   # None = field was previously unset (incl. initial creation)
    new_value  = Column(Text, nullable=True)
    changed_by = Column(String, nullable=True)  # name/email, or "system:<job>" — same convention as LeadStatusLog.changed_by
    changed_at = Column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead")


# Tracked fields: identity/contact fields worth an audit trail. Deliberately
# excludes research_*/company_* enrichment (churns constantly, already
# low-value to diff), call counters, and status (already in LeadStatusLog).
_LEAD_HISTORY_FIELDS = (
    "first_name", "last_name", "email", "phone", "phone_secondary",
    "company", "title", "linkedin_url", "person_linkedin", "pod_id",
)


@event.listens_for(Session, "before_flush")
def _record_lead_field_history(session, flush_context, instances):
    """Automatically diffs tracked Lead fields on every insert/update in this
    session and writes a LeadFieldHistory row per changed field.

    This is SQLAlchemy's own documented pattern for an audit-history event
    listener (using before_flush to add related rows for pending changes) —
    not a bespoke mechanism. It fires for every write path (routes,
    scheduled_jobs.py syncs, salesforce.py, admin scripts) without needing to
    touch each one, which is the point: a future write site nobody
    remembers to instrument still gets captured.

    Actor attribution: session.info.get("change_actor", "system") — the
    Session.info dict is built into every SQLAlchemy session already; no new
    plumbing needed. Set it before commit at the write sites that matter
    (see routes/lead_helpers.py::_can_modify_lead, scheduled_jobs.py's sync
    jobs); anywhere it's unset, the diff is still captured, just attributed
    to plain "system".
    """
    changed_by = session.info.get("change_actor", "system")

    for lead in session.new.union(session.dirty):
        if not isinstance(lead, Lead):
            continue
        # New leads don't get their Column(default=generate_uuid) id applied
        # until the INSERT is compiled — after before_flush runs. Assign it
        # now so LeadFieldHistory rows reference the same id the Lead gets.
        if lead.id is None:
            lead.id = generate_uuid()
        for field in _LEAD_HISTORY_FIELDS:
            hist = attributes.get_history(lead, field)
            if not (hist.added or hist.deleted):
                continue
            old_value = hist.deleted[0] if hist.deleted else None
            new_value = hist.added[0] if hist.added else getattr(lead, field)
            if old_value == new_value:
                continue
            session.add(LeadFieldHistory(
                lead_id=lead.id,
                field_name=field,
                old_value=str(old_value) if old_value is not None else None,
                new_value=str(new_value) if new_value is not None else None,
                changed_by=changed_by,
            ))


def log_status_change(db, lead_id, from_status, to_status, changed_by="system", changed_by_user_id=None):
    """Reusable helper — call from any route to record a status transition.
    Pass changed_by_user_id whenever a person made the move (user["sub"]); leave it off for system moves."""
    entry = LeadStatusLog(
        lead_id=lead_id,
        from_status=from_status,
        to_status=to_status,
        changed_by=changed_by,
        changed_by_user_id=changed_by_user_id,
    )
    db.add(entry)
    # RCA 2026-09-07: this session runs with autoflush=False, so `entry` (and
    # anything the caller already changed earlier in the same request, e.g.
    # the lead's status-transition itself) would otherwise still be sitting
    # unflushed in-memory when the SAVEPOINT below opens — a live test proved
    # a nested-transaction rollback undoes EVERY statement issued since the
    # savepoint began, including any of this pending work that the SAVEPOINT's
    # own first flush happens to carry along with it. Flushing here, before
    # the SAVEPOINT exists, makes this work part of the outer transaction —
    # immune to a later rollback scoped to the SAVEPOINT alone.
    db.flush()

    # v13.11.0: meeting record + lead_closed_at stamp. Every booking path (call outcome, status update, Aircall tag,
    # Salesforce pull) funnels through here, so one hook covers all four. Own SAVEPOINT: never breaks the status move.
    if to_status and from_status != to_status:
        try:
            _lead = db.query(Lead).filter(Lead.id == lead_id).first()
            if _lead:
                with db.begin_nested():
                    import meeting_log
                    meeting_log.on_status_change(db, _lead, from_status, to_status, changed_by, changed_by_user_id)
        except Exception as e:
            logger.error(f"[meeting_log] could not record the meeting for lead {lead_id}: {e}")

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
                # RCA 2026-09-07 (live, PendingRollbackError on /api/calls/start):
                # two concurrent status changes for the same lead can both pass
                # enroll_lead's check-then-insert against the partial unique index
                # and race on the INSERT — one hits IntegrityError. A plain
                # `except: pass` left that swallowed error poisoning the whole
                # session, so the caller's own later db.commit() raised
                # PendingRollbackError instead, surfacing as an opaque 500 with
                # no trace back to here. A bare db.rollback() would fix that but
                # also discard this function's own `db.add(entry)` above and
                # anything the caller already changed earlier in the same
                # request (e.g. the lead's status-transition itself) — a
                # SAVEPOINT lets only the trigger-check's own failed work roll
                # back, leaving the rest of the session intact for the caller's
                # eventual commit (guaranteed by the flush above). This is the
                # one shared choke point every caller of log_status_change
                # routes through, so fixing it here covers all of them.
                with db.begin_nested():
                    # Entry only on a real change — a re-save of the status the lead is
                    # already in must not enroll (creation, from None, still counts).
                    # check_entry_triggers also guards this for any other caller.
                    if from_status != to_status:
                        check_entry_triggers(db, "status_changed", lead, commit=False,
                                             to_status=to_status, from_status=from_status)
                    # Phase 1 (Gap: conditional branching) — a lead currently parked on
                    # a condition node waiting for this status change gets its early-exit
                    # signal here too. commit=False for the same reason as above; the
                    # 30s poller tick is the guaranteed backstop for the actual branch.
                    check_exit_triggers(db, "status_changed", lead, commit=False, to_status=to_status)
        except Exception as e:
            # Note: no db.rollback() here — the SAVEPOINT's own context
            # manager (above) already rolled back exactly the trigger-check's
            # failed work when the exception propagated out of the `with`
            # block. A bare db.rollback() here would roll back the ENTIRE
            # outer transaction instead, discarding `entry` and anything else
            # already flushed earlier in this request — the opposite of what
            # this fix is for.
            logger.error(f"[JourneyEngine] trigger check failed for lead {lead_id}: {e}")

    return entry


def record_lead_history(db, lead_id, field_name, old_value, new_value, changed_by="system"):
    """Explicit LeadFieldHistory row for changes the before_flush listener cannot
    see (tags and assignees live in association tables, not Lead columns)."""
    db.add(LeadFieldHistory(lead_id=lead_id, field_name=field_name,
                            old_value=old_value, new_value=new_value, changed_by=changed_by))


def assign_lead(user, lead, reason=None, actor_id=None) -> bool:
    """Assign `lead` to `user` if not already assigned, syncing lead.pod_id to
    the assignee's pod. Every direct-assignment call site should route through
    this — a lead assigned outside a pod-based round-robin (which sets pod_id
    itself) previously left pod_id untouched, so it silently fell out of every
    pod-scoped query (analytics, pod dashboards) despite having an active SDR.
    Returns True if the assignment happened.

    RCA 2026-09-29: this used to only append, so every "reassign" (bulk
    assign, Leads Hub row/bulk bar, POD assign, upload re-import) left the
    previous SDR on the lead too — 78 prod leads had 2+ SDRs, 49 of them from
    one 2026-09-23 bulk reassignment. It now replaces any existing assignee
    with the SAME role, so a lead has at most one SDR (and one AE).

    Before a meeting is booked a lead has ONE owner — whoever was assigned
    last, any role (user's rule, 2026-09-29: 141 prod leads kept their AE after
    a 31 Aug reassignment to an SDR). Once a meeting exists, an AE taking over
    keeps the SDR who booked it (same-role replace only)."""
    if lead in user.assigned_leads:
        return False
    # Ownership history (ownership_history.py): tell the lead_assignments trigger WHY/BY WHOM. Metadata only.
    if reason:
        _sess = attributes.instance_state(lead).session
        if _sess is not None:
            from ownership_history import set_assignment_context
            set_assignment_context(_sess, reason, actor_id)
    # ponytail: statuses outside the pipeline (Disqualified, Pending Review…)
    # fall back to "has a meeting ever been booked".
    pre_meeting = STAGE_GROUP.get(lead.status, 0) == 0 and lead.meeting_scheduled_at is None
    for other in [u for u in lead.assigned_users if pre_meeting or u.role == user.role]:
        lead.assigned_users.remove(other)
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


class ReassignRequest(Base):
    """Maker-checker approval for moving an already-owned lead to the requester.
    Created from the duplicate-lead 409 (an SDR tried to add a contact another rep
    already owns); Pod Admin (or above) approves/rejects — see
    routes/reassign_routes.py. Mirrors DisqualifyRequest."""
    __tablename__ = "reassign_requests"

    id                   = Column(String, primary_key=True, default=generate_uuid)
    lead_id              = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by         = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    requested_at         = Column(DateTime(timezone=True), server_default=func.now())
    note                 = Column(String, nullable=True)
    status               = Column(String, nullable=False, default="pending")  # pending|approved|rejected
    reviewed_by          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at          = Column(DateTime(timezone=True), nullable=True)
    rejection_reason     = Column(String, nullable=True)


class SavedView(Base):
    """A person's saved Leads filter set ("view"). Per user and server-side so it follows them to any browser or
    device — it used to live in that one browser's localStorage and silently vanished elsewhere."""
    __tablename__ = "saved_views"

    id         = Column(String, primary_key=True, default=generate_uuid)
    user_id    = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name       = Column(String, nullable=False)
    filters    = Column(_JSONVariant, nullable=True)
    keys       = Column(_JSONVariant, nullable=True)
    search     = Column(String, nullable=True)
    scope      = Column(String, nullable=False, default="leads", server_default="leads")   # "leads" (Leads page) | "digest" (Team Digest: keys = the KPI tiles, in order)
    shared     = Column(Boolean, nullable=False, default=False, server_default="false")   # a Team Digest view an admin shared with everyone (read-only for them)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SmsLog(Base):
    """Records every outbound / inbound SMS or WhatsApp message — both the
    Cadence engine's automated sends and the Alternate Messenger Widget's manual sends
    write here, so one table backs the Activity feed regardless of which
    triggered it or which provider carried it."""
    __tablename__ = "sms_logs"

    id           = Column(String, primary_key=True, default=generate_uuid)
    message_id   = Column(String, nullable=True, index=True)  # Alternate Messenger messageId (alternatecrm-xxx) or temp_unique_id (Widget)
    lead_id      = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id      = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    direction    = Column(String, nullable=False)              # "outbound" | "inbound"
    status       = Column(String, default="sent", nullable=False)  # outbound: "sent" | "delivered" | "failed"; inbound: "received"
    phone_number = Column(String, nullable=True)               # recipient (outbound) or sender (inbound)
    message_text = Column(Text, nullable=True)
    sent_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    # Sales Journey linkage — NULL for a manually-sent message (Widget).
    journey_id      = Column(String, ForeignKey("journeys.id", ondelete="SET NULL"), nullable=True, index=True)
    enrollment_id   = Column(String, ForeignKey("journey_enrollments.id", ondelete="SET NULL"), nullable=True, index=True)
    journey_node_id = Column(String, nullable=True)
    # v10.9.13: Widget persistence + provider-agnostic groundwork.
    channel         = Column(String, default="sms", nullable=False)       # "sms" | "whatsapp"
    provider        = Column(String, default="messenger", nullable=False)  # "messenger" | "aircall" (future)
    conversation_id = Column(String, nullable=True)  # Alternate Messenger Converse Desk thread id (Widget sends only)
    template_name   = Column(String, nullable=True)  # WhatsApp MTM template used, if any
    # RCA 2026-08-25: status="failed" alone gives no way to tell a session-
    # expired rejection from a bad template or an invalid number apart — every
    # failure looked identical in the UI. Populated from the provider's own
    # error string wherever one is available.
    failure_reason  = Column(Text, nullable=True)

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
    # CSM Portal foundation: Opportunity/Account sync, separate from Lead's
    # sync_direction above — scoped narrowly to stage + close_date, not the
    # whole Opportunity object. Same "push_only"/"both" semantics.
    opportunity_sync_direction = Column(String, default="push_only")
    # Master off switch for the AE/CSM action-triggered pushes (close/update/
    # renewal-create) — deliberately separate from opportunity_sync_direction
    # above, which only ever gated the scheduled bulk pull, never these
    # per-action pushes. Defaults OFF: a fresh org gets zero Salesforce
    # write-back until an admin has verified the field mapping (see
    # ae_pipeline_routes.py's stage-options endpoint) and turns it on.
    opportunity_writeback_enabled = Column(Boolean, default=False, nullable=False, server_default="false")
    allow_multi_pod_sdr = Column(Boolean, default=False, nullable=False, server_default="false")  # Allow SDR in multiple pods

    # Phase 3: Configurable caps & attempt limits
    # RCA 2026-09-22: no longer enforced (deprecated org-wide) — kept only as
    # the source for admin_user_routes.py's informational per-user
    # `max_active` display, which BulkActionBar.jsx uses to softly label/rank
    # SDRs in the manual assign picker. Never blocks an assignment anymore.
    active_lead_cap                  = Column(Integer, default=5, nullable=False)
    max_call_attempts                = Column(Integer, default=5, nullable=False)     # warn after this many No Answer/Voicemail
    min_call_attempts_for_unreachable = Column(Integer, default=3, nullable=False)    # min before allowing Unreachable
    sync_declined_to_salesforce      = Column(Boolean, default=False, nullable=False) # push Customer Declined to SF
    sync_unreachable_to_salesforce   = Column(Boolean, default=False, nullable=False) # push Unreachable to SF
    terminal_lead_cooldown_days      = Column(Integer, default=30, nullable=False)    # days before terminal leads recycle
    conversation_min_seconds         = Column(Integer, default=120, nullable=False, server_default="120")  # shared Connect Rate / Conversations disposition-unknown fallback threshold (raised from 30 on 2026-08-31)
    # Team Digest "ICP fit": JSON list of words; a lead whose industry contains one of them is in the ideal customer profile. NULL = the default ("health").
    icp_keywords = Column(Text, nullable=True)

    # AI / LLM settings (Super Admin configurable)
    llm_provider    = Column(String, default="groq", nullable=False)       # "groq" | "gemini" | "openai"
    llm_api_key     = Column(Text, nullable=True)                          # encrypted API key
    llm_model       = Column(String, default="gemma2-9b-it", nullable=False)
    research_prompt = Column(Text, nullable=True)                          # custom system prompt override (NULL = use default)
    # v8 Research v2: admin-controlled research gate toggle
    require_research_before_calling = Column(Boolean, default=False, nullable=False, server_default="false")  # False = gate off (default); True = 4 fields required

    # Dialer / Calling provider settings (Super Admin configurable)
    dialer_provider      = Column(String, default="none", nullable=False)    # "none" | "aircall" | "messenger"
    dialer_api_id        = Column(String, nullable=True)                     # Provider API ID (e.g. Aircall API ID)
    dialer_api_token     = Column(Text, nullable=True)                       # Encrypted provider API token
    dialer_webhook_token = Column(String, nullable=True)                     # Webhook verification token
    dialer_webhook_url_override = Column(String, nullable=True)              # Admin override for the displayed Webhook URL; NULL = auto-derived from this deploy's own base URL

    # V45: Aircall Everywhere (embedded browser softphone) — org-wide kill switch.
    # Default False until piloted; SDR-level adoption is client-side (localStorage),
    # not a DB column — see docs plan for the reasoning.
    aircall_everywhere_enabled = Column(Boolean, default=False, nullable=False, server_default="false")

    # Alternate Messenger / Messaging Provider messaging component settings (Super Admin configurable)
    messenger_enabled     = Column(Boolean, default=False, nullable=False, server_default="false")
    messenger_base_url    = Column(String, default="https://app.messaging_provider.com", nullable=True)
    # AES-256-GCM encrypted (crypto.py), like dialer_api_token / llm_api_key
    # / messenger_access_token / public_api_key. Column name is unchanged, so
    # the plaintext `messenger_api_key` property below keeps all ~15 existing
    # readers working — read through that, never this. Safe as a Python-level
    # property because nothing filters on this column in SQL (checked).
    messenger_api_key_encrypted = Column("messenger_api_key", String, nullable=True)
    messenger_user_id     = Column(String, nullable=True)                   # Messaging Provider user ID
    messenger_account_id  = Column(String, nullable=True)                   # Alternate Messenger account ID (for Converse Desk API)
    messenger_sender_id   = Column(String, nullable=True)                   # WhatsApp/SMS sender number e.g. "918956778474"
    messenger_access_token = Column(Text, nullable=True)                    # JWT access token (encrypted)

    # Messaging provider selection (Widget manual sends + Cadence WhatsApp/SMS
    # channel both resolve through this) — "messenger" or "aircall". Aircall
    # messaging reuses the same dialer_api_id/dialer_api_token credentials
    # already stored above for calling; only the send-from number differs.
    messaging_provider          = Column(String, default="messenger", nullable=False, server_default="messenger")
    aircall_messaging_number_id = Column(String, nullable=True)              # Aircall number_id messages send from

    # Cadence/Messaging Sandbox — every send to an is_test Lead is redirected
    # here regardless of what's on the lead's own phone field (see
    # journey_engine/channels/whatsapp_channel.py + sms_channel.py).
    sandbox_test_phone_number = Column(String, nullable=True)

    # Public API (CMT ↔ SF bridge) — V23
    public_api_key   = Column(Text, nullable=True)                           # AES-256-GCM encrypted key for external tool access
    # Usage tracking for the Public API / MCP bridge — incremented on every
    # successful X-API-Key auth (backend/auth.py::require_api_key), surfaced
    # in the Control Center card so admins can see if it's actually in use.
    public_api_call_count   = Column(Integer, default=0, nullable=False, server_default="0")
    public_api_last_used_at = Column(DateTime(timezone=True), nullable=True)

    # V24: Aircall headless sync — tracks last successful nightly catch-up
    aircall_last_sync_at = Column(DateTime(timezone=True), nullable=True)   # UTC timestamp of last successful Aircall pull
    # v11.5.3: the nightly catch-up + startup catch-up together were pulling
    # every org's full Aircall call history on every restart, adding load the
    # team needs to pause without ripping the job out. Defaults True (today's
    # behavior unchanged) — mirrors klenty_enabled's on/off switch below.
    aircall_sync_enabled = Column(Boolean, default=True, nullable=False, server_default="true")

    # V25: Alternate Messenger Contact Center
    messenger_from_number = Column(String, nullable=True)                       # E.164 business caller ID for Alternate Messenger calls
    messenger_last_sync_at = Column(DateTime(timezone=True), nullable=True)     # UTC timestamp of last successful Alternate Messenger pull

    # V28: Separate dialer credentials (Contact Center may use a different Alternate Messenger account)
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

    # V33: Alternate Messenger Floating Widget settings
    # v11.10.0: widget_enabled removed — it was stored, PATCH-able and rendered
    # as an "Enable Conversations Tab" toggle, but nothing in the mount path
    # ever read it, so flipping it did nothing. Org-level messaging on/off is
    # messenger_enabled; per-SDR access is users.sms_enabled/whatsapp_enabled.
    # The DB column is left in place (dropping columns is not worth the risk);
    # it is simply no longer mapped or exposed.
    widget_position         = Column(String, default="bottom-right", nullable=False)  # "bottom-right" | "bottom-left"
    widget_theme            = Column(String, default="dark", nullable=False)           # "dark" | "light"
    widget_allowed_domains  = Column(Text, nullable=True)                             # JSON array of whitelisted domains (Phase 2)

    # V43: Klenty call-activity pull sync (temporary bridge — see docs/RELEASES.md).
    # Pull-only, per-SDR REST API — never wired into dialer_provider/SUPPORTED_PROVIDERS
    # since Klenty cannot place outbound calls.
    klenty_enabled       = Column(Boolean, default=False, nullable=False, server_default="false")
    klenty_api_key       = Column(Text, nullable=True)                                # Encrypted Klenty API key (x-API-key header)
    klenty_last_sync_at  = Column(DateTime(timezone=True), nullable=True)             # UTC timestamp of last successful Klenty pull

    # Instantly.ai campaign/lead-engagement pull sync (polling-only v1 — see
    # docs/RELEASES.md). Unlike Klenty's scattered encrypt/decrypt-at-call-site
    # pattern, the key uses the same transparent property pair as
    # messenger_api_key below — every caller just reads/writes plaintext.
    instantly_enabled           = Column(Boolean, default=False, nullable=False, server_default="false")
    instantly_api_key_encrypted = Column("instantly_api_key", Text, nullable=True)
    instantly_last_sync_at      = Column(DateTime(timezone=True), nullable=True)      # UTC timestamp of last clean full sync

    # Send-side (v13.3.0): a journey's Instantly-sequence node hands sending off
    # to Instantly's own campaign engine — see JourneyInstantlyCampaign/
    # JourneyInstantlyEnrollment above. Webhook secret uses the same transparent
    # property pair as instantly_api_key; never user-supplied (generated
    # server-side on first registration), never returned after that.
    instantly_webhook_secret_encrypted = Column("instantly_webhook_secret", Text, nullable=True)
    instantly_webhook_id               = Column(String, nullable=True)  # Instantly's own webhook object id, for idempotent re-register/delete
    instantly_mail_cursor              = Column(Text, nullable=True)    # JSON {"received": iso, "sent": iso} — v13.8.0 mail-sync watermark per direction
    instantly_sending_accounts         = Column(Text, nullable=True)    # JSON list of mailbox emails to restrict campaigns to; NULL = all active accounts
    # v13.4.0 Claude connector (routes/mcp_routes.py): off = read-only tools
    # only. A Super Admin switches it on in Settings — no rebuild needed.
    mcp_write_enabled                  = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    # Who may connect Claude: False = Super Admins only (default while it's new), True = every user.
    mcp_everyone_enabled               = Column(Boolean, nullable=False, default=False, server_default=text("false"))

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

    @property
    def messenger_api_key(self):
        """Plaintext key, decrypted on read. A pre-encryption row fails to
        decrypt and is returned directly.
        """
        raw = self.messenger_api_key_encrypted
        if not raw:
            return raw
        from crypto import decrypt_token
        try:
            return decrypt_token(raw)
        except Exception:
            return raw

    @messenger_api_key.setter
    def messenger_api_key(self, value):
        if not value:
            self.messenger_api_key_encrypted = value
            return
        from crypto import encrypt_token
        self.messenger_api_key_encrypted = encrypt_token(value)

    @property
    def instantly_api_key(self):
        """Plaintext key, decrypted on read — same shape as messenger_api_key above."""
        raw = self.instantly_api_key_encrypted
        if not raw:
            return raw
        from crypto import decrypt_token
        try:
            return decrypt_token(raw)
        except Exception:
            return raw

    @instantly_api_key.setter
    def instantly_api_key(self, value):
        if not value:
            self.instantly_api_key_encrypted = value
            return
        from crypto import encrypt_token
        self.instantly_api_key_encrypted = encrypt_token(value)

    @property
    def instantly_webhook_secret(self):
        """Plaintext secret, decrypted on read — same shape as instantly_api_key above."""
        raw = self.instantly_webhook_secret_encrypted
        if not raw:
            return raw
        from crypto import decrypt_token
        try:
            return decrypt_token(raw)
        except Exception:
            return raw

    @instantly_webhook_secret.setter
    def instantly_webhook_secret(self, value):
        if not value:
            self.instantly_webhook_secret_encrypted = value
            return
        from crypto import encrypt_token
        self.instantly_webhook_secret_encrypted = encrypt_token(value)


class ReportConfig(Base):
    """v11.4.0: a named, saved Automated Report — supersedes the single
    org-wide report_schedule_* columns SyncSettings briefly carried (removed
    same day). Multiple reports can coexist, each with its own filters,
    schedule, timezone, and recipients.

    date_range_rule is a RULE ("previous_7_days"), not a stored date pair —
    resolved into an actual (start, end) at send time by
    report_service.resolve_date_range(), and that resolved period is what
    gets written to the ReportExecution row, so historical sends stay
    auditable even as "previous 7 days" keeps meaning something different
    every week."""
    __tablename__ = "report_configs"

    id            = Column(String, primary_key=True, default=generate_uuid)
    name          = Column(String, nullable=False)
    owner_id      = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    enabled       = Column(Boolean, default=True, nullable=False, server_default="true")

    # Components — JSON array of component_id strings, in display/send order.
    # See report_service.COMPONENTS for the registry these ids resolve against.
    components    = Column(Text, nullable=False, default="[]")

    # Filters — NULL means "All" for each axis, matching the Analytics Hub's own convention.
    pod_id        = Column(String, ForeignKey("pods.id", ondelete="SET NULL"), nullable=True)
    upload_log_id = Column(String, nullable=True)
    sdr_id        = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # Date range rule
    date_range_rule = Column(String, default="previous_7_days", nullable=False)  # previous_1_day | previous_7_days | previous_calendar_month | custom
    custom_start    = Column(DateTime(timezone=True), nullable=True)             # only used when date_range_rule == "custom"
    custom_end      = Column(DateTime(timezone=True), nullable=True)

    # Schedule — send_hour/send_minute are LOCAL time in `timezone`, not UTC.
    frequency     = Column(String, default="weekly", nullable=False)   # daily | weekly | monthly
    weekday       = Column(Integer, default=0, nullable=False)         # 0=Monday..6=Sunday, used when frequency="weekly"
    day_of_month  = Column(Integer, default=1, nullable=False)         # 1-31, used when frequency="monthly"; clamped to the last real day of a shorter month
    timezone      = Column(String, default="UTC", nullable=False)      # IANA zone name, e.g. "Asia/Kolkata"
    send_hour     = Column(Integer, default=9, nullable=False)         # 0-23, local to `timezone`
    send_minute   = Column(Integer, default=0, nullable=False)         # 0-59

    # Recipients — JSON arrays of email addresses. Ignored when
    # send_to_all_users is set — that report resolves its recipient list
    # dynamically at send time (report_service.execute_report) to every
    # current CRM user, so it never goes stale as people join/leave.
    to_recipients  = Column(Text, nullable=True)
    cc_recipients  = Column(Text, nullable=True)
    bcc_recipients = Column(Text, nullable=True)
    sender_user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # whose connected mailbox sends it

    # v11.5.9: the one singleton "Weekly Changelog Digest" report — an admin
    # toggle (off by default), not a normal user-configured report. See
    # routes/report_routes.py's /reports/changelog-digest endpoints.
    send_to_all_users = Column(Boolean, default=False, nullable=False, server_default="false")

    include_csv    = Column(Boolean, default=True, nullable=False, server_default="true")

    last_run_at    = Column(DateTime(timezone=True), nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ReportExecution(Base):
    """One row per send attempt (scheduled or Run Now) of a ReportConfig —
    the audit trail: what period it covered, what happened, why it failed."""
    __tablename__ = "report_executions"

    id            = Column(String, primary_key=True, default=generate_uuid)
    report_id     = Column(String, ForeignKey("report_configs.id", ondelete="CASCADE"), nullable=False, index=True)

    status        = Column(String, nullable=False, default="processing")  # processing | sent | failed | skipped
    triggered_by  = Column(String, nullable=False, default="scheduler")    # scheduler | manual (Run Now)

    started_at              = Column(DateTime(timezone=True), server_default=func.now())
    completed_at            = Column(DateTime(timezone=True), nullable=True)
    reporting_period_start  = Column(DateTime(timezone=True), nullable=True)
    reporting_period_end    = Column(DateTime(timezone=True), nullable=True)

    recipients_snapshot = Column(Text, nullable=True)   # JSON — recipients AT SEND TIME, survives later edits to the report
    failure_reason      = Column(Text, nullable=True)


class Tag(Base):
    """A label applied to leads at upload time — independent of any single
    upload batch (a tag can span multiple imports; a lead can carry several)."""
    __tablename__ = "tags"

    id         = Column(String, primary_key=True, default=generate_uuid)
    name       = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CallList(Base):
    """A user-curated, org-wide-visible dial list (Power Dialer source) —
    any SDR/AE/Admin can create one and add leads to it. Unlike Tag (admin
    curated, applied at upload time), this is created ad hoc by whoever
    wants to group leads for calling — hence created_by, absent on Tag."""
    __tablename__ = "call_lists"

    id         = Column(String, primary_key=True, default=generate_uuid)
    name       = Column(String, nullable=False)
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class SfFieldMapping(Base):
    """An EXTRA Alternate CRM -> Salesforce Lead field mapping added by a Super Admin (the built-in ones live in salesforce.py).
    See services/sf_field_mapping.py."""
    __tablename__ = "sf_field_mappings"

    id         = Column(String, primary_key=True, default=generate_uuid)
    lead_field = Column(String, nullable=False, unique=True)     # a key of sf_field_mapping.LEAD_FIELDS
    sf_field   = Column(String, nullable=False, unique=True)     # Salesforce API name, e.g. Budget__c
    sf_type    = Column(String, nullable=True)                   # Salesforce field type when it was checked (double, boolean, string ...)
    verified   = Column(Boolean, nullable=False, default=False)  # True = checked against Salesforce's own field list
    enabled    = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    builtin    = Column(Boolean, nullable=False, default=False, server_default="false")   # True = an override of a built-in mapping (lead_field is a key of salesforce.LEAD_FIELD_MAP)


class AuditEvent(Base):
    """A permanent who-did-what-when record for sensitive actions: data exports, changes to who may export, and Salesforce
    field-mapping edits. Unlike user_activity_logs it is never pruned, and the actor's name/email are copied in so the trail
    survives a user being removed. See services/audit.py."""
    __tablename__ = "audit_events"

    id          = Column(String, primary_key=True, default=generate_uuid)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_id    = Column(String, nullable=True, index=True)       # not a foreign key on purpose: the row outlives the user
    actor_email = Column(String, nullable=True)
    actor_name  = Column(String, nullable=True)
    actor_role  = Column(String, nullable=True)
    category    = Column(String, nullable=False, index=True)      # export | export_access | sf_mapping
    action      = Column(String, nullable=False)
    summary     = Column(String, nullable=False)                  # one plain sentence shown in the list
    detail_json = Column(Text, nullable=True)


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
    direction         = Column(String, default="outbound")      # outbound (push to SF) / inbound (pull from SF)


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


class Account(Base):
    """Salesforce Account — CSM Portal foundation. Kept thin: only the
    fields Portfolio/Account-360/health-score actually consume, not a full
    mirror of SF's Account schema. Pulled read-only (see
    salesforce.sync_accounts_from_salesforce); assigned_csm_id is set
    locally (AE handover or Super Admin assignment), never synced from SF.
    """
    __tablename__ = "accounts"

    id               = Column(String, primary_key=True, default=generate_uuid)
    sf_account_id    = Column(String, unique=True, index=True, nullable=True)
    name             = Column(String, nullable=False)
    industry         = Column(String, nullable=True)
    owner_user_id    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Raw SF Owner identity, stored regardless of whether owner_user_id could
    # be resolved — SF's Account Owner is often someone with no Alternate CRM
    # login at all, so the UI needs something to show even with no match.
    # Backfilled onto owner_user_id automatically once a matching user
    # registers — see salesforce.backfill_sf_identity_links.
    sf_owner_email   = Column(String, nullable=True)
    sf_owner_name    = Column(String, nullable=True)
    customer_since   = Column(DateTime(timezone=True), nullable=True)
    # CSM Portal: independent of Pods — a CSM's account portfolio is a direct
    # assignment, not pod membership (see actor.py's is_csm doc comment).
    assigned_csm_id  = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Same raw-identity pattern as sf_owner_* above, for Account_Manager_Lookup__c.
    sf_csm_email     = Column(String, nullable=True)
    sf_csm_name      = Column(String, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Launch-readiness gap #5: manual escape hatch for the 2-factor health
    # score — computed score stays visible, this overrides the displayed
    # tier without hiding the underlying signal (see csm_portal_routes.py).
    manual_health_tier    = Column(String, nullable=True)  # "Critical" | "At Risk" | "Healthy"
    health_override_by    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    health_override_at    = Column(DateTime(timezone=True), nullable=True)
    health_override_reason = Column(Text, nullable=True)

    owner       = relationship("User", foreign_keys=[owner_user_id])
    assigned_csm = relationship("User", foreign_keys=[assigned_csm_id])


class AccountStakeholder(Base):
    """Salesforce Contact synced onto an Account — CSM Portal stakeholder
    mapping (CSM feedback 2026-09-17, item #7: POC/Billing/Champion mapping
    + "new contact" alerts). SF's Contact object has no field distinguishing
    POC/Billing/Champion (checked via Contact.describe()'s field list on
    2026-09-17 — closest candidates were free-text Title and a generic
    Primary__c checkbox, neither reliable enough to auto-map), so `role` is
    never written by the sync — it's a Alternate CRM-only manual tag the CSM
    applies, same escape-hatch pattern as Account.manual_health_tier.
    sf_created_at is SF's own Contact.CreatedDate, used to flag a "recently
    added" stakeholder without needing our own first-seen bookkeeping.
    """
    __tablename__ = "account_stakeholders"

    id             = Column(String, primary_key=True, default=generate_uuid)
    account_id     = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    sf_contact_id  = Column(String, unique=True, index=True, nullable=True)
    name           = Column(String, nullable=False)
    email          = Column(String, nullable=True)
    phone          = Column(String, nullable=True)
    title          = Column(String, nullable=True)
    role           = Column(String, nullable=True)  # "POC" | "Billing" | "Champion" | "Decision Maker" — CSM-set only
    sf_created_at  = Column(DateTime(timezone=True), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    account = relationship("Account")


class AccountMilestone(Base):
    """Engagement cadence timeline (CSM feedback 2026-09-17, item #8): OB,
    Go-Live, QBRs, Renewal — logged manually by the CSM, same "Portal is the
    source of truth for anything SF doesn't structure" reasoning as
    manual_health_tier and the renewal-stage kanban. No SF object backs this
    (checked the Contact field dump on 2026-09-17 while scoping item #7 —
    nothing QBR-shaped exists there either), so this is portal-native.

    One flat table for both milestone flavors the CSM described rather than
    a type per flavor: `ae_name`/`use_cases` are OB-flavored fields,
    `cs_name`/`summary`/`action_items` are QBR-flavored — both just sit
    nullable depending on `milestone_type`. poc_stakeholder_ids is a
    comma-joined list of AccountStakeholder.id (same semicolon/comma-joined-
    text pattern as Opportunity.standard_product_names) rather than a join
    table, since it's a small manually-picked set, not a queried relationship.
    """
    __tablename__ = "account_milestones"

    id                  = Column(String, primary_key=True, default=generate_uuid)
    account_id          = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    milestone_type      = Column(String, nullable=False)  # "Onboarding" | "Go-Live" | "QBR" | "Renewal" | "Custom"
    label               = Column(String, nullable=False)  # e.g. "QBR 1", "Go-Live" — the timeline's display name
    milestone_date      = Column(DateTime(timezone=True), nullable=False)
    ae_name             = Column(String, nullable=True)
    use_cases           = Column(Text, nullable=True)
    cs_name             = Column(String, nullable=True)
    summary             = Column(Text, nullable=True)
    action_items        = Column(Text, nullable=True)
    poc_stakeholder_ids = Column(Text, nullable=True)  # comma-joined AccountStakeholder.id
    created_by          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account")


class Opportunity(Base):
    """Salesforce Opportunity — CSM Portal foundation, and the AE
    close-deal action's SF counterpart. Bidirectional for stage + close_date
    only (SyncSettings.opportunity_sync_direction), never the whole object —
    see salesforce.sync_opportunities_from_salesforce.
    """
    __tablename__ = "opportunities"

    id               = Column(String, primary_key=True, default=generate_uuid)
    sf_opportunity_id = Column(String, unique=True, index=True, nullable=True)
    account_id       = Column(String, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    name             = Column(String, nullable=True)
    amount           = Column(Float, nullable=True)
    close_date       = Column(DateTime(timezone=True), nullable=True)
    stage_name       = Column(String, nullable=True)   # SF's raw StageName label, display only
    # Precedence signals for the "never regress" pull/push conflict rule —
    # these are standard SF Opportunity fields regardless of the org's
    # custom StageName picklist, so used instead of guessing a stage order.
    is_closed        = Column(Boolean, default=False, nullable=False, server_default="false")
    is_won           = Column(Boolean, default=False, nullable=False, server_default="false")
    owner_user_id    = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Write-back visibility: the AE/CSM who edited this deal has no other way
    # to learn a push to Salesforce failed (e.g. an invalid StageName) short
    # of an admin checking the SF sync log — surface it directly on the row.
    sf_push_status   = Column(String, nullable=True)   # "success" | "failed" | None (never attempted)
    sf_push_error    = Column(Text, nullable=True)
    sf_push_at       = Column(DateTime(timezone=True), nullable=True)
    # Live finding, 2026-09-15: this org's Opportunity has a validation rule
    # rejecting any move to a Closed stage unless both are filled in — a real
    # Closed Won push was failing on FIELD_CUSTOM_VALIDATION_EXCEPTION until
    # the AE close-deal form started collecting these. standard_product_names
    # is semicolon-joined (Standard_Product_Name__c is a multipicklist on the
    # SF side, and that's its wire format) rather than a separate join table —
    # this is close-time metadata for one push, not a queryable relationship.
    standard_product_names = Column(Text, nullable=True)
    invoice_number   = Column(String, nullable=True)
    lost_reason      = Column(String, nullable=True)  # this org's Opportunity_Lost_Reason__c, required only on a Lost close

    account = relationship("Account", foreign_keys=[account_id])
    owner   = relationship("User", foreign_keys=[owner_user_id])


class ClosingBrief(Base):
    """AE-captured deal context at Closed-Won — the source of the CSM
    Portal's "auto-carried from AE, no form to fill" handover card.
    One row per Opportunity. Editable by the AE until a CSM's first logged
    touch on the account (locked=True from then on, see Phase 2's CSM
    touch-logging), so the brief a CSM acts on doesn't shift underneath them.
    """
    __tablename__ = "closing_briefs"

    id               = Column(String, primary_key=True, default=generate_uuid)
    opportunity_id   = Column(String, ForeignKey("opportunities.id", ondelete="CASCADE"), unique=True, nullable=False)
    champion_name    = Column(String, nullable=True)
    champion_role    = Column(String, nullable=True)
    champion_contact = Column(String, nullable=True)   # email or phone
    promises_made    = Column(Text, nullable=True)
    handover_notes   = Column(Text, nullable=True)
    created_by       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    locked           = Column(Boolean, default=False, nullable=False, server_default="false")
    # Playbook: Champion departure — manual-trigger only, no auto-detection
    # signal exists (no email/calendar integration). CSM flips this off.
    champion_active  = Column(Boolean, default=True, nullable=False, server_default="true")
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    opportunity = relationship("Opportunity")
    author      = relationship("User", foreign_keys=[created_by])


class AccountActivity(Base):
    """Single append-only feed for the CSM Portal: touch-logging (drives the
    Silent-account playbook + Relationship health factor), playbook
    executions (drives the Inbox 'time saved' estimate + weekly Digest), and
    the Account 360 activity timeline — one table instead of three, since all
    three are just "something happened on this account, by whom, when."
    `kind` is a free-form tag: "csm_touch", "playbook_<key>", "health_override".
    """
    __tablename__ = "account_activities"

    id         = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    kind       = Column(String, nullable=False)
    note       = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account")
    author  = relationship("User", foreign_keys=[created_by])


class OpportunityCall(Base):
    """AE call logging tagged against an Opportunity (Phase 1 — AE Pipeline).

    Deliberately its own table rather than reusing CallLog: CallLog.lead_id
    is NOT NULL, but a synced-from-SF Opportunity (especially a backfilled
    historical one) very often has no originating Lead in Alternate CRM at all —
    forcing a lead_id would make most Opportunity call logging impossible.
    Feeds the CSM handover brief's call-history context (Phase 2)."""
    __tablename__ = "opportunity_calls"

    id             = Column(String, primary_key=True, default=generate_uuid)
    opportunity_id = Column(String, ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id        = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    outcome        = Column(String, nullable=False)
    notes          = Column(Text, nullable=True)
    called_at      = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    opportunity = relationship("Opportunity")
    user        = relationship("User")


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
    read_at          = Column(DateTime(timezone=True), nullable=True)   # inbound only — cleared the reply-notification bell
    attachments_json = Column(Text, nullable=True)                      # JSON: [{"id":"...","filename":"...","content_type":"...","size":123}]
    # Sales Journey linkage — NULL for non-cadence email (regular compose/reply).
    journey_id       = Column(String, ForeignKey("journeys.id", ondelete="SET NULL"), nullable=True, index=True)
    enrollment_id    = Column(String, ForeignKey("journey_enrollments.id", ondelete="SET NULL"), nullable=True, index=True)
    journey_node_id  = Column(String, nullable=True)   # which node in the graph sent this (not a separate table — lives in JSONB graph_definition)
    variant_key      = Column(String, nullable=True)    # which A/B variant this send used, if the node has variants
    # Email Campaigns linkage — NULL for non-campaign email, mirrors journey_id.
    campaign_id      = Column(String, ForeignKey("email_campaigns.id", ondelete="SET NULL"), nullable=True, index=True)

    # Instantly.ai pull sync: this table's existing columns (direction,
    # subject, body_preview, from_email/to_email, opened_at/open_count,
    # clicked_at/click_count, is_auto_reply, read_at) generalize cleanly to
    # Instantly events, so no sibling table — just a discriminator plus
    # Instantly's own identifiers. instantly_campaign_id is Instantly's
    # REMOTE campaign id (plain string) — distinct from campaign_id above,
    # which FKs our internal email_campaigns table.
    source               = Column(String, nullable=False, default="nylas", server_default="nylas")
    instantly_lead_id    = Column(String, nullable=True, index=True)
    instantly_campaign_id = Column(String, nullable=True)
    # v13.8.0 — one row per real Instantly email (GET /api/v2/emails), keyed by
    # Instantly's own email id (partial unique index in migrations.py), so a
    # replayed page or an overlapping sync window can never double-insert.
    # Rows without it are engagement counters (opens/clicks) or pre-v13.8.0 rows.
    instantly_email_id   = Column(String, nullable=True)
    instantly_thread_id  = Column(String, nullable=True)
    instantly_step       = Column(Integer, nullable=True)    # sequence step inside the Instantly campaign
    instantly_eaccount   = Column(String, nullable=True)     # the Instantly sending mailbox

    __table_args__ = (
        Index("idx_lea_instantly_email_id", "instantly_email_id", unique=True,
              postgresql_where=text("instantly_email_id IS NOT NULL"),
              sqlite_where=text("instantly_email_id IS NOT NULL")),
    )

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


class EmailTemplate(Base):
    """A saved, reusable subject/body pair for Email Campaigns — merge-field
    tokens ({{first_name}}, etc., see journey_engine/merge_fields.py) are
    substituted at send time, not at save time."""
    __tablename__ = "email_templates"

    id         = Column(String, primary_key=True, default=generate_uuid)
    name       = Column(String, nullable=False)
    subject    = Column(String, nullable=False)
    body       = Column(Text, nullable=False)
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EmailCampaign(Base):
    """One ad-hoc "send this email to this list of leads, right now" burst —
    the bulk-send counterpart to Sales Journey's sequenced cadences. subject/
    body are captured at send time (not a live template reference) so editing
    or deleting a template later never changes what a past campaign says it
    sent. Dispatch is a FastAPI BackgroundTask (routes/email_campaign_routes.py)
    updating recipient rows as it goes — see EmailCampaignRecipient below."""
    __tablename__ = "email_campaigns"

    id               = Column(String, primary_key=True, default=generate_uuid)
    name             = Column(String, nullable=False)
    subject          = Column(String, nullable=False)
    body             = Column(Text, nullable=False)
    created_by       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    status           = Column(String, nullable=False, default="running")  # running | completed | scheduled
    total_recipients = Column(Integer, nullable=False, default=0)
    sent_count       = Column(Integer, nullable=False, default=0)
    failed_count     = Column(Integer, nullable=False, default=0)
    skipped_count    = Column(Integer, nullable=False, default=0)
    include_signature = Column(Boolean, default=True, nullable=False, server_default="true")  # v12.3: per-campaign opt-out of the sender's saved email signature (My Settings) — defaults on to match pre-existing manual-send behavior

    # Scheduling — mirrors ReportConfig/report_service.is_due()'s exact field
    # names (backend/models.py's ReportConfig, backend/report_service.py) so
    # that function can be reused as-is for the "daily"/"weekly"/"monthly"
    # cases below, rather than re-deriving the same recurrence math.
    # frequency: "once" (default, immediate-send campaigns never touch these
    # columns) | "scheduled_once" (a single future send) | "daily" | "weekly"
    # | "monthly".
    frequency        = Column(String, nullable=False, default="once")
    scheduled_send_at = Column(DateTime(timezone=True), nullable=True)  # "scheduled_once" only — absolute UTC instant
    weekday          = Column(Integer, nullable=True)      # 0=Mon..6=Sun — "weekly" only
    day_of_month     = Column(Integer, nullable=True)       # 1-31, clamped for short months — "monthly" only
    timezone         = Column(String, nullable=False, default="UTC")  # IANA name — "daily"/"weekly"/"monthly" send-time
    send_hour        = Column(Integer, nullable=True)       # local hour — "daily"/"weekly"/"monthly"
    send_minute      = Column(Integer, nullable=False, default=0)
    last_run_at      = Column(DateTime(timezone=True), nullable=True)  # is_due()'s idempotency guard


class EmailCampaignRecipient(Base):
    """One lead's send status within one EmailCampaign. Pre-filtered
    (skipped_dnc/skipped_no_email) rows are created up front, before dispatch
    starts, so a campaign's total_recipients is accurate immediately —
    dispatch only ever transitions a row from 'pending' to 'sent'/'failed'."""
    __tablename__ = "email_campaign_recipients"

    id          = Column(String, primary_key=True, default=generate_uuid)
    campaign_id = Column(String, ForeignKey("email_campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    lead_id     = Column(String, ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    status      = Column(String, nullable=False, default="pending")  # pending|sent|failed|skipped_dnc|skipped_no_email
    error       = Column(String, nullable=True)
    sent_at     = Column(DateTime(timezone=True), nullable=True)


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
    """Unified call record from any dialer provider (Aircall, Alternate Messenger, etc.)."""
    __tablename__ = "dialer_calls"

    id               = Column(String, primary_key=True, default=generate_uuid)
    lead_id          = Column(String, ForeignKey("leads.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id          = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    provider         = Column(String, nullable=False)           # "aircall" | "messenger" | "manual"
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
    source           = Column(String, default="alternatecrm",      # V24: "alternatecrm" | "aircall_direct"
                             nullable=True, server_default="'alternatecrm'")
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


# Raised 2026-08-31 from 30 to 120 — a disposition-unknown call must run
# noticeably longer before its duration alone is trusted as evidence of a
# real human pickup, not just a longer voicemail/hold. connected/conversation
# stay a structural superset/subset pair only because they still share this
# one value; do not give them independent thresholds without re-deriving
# that guarantee (see dialer_call_connected()'s docstring, RCA 2026-08-18).
CONVERSATION_MIN_SECONDS = 120


def dialer_call_connected(min_seconds: int = CONVERSATION_MIN_SECONDS):
    """True when a DialerCall represents a real, live connection.

    RCA 2026-08-18: previously `outcome IN (positive-track list) OR
    provider_disposition == "ANSWERED"` — an unconditional OR. On real
    production data, 63% of calls the SDR explicitly logged as "No Answer"
    (and 65% of "Wrong Number") still counted as connected purely because
    provider_disposition said "ANSWERED" (the raw telephony signal, which
    fires on any picked-up call leg, voicemail included). An explicit
    SDR-logged outcome must win over that generic signal, not be
    overridden by it.

    RCA 2026-08-18 (part 2): the null-outcome fallback only trusted the
    literal string provider_disposition == "ANSWERED", while
    dialer_call_is_conversation()'s null-outcome branch trusts duration
    alone — so a real 60s+ call with no SDR-tagged outcome and any other
    (or missing) provider_disposition value counted as a conversation but
    NOT as connected, e.g. Sumiti Dangi on 2026-08-17: 13 conversations,
    11 connected calls, a logical impossibility a reader immediately
    spots (production data, flagged by Viren). Duration over the same
    threshold dialer_call_is_conversation() uses is now also sufficient
    evidence — connected is a superset of conversation, never the
    reverse.

    2026-09-01: the provider_disposition == "ANSWERED" fallback (added by
    the RCA above) is now removed per direct product-owner instruction —
    Aircall's own disposition field was reported as unreliable in
    production. Rule is now exactly dialer_call_is_conversation()'s rule:
    an outcome outside the not-answered group means connected; with NO
    outcome logged at all, only a real duration over min_seconds counts.
    The two functions are now computationally identical — kept as two
    named functions for readability/call-site clarity, not because the
    logic differs.
    """
    return or_(
        func.lower(DialerCall.outcome).notin_(NOT_ANSWERED_OUTCOMES_LOWER),
        and_(
            DialerCall.outcome.is_(None),
            DialerCall.duration > min_seconds,
        ),
    )


def dialer_call_is_conversation(min_seconds: int = CONVERSATION_MIN_SECONDS):
    """True when a DialerCall counts as a real conversation (Analytics'
    "Conversations" column, added 2026-08-14).

    Rule: an explicit, positive SDR outcome (anything outside the
    not-answered group) always counts, missing duration and all — the
    outcome itself is the evidence. With NO outcome logged at all (most
    DialerCall rows: auto-synced, never SDR-reviewed), duration becomes
    the *only* signal, so it must be an actual measured value over
    min_seconds (org-configurable via SyncSettings.conversation_min_seconds;
    defaults to CONVERSATION_MIN_SECONDS for callers — e.g. tests — that
    don't have a settings row to read) — a real number, not a permissive
    "duration unknown, assume yes".

    RCA 2026-08-18 (part 3): previously treated NULL duration as passing
    ("unknown or over min_seconds") even with no outcome — so a FAILED
    call that never connected, with no outcome and no duration recorded,
    counted as a "conversation" purely because both fields were empty.
    Requiring a real duration when there's no outcome closes that gap and
    keeps this a true subset of dialer_call_connected() (a call with
    literally zero evidence — no outcome, no duration — is neither).
    """
    return or_(
        and_(DialerCall.outcome.isnot(None), func.lower(DialerCall.outcome).notin_(NOT_ANSWERED_OUTCOMES_LOWER)),
        and_(DialerCall.outcome.is_(None), DialerCall.duration.isnot(None), DialerCall.duration > min_seconds),
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


def exclude_deleted_leads(query, model=None):
    """Soft-deleted leads (Lead.deleted_at set, see bulk_delete_leads()) must
    never appear in listings, kanban, dashboards, or analytics/reporting —
    mirrors exclude_test_leads()'s exact dual-mode shape (see that
    docstring for why the EXISTS form needs an aliased Lead)."""
    if model is None or model is Lead:
        return query.filter(Lead.deleted_at.is_(None))
    deleted_lead = aliased(Lead)
    return query.filter(~exists().where(
        (deleted_lead.id == model.lead_id) & (deleted_lead.deleted_at.isnot(None))
    ))


def exclude_test_and_deleted_leads(query, model=None):
    """analytics_routes.py's ~26 reporting queries all exclude both sandbox
    test leads and soft-deleted leads together — one call instead of the
    same two-call pair repeated at every site."""
    return exclude_deleted_leads(exclude_test_leads(query, model), model)


def call_log_is_conversation():
    """True when a manually-logged CallLog counts as a real conversation.

    CallLog has no duration column at all (it's an SDR's own outcome note,
    not a telephony record) — so the outcome tag is the *only* signal here,
    unlike dialer_call_is_conversation() where duration is the primary
    signal and outcome is just an override.
    """
    return func.lower(CallLog.outcome).notin_(NOT_ANSWERED_OUTCOMES_LOWER)


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
    # passive_deletes=True: trust the DB's ON DELETE CASCADE — do NOT nullify
    # user_id before deleting. RCA 2026-08-24: same bug class /
    # LoginLog/UserMailbox — without this, deleting ANY user who has ever
    # touched the Power Dialer queue 500s (SQLAlchemy tries SET user_id=NULL,
    # which violates this column's NOT NULL constraint).
    user = relationship("User", backref=backref("dialer_queue_statuses", passive_deletes=True))

    __table_args__ = (
        UniqueConstraint("lead_id", "user_id", name="uq_dialer_queue_status_lead_user"),
    )


# ── Error Logs ────────────────────────────────────────────────────────────────
class ErrorLog(Base):
    """
    System-wide error log — captures frontend + backend errors in plain English.
    Designed so non-technical admins can understand issues without raw server logs.
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
    # v13.0.0 playbook support — all off by default (existing cadences unchanged).
    stop_on_reply       = Column(Boolean, nullable=False, default=False, server_default="false")  # any email/SMS/WhatsApp reply ends the enrollment
    stop_on_meeting     = Column(Boolean, nullable=False, default=False, server_default="false")  # a meeting booked (Meeting Scheduled or later) ends it
    max_duration_days   = Column(Integer, nullable=True)   # hard stop N days after enrollment (playbook: 15)
    reengage_after_days = Column(Integer, nullable=True)   # on finish, if engaged: a "Re-engage" task this many days out (playbook: 60)
    reengage_min_opens  = Column(Integer, nullable=True)   # "engaged" = this many opened emails, or any reply (playbook: 2)
    send_as             = Column(String, nullable=True)    # "assigned_rep" = the lead's rep sends (owner as fallback); NULL = the owner (pre-v13 behaviour)
    # v13.9.0: may a lead go through this cadence again after finishing/exiting? NULL = a cadence from
    # before v13.9.0 = allowed (behaviour unchanged); new cadences are created with False.
    allow_reenroll        = Column(Boolean, nullable=True)
    reenroll_cooloff_days = Column(Integer, nullable=True)   # with allow_reenroll: wait this many days after the last run
    vertical            = Column(String, nullable=True)    # free-text, owner-set — matched against Lead.vertical as a soft enroll-time warning, see journey_routes.py's enroll()
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
    # GIN index (ix_journey_versions_graph_gin) provides jsonb_path_ops query acceleration on Postgres.
    graph_definition = Column(_JSONVariant, nullable=False)
    status           = Column(String, nullable=False, default="draft")   # draft | published | superseded
    published_at     = Column(DateTime(timezone=True), nullable=True)
    created_by       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    journey = relationship("Journey", foreign_keys=[journey_id], back_populates="versions")


class MetricVersion(Base):
    """Phase 3 metric governance: a draft/published/superseded definition for
    one registry metric_id. No FK to a metrics table — the static
    analytics/registry.py dict is the id namespace, matching Phase 1's
    "static registry, not a DB table" scoping; this table only exists for
    metrics someone has actually forked a new version of. "Current published"
    is just status == 'published', no live_version_id back-pointer needed —
    unlike Journey, nothing else references a metric by version id."""
    __tablename__ = "metric_versions"
    __table_args__ = (
        UniqueConstraint("metric_id", "version_number", name="uq_metric_version_number"),
    )

    id               = Column(String, primary_key=True, default=generate_uuid)
    metric_id        = Column(String, nullable=False, index=True)
    version_number   = Column(Integer, nullable=False)
    # {description, formula_description, numerator_description,
    #  denominator_description, date_basis, known_caveats}
    definition_json  = Column(_JSONVariant, nullable=False)
    status           = Column(String, nullable=False, default="draft")   # draft | published | superseded
    published_at     = Column(DateTime(timezone=True), nullable=True)
    created_by       = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


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


# ── Instantly.ai send-side (campaign-per-node handoff) ─────────────────────────

class JourneyInstantlyCampaign(Base):
    """Maps a journey's Instantly-sequence node to a live Instantly campaign,
    versioned by content_hash — NOT by journey_version_id. A republish that
    doesn't touch this node's content must reuse the same campaign (leads
    already enrolled are mid-sequence in Instantly, which addresses steps by
    position — overwriting them in place would desync those leads). A content
    change creates a NEW row (new instantly_campaign_id) instead of mutating
    this one in place; lookup is "most recent row for (journey_id, node_id)",
    so the index is a lookup aid, not a uniqueness constraint."""
    __tablename__ = "journey_instantly_campaigns"
    __table_args__ = (
        Index("ix_jic_lookup", "journey_id", "node_id", "created_at"),
    )

    id                     = Column(String, primary_key=True, default=generate_uuid)
    journey_id             = Column(String, ForeignKey("journeys.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id                = Column(String, nullable=False)
    instantly_campaign_id  = Column(String, nullable=False)
    content_hash           = Column(String, nullable=False)  # sha256 of the node's steps; new hash -> new row, not an update
    created_at             = Column(DateTime(timezone=True), server_default=func.now())


class JourneyInstantlyEnrollment(Base):
    """One row per lead's handoff to Instantly for one journey enrollment —
    lets the webhook handler (and the 15-min poll's reconciliation fallback)
    resume/exit the correct parked JourneyExecutionQueue row. A lead can have
    more than one of these over time (re-enrolled, or enrolled in a different
    journey), so lookups filter by status="active", not just campaign_id."""
    __tablename__ = "journey_instantly_enrollments"
    __table_args__ = (
        Index("ix_jie_campaign_lookup", "instantly_campaign_id", "status"),
    )

    id                    = Column(String, primary_key=True, default=generate_uuid)
    journey_enrollment_id = Column(String, ForeignKey("journey_enrollments.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id               = Column(String, nullable=False)
    instantly_campaign_id = Column(String, nullable=False, index=True)
    instantly_lead_id     = Column(String, nullable=True)
    status                = Column(String, nullable=False, default="active")  # active | completed | exited
    enrolled_at           = Column(DateTime(timezone=True), server_default=func.now())
    ended_at              = Column(DateTime(timezone=True), nullable=True)
    end_reason            = Column(String, nullable=True)


# ── Background Job State ──────────────────────────────────────────────────────
class BackgroundJobState(Base):
    """Progress for a long-running background job, persisted instead of held
    in a module-level dict.

    Why this exists: the Audience Manager bulk-backfill tracked its progress
    in `admin_sync_routes._am_sync_status`, a plain in-process dict. A deploy
    mid-run (which already happened once) takes the worker thread AND the
    dict with it, so the admin polling /sync-am-status saw a zeroed idle
    state with no signal the run had been killed partway. One row per job
    name, overwritten in place; `heartbeat_at` is what lets a reader tell
    "still working" from "the process that owned this is gone" — a row
    claiming running=True whose heartbeat has gone cold is reported as
    interrupted rather than in-progress.

    Deliberately generic in shape (a JSON blob) but NOT a generic job
    framework: one writer, one reader, no queue, no retries. If a second job
    ever needs this, it's another row, not new machinery.
    """
    __tablename__ = "background_job_state"

    job_name     = Column(String, primary_key=True)
    running      = Column(Boolean, nullable=False, default=False)
    state        = Column(_JSONVariant, nullable=True)   # the job's own progress counters/errors
    started_at   = Column(DateTime(timezone=True), nullable=True)
    finished_at  = Column(DateTime(timezone=True), nullable=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=True)


class PersonalApiKey(Base):
    """v13.4.0 — a user's own key for the Claude connector (routes/mcp_routes.py).
    Only the SHA-256 of the key is stored; the key itself is shown once, at
    creation. Acts as exactly that user (same role scoping as the app) until
    revoked — revoking also kills every Claude session minted from it."""
    __tablename__ = "personal_api_keys"
    id           = Column(String, primary_key=True, default=generate_uuid)
    user_id      = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name         = Column(String, nullable=False)
    key_prefix   = Column(String, nullable=False)          # first chars, so a user can tell keys apart
    key_hash     = Column(String, nullable=False, unique=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at   = Column(DateTime(timezone=True), nullable=True)

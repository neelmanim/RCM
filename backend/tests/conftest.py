"""
Shared pytest fixtures for CRM backend tests.
Uses in-memory SQLite so every test gets a clean, isolated database.
"""
import os
import sys
import pytest

# ── Ensure backend/ is on sys.path so 'import models' etc. works ────────────
_backend_dir = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _backend_dir)

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import FastAPI
from fastapi.testclient import TestClient

from database import Base
import models  # noqa: F401 — force model registration on Base.metadata
import database as _database_module


def _build_test_app():
    """Build a FastAPI app with all routers but WITHOUT StaticFiles mount."""
    app = FastAPI(title="CRM Test")

    from routes.auth_routes import router as auth_router
    from routes.lead_routes import router as lead_router
    from routes.call_routes import router as call_router
    from routes.note_routes import router as note_router
    from routes.task_routes import router as task_router
    from routes.search_routes import router as search_router
    from routes.admin_routes import router as admin_router
    from routes.pod_routes import router as pod_router
    from routes.leaderboard_routes import router as leaderboard_router
    from routes.sf_log_routes import router as sf_log_router
    from routes.email_routes import router as email_router
    from routes.attachment_routes import router as attachment_router
    from routes.ai_research_routes import router as ai_research_router
    from routes.dialer_routes import router as dialer_router
    from routes.analytics_routes import router as analytics_router
    from routes.public_api_routes import router as public_api_router
    from routes.sdr_performance_routes import router as sdr_perf_router
    from routes.webhook_routes import router as webhook_router
    from routes.metrics_routes import router as metrics_router
    from routes.sf_connection_routes import router as sf_conn_router
    from routes.growth_intelligence_routes import router as growth_router
    # Phase 1-3 extracted modules
    from routes.admin_upload_routes import router as admin_upload_router
    from routes.admin_user_routes import router as admin_user_router
    from routes.admin_assignment_routes import router as admin_assignment_router
    from routes.disqualify_routes import router as disqualify_router
    from routes.admin_sync_routes import router as admin_sync_router
    from routes.analytics_ai_routes import router as analytics_ai_router
    from routes.analytics_digest_routes import router as analytics_digest_router
    from routes.activity_feed_routes import router as activity_feed_router
    from routes.sms_routes import router as sms_router
    from routes.monitoring_routes import router as monitoring_router
    from routes.sse_routes import router as sse_router  # Phase 3
    from routes.smart_analytics_routes import router as smart_analytics_router
    from routes.tag_routes import router as tag_router  # Leads redesign: per-lead tags
    from routes.integration_health_routes import router as integration_health_router
    from routes.conversations_routes import router as conversations_router

    app.include_router(auth_router)
    app.include_router(lead_router)
    app.include_router(call_router)
    app.include_router(note_router)
    app.include_router(task_router)
    app.include_router(search_router)
    app.include_router(admin_router)
    app.include_router(pod_router)
    app.include_router(leaderboard_router)
    app.include_router(sf_log_router)
    app.include_router(email_router)
    app.include_router(attachment_router)
    app.include_router(ai_research_router)
    app.include_router(dialer_router)
    app.include_router(analytics_router)
    app.include_router(public_api_router)
    app.include_router(sdr_perf_router)
    app.include_router(webhook_router)
    app.include_router(metrics_router)
    app.include_router(sf_conn_router)
    app.include_router(growth_router)
    # Phase 1-3 extracted routers
    app.include_router(admin_upload_router)
    app.include_router(admin_user_router)
    app.include_router(admin_assignment_router)
    app.include_router(disqualify_router)
    app.include_router(admin_sync_router)
    app.include_router(analytics_ai_router)
    app.include_router(analytics_digest_router)
    app.include_router(activity_feed_router)
    app.include_router(sms_router)
    app.include_router(monitoring_router)
    app.include_router(sse_router)  # Phase 3
    app.include_router(smart_analytics_router)
    app.include_router(tag_router)
    app.include_router(integration_health_router)
    app.include_router(conversations_router)
    from routes.journey_routes import router as journey_router
    app.include_router(journey_router)

    from exception_handlers import register_exception_handlers
    register_exception_handlers(app)

    @app.get("/")
    def read_root():
        return {"status": "test"}

    return app


# ── Background thread guard (segfault prevention) ────────────────────────────
# On macOS, SQLite's OS-level locking combined with Python 3.9's threading
# model causes a segfault when daemon threads call SQLAlchemy from a non-main
# thread (e.g. audience_manager._sync_leads_worker, lead_routes._do_push, etc.)
#
# There are 6 threading.Thread(daemon=True) spawn sites in the codebase.
# Rather than patching each individually, we make ALL daemon threads no-ops
# for the test session. Non-daemon threads (rare) are left untouched.
# Production code is completely unchanged.

import threading as _threading

class _NoOpThread:
    """Drop-in replacement for threading.Thread that does nothing on start()."""
    def __init__(self, *args, **kwargs):
        pass
    def start(self):
        pass


@pytest.fixture(autouse=True, scope="session")
def _suppress_daemon_threads():
    """Replace daemon background threads with no-ops to prevent test segfaults."""
    _original_thread_cls = _threading.Thread

    class _SafeThread(_original_thread_cls):
        def __init__(self, *args, **kwargs):
            if kwargs.get("daemon", False):
                # Become a no-op — don't call super().__init__ at all
                self.__class__ = _NoOpThread
            else:
                super().__init__(*args, **kwargs)

    _threading.Thread = _SafeThread
    yield
    _threading.Thread = _original_thread_cls


# ── In-memory database (fresh per test) ─────────────────────────────────────
# Using StaticPool ensures ALL connections to sqlite:///:memory: share the same
# underlying database so tables created by Base.metadata.create_all are visible
# to every session, including those created internally by route handlers.

@pytest.fixture()
def engine():
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Register custom SQLite functions to mirror PostgreSQL behaviour.
    # This allows SQL queries using regexp_replace / concat to run in tests.
    import re as _re

    @event.listens_for(eng, "connect")
    def _register_sqlite_functions(dbapi_conn, connection_record):
        dbapi_conn.create_function("regexp_replace", 4,
            lambda value, pattern, replacement, flags: (
                _re.sub(pattern, replacement, value) if value else ""
            ))
        # Mirror PostgreSQL RIGHT() for phone dedup queries
        dbapi_conn.create_function("right", 2,
            lambda value, length: (
                str(value)[-int(length):] if value else ""
            ))

    Base.metadata.create_all(bind=eng)
    yield eng

    # ── Explicit teardown to avoid SAWarning from pods⇔users FK cycle ────
    # SQLAlchemy cannot auto-sort the DROP order when two tables reference each
    # other (pods.admin_id → users, users.pod_id → pods). We break the cycle
    # by nullifying the FK column before dropping, then drop in dependency order.
    try:
        with eng.begin() as conn:
            conn.execute(Base.metadata.tables["users"].update().values(pod_id=None))
    except Exception:
        pass  # Table may already be empty or engine disposed

    drop_order = [
        "user_activity_logs", "salesforce_integration_logs", "dialer_calls",
        "lead_email_activities", "email_threads", "attachments",
        "call_logs", "notes", "tasks", "ai_research_logs",
        "lead_assignments", "leads",
        "nylas_configs", "user_mailboxes",
        "sync_settings", "dialer_configs",
        "public_api_keys",
        "users", "pods",
    ]
    for tbl_name in drop_order:
        tbl = Base.metadata.tables.get(tbl_name)
        if tbl is not None:
            try:
                tbl.drop(bind=eng, checkfirst=True)
            except Exception:
                pass

    eng.dispose()


@pytest.fixture()
def db(engine):
    TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = TestSession()

    # Monkey-patch database module so any internal SessionLocal() calls use
    # the in-memory engine with StaticPool
    _orig_session_local = _database_module.SessionLocal
    _orig_engine = _database_module.engine
    _database_module.SessionLocal = TestSession
    _database_module.engine = engine

    # Also patch sf_logger which imports SessionLocal at module load
    import sf_logger
    _orig_sf_session = getattr(sf_logger, "SessionLocal", None)
    sf_logger.SessionLocal = TestSession

    yield session

    session.close()
    _database_module.SessionLocal = _orig_session_local
    _database_module.engine = _orig_engine
    if _orig_sf_session is not None:
        sf_logger.SessionLocal = _orig_sf_session


# ── TestClient wired to the in-memory DB ────────────────────────────────────

def _make_user_payload(role="Super Admin", user_id="test-user-id", email="admin@test.com", name="Test Admin", pod_id=None):
    return {"sub": user_id, "email": email, "name": name, "role": role, "pod_id": pod_id}


SUPER_ADMIN = _make_user_payload("Super Admin")
POD_ADMIN   = _make_user_payload("Pod Admin", "pod-admin-id", "podadmin@test.com", "Pod Admin")
SDR_USER    = _make_user_payload("SDR", "sdr-user-id", "sdr@test.com", "SDR User")
AE_USER     = _make_user_payload("AE", "ae-user-id", "ae@test.com", "AE User")


@pytest.fixture()
def client(db):
    """FastAPI TestClient with dependency overrides."""
    app = _build_test_app()
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin, require_pod_admin_or_above

    def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: SUPER_ADMIN
    app.dependency_overrides[require_admin] = lambda: SUPER_ADMIN
    app.dependency_overrides[require_super_admin] = lambda: SUPER_ADMIN
    app.dependency_overrides[require_pod_admin_or_above] = lambda: SUPER_ADMIN

    yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture()
def client_as_sdr(db):
    """TestClient authenticated as an SDR."""
    app = _build_test_app()
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    def _override_db():
        yield db

    def _deny_admin():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin access required")

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: SDR_USER
    app.dependency_overrides[require_admin] = _deny_admin
    app.dependency_overrides[require_super_admin] = _deny_super

    yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture()
def client_as_pod_admin(db):
    """TestClient authenticated as a Pod Admin."""
    app = _build_test_app()
    from database import get_db
    from auth import get_current_user, require_admin, require_super_admin

    pod_admin = _make_user_payload("Pod Admin", "pod-admin-id", "podadmin@test.com", "Pod Admin", pod_id="test-pod-id")

    def _override_db():
        yield db

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: pod_admin
    app.dependency_overrides[require_admin] = lambda: pod_admin
    app.dependency_overrides[require_super_admin] = _deny_super

    yield TestClient(app)

    app.dependency_overrides.clear()


@pytest.fixture()
def client_as_ae(db):
    """TestClient authenticated as an AE — Analytics Hub self-scope only."""
    app = _build_test_app()
    from database import get_db
    from auth import get_current_user, require_super_admin

    def _override_db():
        yield db

    def _deny_super():
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Super Admin access required")

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: AE_USER
    app.dependency_overrides[require_super_admin] = _deny_super

    yield TestClient(app)

    app.dependency_overrides.clear()


# ── Factory helpers ─────────────────────────────────────────────────────────

def create_test_user(db, email="user@test.com", name="Test User", role="SDR", pod_id=None, google_id=None, id=None):
    user = models.User(id=id, email=email, name=name, role=role, pod_id=pod_id, google_id=google_id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_test_lead(db, last_name="Doe", first_name="John", email="john@example.com",
                     company="Acme", status="Lead Assigned", sf_lead_id=None, lead_source="salesforce",
                     phone=None, phone_secondary=None, pod_id=None, created_at=None):
    kwargs = dict(
        first_name=first_name, last_name=last_name, email=email,
        company=company, status=status, sf_lead_id=sf_lead_id, lead_source=lead_source,
        phone=phone, phone_secondary=phone_secondary, pod_id=pod_id,
    )
    if created_at is not None:
        kwargs["created_at"] = created_at
    lead = models.Lead(**kwargs)
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead



def create_test_pod(db, name="Alpha Pod", admin_id=None):
    """Create a test pod. admin_id param is kept for call-site compat but now
    creates a PodAdmin entry instead of setting pods.admin_id."""
    pod = models.Pod(name=name)
    db.add(pod)
    db.commit()
    db.refresh(pod)
    if admin_id:
        create_pod_admin(db, pod.id, admin_id)
    return pod


def create_pod_admin(db, pod_id, user_id):
    """Add a user as Pod Admin of a pod (test helper)."""
    # Avoid duplicate
    existing = db.query(models.PodAdmin).filter(
        models.PodAdmin.pod_id == pod_id,
        models.PodAdmin.user_id == user_id
    ).first()
    if existing:
        return existing
    pa = models.PodAdmin(pod_id=pod_id, user_id=user_id)
    db.add(pa)
    # Also set role + pod membership
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user:
        user.role = "Pod Admin"
        if not user.pod_id:
            user.pod_id = pod_id
    db.commit()
    db.refresh(pa)
    return pa


def create_test_note(db, lead_id, content="Test note", author="Tester"):
    note = models.Note(lead_id=lead_id, content=content, author=author)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def create_test_task(db, lead_id, title="Follow up", done="false", due_date=None):
    task = models.Task(lead_id=lead_id, title=title, done=done, due_date=due_date)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def create_test_call(db, lead_id, user_id, outcome="No Answer", notes="", called_at=None):
    kwargs = dict(lead_id=lead_id, user_id=user_id, outcome=outcome, notes=notes)
    if called_at is not None:
        kwargs["called_at"] = called_at
    call = models.CallLog(**kwargs)
    db.add(call)
    db.commit()
    db.refresh(call)
    return call


def create_test_dialer_call(
    db, lead_id, user_id,
    status="CALL_ENDED",
    outcome=None,
    direction="outbound",
    provider="aircall",
    created_at=None,
    started_at=None,
    provider_disposition=None,
    duration=None,
):
    """Create a DialerCall record for account-level connect % tests.

    Pass outcome=<value from analytics_routes.CONNECT_OUTCOMES> (e.g. "Call Back Later")
    to simulate a connected call (matches Bulk Query 5a). status only ever reflects
    CALL_STARTED/CALL_ANSWERED/CALL_ENDED/FAILED lifecycle, not the connect signal —
    real completed calls always end up CALL_ENDED regardless of whether they connected.
    direction='outbound' is required for the query filter.
    provider_disposition=<raw telephony disposition, e.g. "ANSWERED"> simulates a
    batch-synced call (Klenty) that never gets an SDR-tagged outcome.
    """
    import datetime
    kwargs = dict(
        lead_id=lead_id,
        user_id=user_id,
        status=status,
        outcome=outcome,
        direction=direction,
        provider=provider,
        provider_disposition=provider_disposition,
        duration=duration,
    )
    if started_at is not None:
        kwargs["started_at"] = started_at
    dc = models.DialerCall(**kwargs)
    db.add(dc)
    db.commit()
    db.refresh(dc)
    if created_at is not None:
        # SQLite doesn't honour server_default overrides via ORM — set directly
        db.execute(
            __import__("sqlalchemy").text(
                "UPDATE dialer_calls SET created_at = :ts WHERE id = :id"
            ),
            {"ts": created_at.isoformat(), "id": dc.id},
        )
        db.commit()
        db.refresh(dc)
    return dc



def create_test_upload_log(db, uploaded_by=None, filename="leads.csv", total_rows=10, created_at=None):
    kwargs = dict(uploaded_by=uploaded_by, filename=filename, total_rows=total_rows)
    if created_at is not None:
        kwargs["created_at"] = created_at
    log = models.LeadUploadLog(**kwargs)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def create_test_status_log(db, lead_id, from_status, to_status, changed_by="system", changed_at=None):
    kwargs = dict(lead_id=lead_id, from_status=from_status, to_status=to_status, changed_by=changed_by)
    if changed_at is not None:
        kwargs["changed_at"] = changed_at
    log = models.LeadStatusLog(**kwargs)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def create_sync_settings(db, lead_limit=1000, sf_push_stage="Demo Done",
                         sync_direction="push_only", allow_multi_pod_sdr=False):
    settings = models.SyncSettings(
        id=1, lead_limit=lead_limit, sf_push_stage=sf_push_stage,
        sync_direction=sync_direction, allow_multi_pod_sdr=allow_multi_pod_sdr,
    )
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


def create_test_sf_log(db, operation_type="fetch", status="success", sf_object="Lead",
                       record_identifier=None, first_name=None, last_name=None, email=None):
    log = models.SalesforceIntegrationLog(
        operation_type=operation_type, status=status, sf_object=sf_object,
        record_identifier=record_identifier, first_name=first_name,
        last_name=last_name, email=email,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def create_nylas_config(db, client_id="test-client-id", api_key_encrypted="enc-api-key",
                        redirect_uri="http://localhost/callback", is_active=True):
    config = models.NylasConfig(
        id=1, client_id=client_id, api_key_encrypted=api_key_encrypted,
        redirect_uri=redirect_uri, is_active=is_active,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


def create_user_mailbox(db, user_id, email_address="user@test.com",
                        nylas_grant_id="grant-123", status="connected"):
    mailbox = models.UserMailbox(
        user_id=user_id, email_address=email_address,
        nylas_grant_id=nylas_grant_id, provider="google", status=status,
    )
    db.add(mailbox)
    db.commit()
    db.refresh(mailbox)
    return mailbox


def create_email_activity(db, lead_id, user_id=None, direction="outbound",
                          subject="Test Subject", body_preview="Test body",
                          from_email="user@test.com", to_email="lead@test.com",
                          nylas_message_id=None, nylas_thread_id=None):
    activity = models.LeadEmailActivity(
        lead_id=lead_id, user_id=user_id, direction=direction,
        subject=subject, body_preview=body_preview,
        from_email=from_email, to_email=to_email,
        nylas_message_id=nylas_message_id, nylas_thread_id=nylas_thread_id,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def create_email_thread(db, lead_id, nylas_thread_id="thread-abc"):
    thread = models.EmailThread(
        nylas_thread_id=nylas_thread_id, lead_id=lead_id,
    )
    db.add(thread)
    db.commit()
    db.refresh(thread)
    return thread

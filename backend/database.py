import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# ── DATABASE_URL guard (RCA: 2026-05-13 — silent SQLite fallback caused P1 outage) ──
# DATABASE_URL MUST be explicitly set. We no longer fall back to SQLite silently.
# For local development, set DATABASE_URL=sqlite:///./crm.db in your .env file.
# If DATABASE_URL is missing on Render, the deploy will fail immediately with a
# clear error rather than serving empty data for hours.
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "For production: set it to your PostgreSQL connection string. "
        "For local dev: set DATABASE_URL=sqlite:///./crm.db in your .env file. "
        "NEVER leave it unset — the app will not start."
    )

# Render/Heroku sometimes use postgres://, but SQLAlchemy requires postgresql://
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# SQLite needs connect_args={"check_same_thread": False}, otherwise omit for Postgres
if "sqlite" in SQLALCHEMY_DATABASE_URL:
    connect_args = {"check_same_thread": False}
else:
    # connect_timeout prevents startup hangs when DB is unreachable (RCA: May 6 incident)
    connect_args = {"connect_timeout": 10}

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    # Paid-tier Postgres supports 97 connections.
    # pool_size + max_overflow = 23 per worker. With WEB_CONCURRENCY=2 → 46 total,
    # leaving headroom for migrations/admin. Right-sized for 33 active users.
    pool_size=8,            # base persistent connections
    max_overflow=15,        # burst connections (total max = 23 per worker)
    pool_recycle=1800,      # recycle stale connections every 30 min
    pool_pre_ping=True,     # test connections before use (prevents stale conn errors)
    pool_timeout=30,        # seconds to wait for a connection from pool
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── AI-route bulkhead pool (RCA: 2026-09-01) ────────────────────────────────
# A request that calls an LLM provider (Groq) holds its DB connection open,
# idle, for however long that provider takes to answer — including retries
# and a rate-limit backoff sleep. Confirmed live: a Groq outage made
# ai-research requests take 16-93s each; enough of those in flight
# simultaneously (routine — ai-research auto-fires on every lead-detail
# page view) exhausted the shared pool, and a COMPLETELY UNRELATED request
# (GET /api/leads/{id}) then queued for pool_timeout and failed with
# "Couldn't load this lead" — an AI-provider outage taking down an
# unrelated, non-AI feature. A dedicated, separate pool for every
# LLM-calling route means an AI-provider outage, however long or however
# concurrent, can never take a connection away from the rest of the app.
ai_engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    pool_size=3,
    max_overflow=5,
    pool_recycle=1800,
    pool_pre_ping=True,
    pool_timeout=30,
)
AiSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=ai_engine)

def get_ai_db():
    db = AiSessionLocal()
    try:
        yield db
    finally:
        db.close()

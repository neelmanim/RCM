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

"""
Database engine, session factory, and dependency injection.
Shares the same DATABASE_URL as the legacy backend.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import settings

# SQLite needs check_same_thread=False; Postgres doesn't
connect_args = {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency — yields a DB session per request, auto-closes."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

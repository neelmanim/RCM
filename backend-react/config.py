"""
Centralized configuration — single source of truth for all env vars.
Uses pydantic-settings for type-safe, validated configuration.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this directory
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)


class Settings:
    """Application settings loaded from environment variables."""

    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./crm.db")

    # ── Auth / JWT ───────────────────────────────────────────────────────────
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = int(os.getenv("JWT_EXPIRE_HOURS", "8"))

    # ── Google OAuth ─────────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:8000/api/auth/callback")

    # ── Frontend ─────────────────────────────────────────────────────────────
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "")
    ALLOW_DEMO: bool = os.getenv("ALLOW_DEMO", "false").lower() == "true"

    # ── Encryption ───────────────────────────────────────────────────────────
    APP_ENCRYPTION_KEY: str = os.getenv("APP_ENCRYPTION_KEY", "")

    # ── Salesforce ───────────────────────────────────────────────────────────
    SF_DOMAIN: str = os.getenv("SF_DOMAIN", "login")
    SF_USERNAME: str = os.getenv("SF_USERNAME", "")
    SF_PASSWORD: str = os.getenv("SF_PASSWORD", "")
    SF_SECURITY_TOKEN: str = os.getenv("SF_SECURITY_TOKEN", "")
    SF_LEAD_LIMIT: int = int(os.getenv("SF_LEAD_LIMIT", "1000"))

    # ── CORS ─────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list = ["*"]

    def __init__(self):
        # Fix Render/Heroku postgres:// vs postgresql:// issue
        if self.DATABASE_URL and self.DATABASE_URL.startswith("postgres://"):
            self.DATABASE_URL = self.DATABASE_URL.replace("postgres://", "postgresql://", 1)

        if not self.JWT_SECRET:
            raise ValueError(
                "JWT_SECRET environment variable is required. "
                "Generate with: python3 -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )


settings = Settings()

"""FastAPI application factory for the React backend."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings


def create_app() -> FastAPI:
    app = FastAPI(title="RCM CRM API (React)", version="2.0.0", docs_url="/docs", redoc_url="/redoc")

    # CORS
    origins = settings.CORS_ORIGINS if settings.CORS_ORIGINS else ["*"]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

    # ── Core routes ──────────────────────────────────────────────────────────
    from routes.auth import router as auth_router
    from routes.leads import router as leads_router
    from routes.notes_tasks import router as notes_tasks_router
    from routes.calls import router as calls_router
    from routes.leaderboard import router as leaderboard_router

    app.include_router(auth_router)
    app.include_router(leads_router)
    app.include_router(notes_tasks_router)
    app.include_router(calls_router)
    app.include_router(leaderboard_router)

    # ── Admin routes ─────────────────────────────────────────────────────────
    from routes.admin_users import router as admin_users_router
    from routes.admin_assignments import router as admin_assignments_router
    from routes.admin_settings import router as admin_settings_router
    from routes.admin_uploads import router as admin_uploads_router

    app.include_router(admin_users_router)
    app.include_router(admin_assignments_router)
    app.include_router(admin_settings_router)
    app.include_router(admin_uploads_router)

    # ── Pod management ───────────────────────────────────────────────────────
    from routes.pods import router as pods_router
    app.include_router(pods_router)

    # ── Email (Nylas) ────────────────────────────────────────────────────────
    from routes.email import router as email_router
    from routes.webhooks_email import router as webhooks_email_router
    app.include_router(email_router)
    app.include_router(webhooks_email_router)

    # ── Integrations & analytics ─────────────────────────────────────────────
    from routes.ai_research import router as ai_research_router
    from routes.attachments import router as attachments_router
    from routes.sf_connection import router as sf_connection_router
    from routes.sf_logs import router as sf_logs_router
    from routes.dialer import router as dialer_router
    from routes.metrics import router as metrics_router
    from routes.growth_intelligence import router as growth_intelligence_router

    app.include_router(ai_research_router)
    app.include_router(attachments_router)
    app.include_router(sf_connection_router)
    app.include_router(sf_logs_router)
    app.include_router(dialer_router)
    app.include_router(metrics_router)
    app.include_router(growth_intelligence_router)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "rcm-api-react"}

    return app

app = create_app()

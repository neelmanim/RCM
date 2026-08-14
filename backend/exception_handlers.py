"""
Shared FastAPI exception handlers — registered by both main.py (real app)
and conftest.py (test app), so behavior is identical in tests and prod.
"""
import logging

from fastapi.responses import JSONResponse
from sqlalchemy.exc import ProgrammingError

logger = logging.getLogger(__name__)


def register_exception_handlers(app):
    """Attach shared exception handlers to a FastAPI app instance."""

    @app.exception_handler(ProgrammingError)
    async def _undefined_column_race_handler(request, exc: ProgrammingError):
        """
        RCA 2026-07-24: migrations run in a background thread so they never
        block API availability (a blocking startup gate previously caused a
        45s+ regression — see main.py). The tradeoff is a brief window on any
        deploy that adds a column a hot-path SELECT touches: new code can
        serve traffic before its own ALTER TABLE commits, raising
        UndefinedColumn (confirmed: 7 requests, ~1s, self-healed, 2026-07-24).
        Narrowly retry only THIS error shape as 503; any other
        ProgrammingError (a real SQL bug) still surfaces as a 500.
        """
        if type(getattr(exc, "orig", None)).__name__ == "UndefinedColumn":
            logger.warning(
                f"[StartupRace] UndefinedColumn on {request.url.path} — "
                f"migration likely still committing: {exc}"
            )
            return JSONResponse(
                status_code=503,
                content={"detail": "Service is finishing a deploy — please retry in a moment."},
                headers={"Retry-After": "2"},
            )
        raise exc

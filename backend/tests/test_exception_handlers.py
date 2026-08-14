"""
Tests for exception_handlers.py — the UndefinedColumn startup-race handler.

RCA 2026-07-24: a deploy that adds a column a hot-path SELECT touches has a
brief window where new code serves traffic before its own ALTER TABLE
commits, raising sqlalchemy.exc.ProgrammingError wrapping
psycopg2.errors.UndefinedColumn (confirmed via prod logs: 7 requests, ~1s,
self-healed). This is retried as 503 instead of surfacing as a raw 500 —
but only for that exact error shape, so a real SQL bug (any other
ProgrammingError) still surfaces loudly.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import psycopg2.errors
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import ProgrammingError

from exception_handlers import register_exception_handlers


def _build_app():
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/undefined-column")
    def _undefined_column_route():
        raise ProgrammingError("SELECT leads.calendar_event_agenda ...", {}, psycopg2.errors.UndefinedColumn())

    @app.get("/other-programming-error")
    def _other_error_route():
        raise ProgrammingError("SELECT * FROM nonexistent_table", {}, Exception("relation does not exist"))

    return app


class TestUndefinedColumnRaceHandler:

    def test_undefined_column_returns_503_with_retry_after(self):
        client = TestClient(_build_app())
        resp = client.get("/undefined-column")
        assert resp.status_code == 503
        assert resp.headers["retry-after"] == "2"
        assert "retry" in resp.json()["detail"].lower()

    def test_other_programming_error_still_surfaces(self):
        """A real SQL bug must not be silently retried forever."""
        client = TestClient(_build_app(), raise_server_exceptions=True)
        with pytest.raises(ProgrammingError):
            client.get("/other-programming-error")

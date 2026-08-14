"""
tests/test_scheduled_jobs.py
────────────────────────────
Regression tests for background job correctness.

RCA-2026-05-29-sync: _rcm_nightly_sync() was importing
_normalize_phone from 'dialer_service' (wrong module — it lives in
routes.dialer_routes). This caused an ImportError at runtime, silently
killing the entire RCM nightly catch-up every night.
"""

import pytest
from unittest.mock import patch, MagicMock


# ─────────────────────────────────────────────────────────────────────────────
# Import-correctness checks
# ─────────────────────────────────────────────────────────────────────────────

class TestImportCorrectness:
    """
    Verify that _normalize_phone is importable from the correct module.
    These tests catch the exact class of bug that broke the RCM nightly
    sync: a wrong-module import that only fails at runtime, not at parse time.
    """

    def test_normalize_phone_importable_from_dialer_routes(self):
        """_normalize_phone MUST be importable from routes.dialer_routes."""
        try:
            from routes.dialer_routes import _normalize_phone
        except ImportError as e:
            pytest.fail(
                f"_normalize_phone is not importable from routes.dialer_routes: {e}\n"
                "This breaks the RCM nightly sync (RCA-2026-05-29-sync)."
            )

    def test_normalize_phone_not_in_dialer_service(self):
        """
        _normalize_phone must NOT be imported from dialer_service —
        that import will always fail and silently kill the nightly sync.
        Guard against anyone moving it back.
        """
        import dialer_service
        assert not hasattr(dialer_service, "_normalize_phone"), (
            "_normalize_phone must NOT be defined in dialer_service. "
            "scheduled_jobs.py imports it from routes.dialer_routes. "
            "If you move it, update the import in scheduled_jobs.py too."
        )

    def test_normalize_phone_works_correctly(self):
        """Smoke-test the function itself while we have it imported."""
        from routes.dialer_routes import _normalize_phone
        assert _normalize_phone("+91 98765 43210") == "919876543210"
        assert _normalize_phone("(123) 456-7890") == "1234567890"
        assert _normalize_phone("") == ""
        assert _normalize_phone(None) == ""


# ─────────────────────────────────────────────────────────────────────────────
# _rcm_nightly_sync regression
# ─────────────────────────────────────────────────────────────────────────────

class TestRCMNightlySync:
    """
    RCA-2026-05-29-sync: _rcm_nightly_sync() silently failed every night
    because line 340 of scheduled_jobs.py imported _normalize_phone from
    'dialer_service' instead of 'routes.dialer_routes'.

    These tests confirm:
    1. The sync function runs to completion without an ImportError.
    2. Calls are upserted when provider returns data.
    3. Duplicate calls are skipped.
    4. Calls with no phone are handled gracefully (no crash).
    """

    def _make_mock_event(self, phone="+919876543210", call_id="cv-001"):
        event = MagicMock()
        event.phone_number = phone
        event.direction = "outbound"
        event.event_type = "CALL_ENDED"
        event.duration = 45
        event.recording_url = None
        event.transcript = None
        event.started_at = None
        event.ended_at = None
        return event

    def _run_sync(self, db, provider_mock, calls_data):
        """Helper: patch all external deps and run _rcm_nightly_sync."""
        from scheduled_jobs import _rcm_nightly_sync

        provider_mock.fetch_calls_paginated.side_effect = [
            {"calls": calls_data},
            {"calls": []},            # second page → stop
        ]

        with patch("scheduled_jobs.SessionLocal", return_value=db), \
             patch("scheduled_jobs._get_settings", return_value=MagicMock(rcm_last_sync_at=None)), \
             patch("scheduled_jobs._instantiate_provider", return_value=provider_mock):
            _rcm_nightly_sync()

    def test_sync_runs_without_import_error(self, db):
        """
        Core regression: _rcm_nightly_sync must NOT raise ImportError.
        Before the fix, this always crashed at 'from dialer_service import _normalize_phone'.
        """
        from scheduled_jobs import _rcm_nightly_sync

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {"calls": []}

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock(rcm_last_sync_at=None)), \
             patch("dialer_service._instantiate_provider", return_value=provider):
            try:
                _rcm_nightly_sync()
            except ImportError as e:
                pytest.fail(
                    f"_rcm_nightly_sync raised ImportError: {e}\n"
                    "Check the _normalize_phone import at line 340 of scheduled_jobs.py."
                )

    def test_sync_skips_duplicate_calls(self, db):
        """Calls already in dialer_calls (by provider_call_id) must be skipped."""
        import models
        from scheduled_jobs import _rcm_nightly_sync

        # Pre-insert a call with the same call_id
        existing = models.DialerCall(
            provider="rcm",
            provider_call_id="cv-dup-001",
            phone_number="+919876543210",
            direction="outbound",
            status="CALL_ENDED",
        )
        db.add(existing)
        db.commit()

        provider = MagicMock()
        event = self._make_mock_event(call_id="cv-dup-001")
        provider.handle_webhook.return_value = event
        provider.fetch_calls_paginated.side_effect = [
            {"calls": [{"call_id": "cv-dup-001"}]},
            {"calls": []},
        ]

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock(rcm_last_sync_at=None)), \
             patch("dialer_service._instantiate_provider", return_value=provider):
            _rcm_nightly_sync()

        # Should still be exactly 1 row (no duplicate written)
        count = db.query(models.DialerCall).filter(
            models.DialerCall.provider_call_id == "cv-dup-001"
        ).count()
        assert count == 1, f"Duplicate call was inserted (count={count}), dedup guard broken"

    def test_sync_handles_call_with_no_phone(self, db):
        """Calls with no phone_number must not crash the sync."""
        import models
        from scheduled_jobs import _rcm_nightly_sync

        provider = MagicMock()
        event = self._make_mock_event(phone=None, call_id="cv-nophone-001")
        provider.handle_webhook.return_value = event
        provider.fetch_calls_paginated.side_effect = [
            {"calls": [{"call_id": "cv-nophone-001"}]},
            {"calls": []},
        ]

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock(rcm_last_sync_at=None)), \
             patch("dialer_service._instantiate_provider", return_value=provider):
            try:
                _rcm_nightly_sync()
            except Exception as e:
                pytest.fail(f"Sync crashed on call with no phone: {e}")

    def test_sync_skips_when_rcm_not_configured(self, db):
        """If _instantiate_provider returns None, sync must exit silently — no crash."""
        from scheduled_jobs import _rcm_nightly_sync

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=MagicMock()), \
             patch("dialer_service._instantiate_provider", return_value=None):
            try:
                _rcm_nightly_sync()
            except Exception as e:
                pytest.fail(f"Sync should exit silently when provider is None, got: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# _klenty_nightly_sync — temporary bridging integration (docs/RELEASES.md)
# ─────────────────────────────────────────────────────────────────────────────

class TestKlentyNightlySync:
    """
    Klenty is pull-only. The /user/{username}/calls endpoint validates the
    requested username but does NOT scope results to it (LIVE-TESTED
    2026-07-29: two different accepted usernames returned byte-identical
    data) — so the sync fetches once (trying each SDR's username only until
    one is accepted) and attributes every call by its own embedded
    "username" field. These tests confirm:
    1. The job no-ops cleanly when klenty_enabled=False or the API key is unset.
    2. Calls are matched to existing leads by phone, then by email.
    3. Unmatched contacts auto-create a new lead, assigned to the calling SDR.
    4. Duplicate calls (by provider_call_id) are skipped.
    5. Klenty calls never get an SDR-typed outcome (stays NULL — no Connect
       Rate tie-in, per the plan's decision).
    6. A rejected username falls back to the next SDR's; a fully rejected
       set aborts cleanly without marking the run as synced.
    7. Attribution follows the call's own "username" field, not whichever
       username happened to make the successful request.
    """

    def _settings_mock(self, enabled=True, api_key="encrypted-key"):
        s = MagicMock()
        s.klenty_enabled = enabled
        s.klenty_api_key = api_key
        s.klenty_last_sync_at = None
        return s

    def _sample_call(self, call_sid="CA-1", phone="+17135241010", email="jim@test.com"):
        return {
            "callSid": call_sid,
            "username": "sdr@screen-magic.com",
            "type": "OUTBOUND",
            "duration": 60,
            "startTime": "2026-07-01T10:00:00.000Z",
            "endTime": "2026-07-01T10:01:00.000Z",
            "prospectPhoneNo": phone,
            "email": email,
            "firstName": "Jim",
            "lastName": "Slaton",
            "company": "Acme",
            "disposition": "ANSWERED",
        }

    def test_noop_when_klenty_disabled(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock(enabled=False)):
            _klenty_nightly_sync()

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0

    def test_second_concurrent_call_does_not_run(self, db):
        """
        RCA 2026-07-31 (LIVE): the recurring 24h job, the startup catch-up,
        and a manual admin-triggered backfill can all invoke this function.
        With no lock, two overlapping runs raced on the same call_id and one
        crashed after the other had already committed it. A held lock must
        make a second concurrent call return immediately, untouched.
        """
        import scheduled_jobs

        assert scheduled_jobs._klenty_sync_lock.acquire(blocking=False)
        try:
            result = scheduled_jobs._klenty_nightly_sync()
        finally:
            scheduled_jobs._klenty_sync_lock.release()

        assert result == {"ran": False, "reason": "Klenty sync already running"}

    def test_noop_when_api_key_missing(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock(api_key=None)):
            _klenty_nightly_sync()

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0

    def test_matches_existing_lead_by_phone(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user, create_test_lead

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()
        lead = create_test_lead(db, email="jim@test.com", phone="7135241010")
        sdr_id, lead_id = sdr.id, lead.id  # capture before the sync closes this session

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call()], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None
        assert call.lead_id == lead_id
        assert call.user_id == sdr_id
        assert call.outcome is None  # never SDR-tagged — no CRM outcome for a batch-synced call
        assert call.provider_disposition == "ANSWERED"  # raw telephony signal IS captured (RCA 2026-08-03)
        assert call.source == "klenty_sync"
        # No new lead should have been created — it matched the existing one
        assert db.query(models.Lead).count() == 1

    def test_matches_existing_lead_by_email_when_phone_unmatched(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user, create_test_lead

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()
        lead = create_test_lead(db, email="jim@test.com", phone=None)
        lead_id = lead.id  # capture before the sync closes this session

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(phone="+19999999999")], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call.lead_id == lead_id
        assert db.query(models.Lead).count() == 1

    def test_creates_new_lead_for_unmatched_contact(self, db):
        """Unmatched contacts auto-create a lead, assigned to the calling SDR —
        matches the one-time CSV backfill's behavior (per user decision)."""
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR", pod_id="pod-1")
        sdr.dialer_enabled = True
        db.commit()
        sdr_id = sdr.id  # capture before the sync closes this session

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(phone="+15551234567", email="new-contact@test.com")],
            "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        new_lead = db.query(models.Lead).filter(models.Lead.email == "new-contact@test.com").first()
        assert new_lead is not None
        assert new_lead.first_name == "Jim"
        assert new_lead.last_name == "Slaton"
        assert new_lead.status == "Calling"
        assert new_lead.lead_source.startswith("klenty_sync:")
        assert new_lead.pod_id == "pod-1"
        assert new_lead.research_company is not None

        assignment = db.execute(
            models.lead_assignments.select().where(models.lead_assignments.c.lead_id == new_lead.id)
        ).first()
        assert assignment is not None
        assert assignment.user_id == sdr_id

    def test_skips_duplicate_calls(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        existing = models.DialerCall(provider="klenty", provider_call_id="CA-1", status="CALL_ENDED", direction="outbound")
        db.add(existing)
        db.commit()

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(call_sid="CA-1")], "has_more": False, "page": 1,
        }

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        count = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "CA-1").count()
        assert count == 1, f"Duplicate Klenty call was inserted (count={count})"

    def test_skips_duplicate_within_same_run(self, db):
        """
        RCA 2026-07-31 (LIVE, on a 29-day manual backfill): Klenty's own feed
        returned the same call_id twice in one run. Neither occurrence was
        committed yet when the second was processed, so the DB existence
        check alone didn't catch it — the second insert hit the
        (provider, provider_call_id) unique constraint and crashed the whole
        sync. Must be caught in-memory instead.
        """
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call(call_sid="CA-DUP"), self._sample_call(call_sid="CA-DUP")],
            "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            result = _klenty_nightly_sync()

        assert result["ran"] is True
        count = db.query(models.DialerCall).filter(models.DialerCall.provider_call_id == "CA-DUP").count()
        assert count == 1, f"Same-run duplicate was inserted twice (count={count})"

    def test_persists_last_sync_timestamp(self, db):
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = True
        db.commit()

        settings = self._settings_mock()
        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {"calls": [], "has_more": False, "page": 1}

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        assert settings.klenty_last_sync_at is not None

    # ── LIVE-TESTED 2026-07-29: /user/{username}/calls validates the requested
    # username but does not scope results to it — two different accepted
    # usernames returned byte-identical data. These tests cover the corrected
    # behavior: try each SDR's username only until one is accepted, then
    # attribute every call by its own embedded "username" field.

    def test_falls_back_to_next_sdrs_username_if_first_is_rejected(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        create_test_user(db, email="rejected@screen-magic.com", role="SDR").dialer_enabled = True
        create_test_user(db, email="sdr@screen-magic.com", role="SDR").dialer_enabled = True
        db.commit()

        provider = MagicMock()
        # _MAX_RETRIES=3 exhausts on the first (rejected) username, then the
        # second username's first attempt succeeds.
        provider.fetch_calls_paginated.side_effect = [
            RuntimeError("Klenty API error 403: Invalid user"),
            RuntimeError("Klenty API error 403: Invalid user"),
            RuntimeError("Klenty API error 403: Invalid user"),
            {"calls": [self._sample_call()], "has_more": False, "page": 1},
        ]
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"), \
             patch("time.sleep"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None, "should still import once a later SDR's username is accepted"

    def test_aborts_cleanly_when_no_sdr_username_is_accepted(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        create_test_user(db, email="sdr@screen-magic.com", role="SDR").dialer_enabled = True
        db.commit()

        settings = self._settings_mock()
        provider = MagicMock()
        provider.fetch_calls_paginated.side_effect = RuntimeError("Klenty API error 403: Invalid user")

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=settings), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"), \
             patch("time.sleep"):
            _klenty_nightly_sync()  # must not raise

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0
        assert settings.klenty_last_sync_at is None, "a fully-failed run must not be marked as synced"

    def test_attributes_call_to_sdr_by_embedded_username_not_requested_username(self, db):
        """The core fix: even though sdr1's username is the one that made the
        successful API call, a returned call whose own "username" field
        matches sdr2 must be attributed to sdr2, not sdr1."""
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        sdr1 = create_test_user(db, email="sdr1@screen-magic.com", role="SDR")
        sdr1.dialer_enabled = True
        sdr2 = create_test_user(db, email="sdr2@screen-magic.com", role="SDR")
        sdr2.dialer_enabled = True
        db.commit()
        sdr2_id = sdr2.id

        klenty_call = self._sample_call(email="new-contact@test.com")
        klenty_call["username"] = "sdr2@screen-magic.com"

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [klenty_call], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None
        assert call.user_id == sdr2_id, "must attribute by the call's own username field, not the requested one"

    def test_skips_call_whose_username_matches_no_sdr(self, db):
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user

        create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        db.commit()

        provider = MagicMock()
        unattributed_call = self._sample_call()
        unattributed_call["username"] = "someone-not-tracked@screen-magic.com"
        provider.fetch_calls_paginated.return_value = {
            "calls": [unattributed_call], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()  # must not raise or misattribute

        assert db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").count() == 0

    def test_attributes_call_even_when_sdr_has_rcm_dialer_disabled(self, db):
        """
        RCA 2026-07-31 (LIVE): the roster query used to filter on
        dialer_enabled — a toggle for RCM's OWN click-to-call dialer
        (RCM/Aircall), unrelated to Klenty. Any SDR who never needed
        RCM's own dialer (because they call through Klenty) had
        dialer_enabled=False and their real Klenty calls were silently and
        permanently discarded as "unattributed" on every sync. Roster is now
        just role SDR/AE, independent of that toggle.
        """
        import models
        from scheduled_jobs import _klenty_nightly_sync
        from conftest import create_test_user, create_test_lead

        sdr = create_test_user(db, email="sdr@screen-magic.com", role="SDR")
        sdr.dialer_enabled = False  # RCM's own dialer OFF — Klenty is unaffected
        db.commit()
        lead = create_test_lead(db, email="jim@test.com", phone="7135241010")
        sdr_id, lead_id = sdr.id, lead.id

        provider = MagicMock()
        provider.fetch_calls_paginated.return_value = {
            "calls": [self._sample_call()], "has_more": False, "page": 1,
        }
        provider._normalize_call.side_effect = lambda raw: KlentyRealNormalize(raw)

        with patch("database.SessionLocal", return_value=db), \
             patch("dialer_service._get_settings", return_value=self._settings_mock()), \
             patch("klenty_provider.KlentyDialerProvider", return_value=provider), \
             patch("crypto.decrypt_token", return_value="decrypted-key"):
            _klenty_nightly_sync()

        call = db.query(models.DialerCall).filter(models.DialerCall.provider == "klenty").first()
        assert call is not None, "Klenty call was discarded because dialer_enabled=False"
        assert call.lead_id == lead_id
        assert call.user_id == sdr_id


def KlentyRealNormalize(raw):
    """Use the real KlentyDialerProvider._normalize_call logic in tests that mock
    the provider instance itself — avoids re-declaring the mapping in every test.
    Built from the unpatched class (imported at module load, before any test
    patches klenty_provider.KlentyDialerProvider) to avoid infinite recursion."""
    return _REAL_KLENTY_PROVIDER._normalize_call(raw)


from klenty_provider import KlentyDialerProvider as _RealKlentyDialerProvider
_REAL_KLENTY_PROVIDER = _RealKlentyDialerProvider(api_key="unused")


# ─────────────────────────────────────────────────────────────────────────────
# _salesforce_auto_sync_job — V44: admin-configurable daily UTC schedule
# ─────────────────────────────────────────────────────────────────────────────

class TestSalesforceAutoSync:
    """
    _salesforce_auto_sync_job() ticks every 15 min (see start_scheduled_jobs)
    and must only actually run the sync once per UTC calendar day, at or after
    the admin-configured hour:minute — never before, and never twice.
    """

    def _make_settings(self, db, **overrides):
        import models
        settings = models.SyncSettings(
            id=1,
            sf_auto_sync_enabled=overrides.get("sf_auto_sync_enabled", True),
            sf_auto_sync_hour_utc=overrides.get("sf_auto_sync_hour_utc", 2),
            sf_auto_sync_minute_utc=overrides.get("sf_auto_sync_minute_utc", 0),
            sf_auto_sync_last_run_at=overrides.get("sf_auto_sync_last_run_at", None),
            sync_direction=overrides.get("sync_direction", "push_only"),
            sf_push_stage="Meeting Scheduled",
            lead_limit=1000,
        )
        db.add(settings)
        db.commit()
        return settings

    def test_noop_when_disabled(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_enabled=False)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client") as mock_get_client, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_get_client.assert_not_called()

    def test_noop_when_hour_not_configured(self, db):
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_hour_utc=None)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client") as mock_get_client, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_get_client.assert_not_called()

    def test_noop_before_scheduled_time_today(self, db):
        """Configured for 2am UTC — a 1am tick must not run yet."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.run_full_salesforce_sync") as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 1, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_sync.assert_not_called()

    def test_runs_after_scheduled_time_and_records_last_run(self, db):
        """A tick after 2am, never synced before → runs once, stamps last_run_at."""
        import models
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        settings = self._make_settings(db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0)
        sf_client = MagicMock()
        now = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client", return_value=sf_client), \
             patch("salesforce.run_full_salesforce_sync", return_value={"leads_pushed_to_sf": 3, "leads_synced": 0}) as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = now
            _salesforce_auto_sync_job()

        mock_sync.assert_called_once()
        refreshed = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        stored = refreshed.sf_auto_sync_last_run_at
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=timezone.utc)
        assert stored == now

    def test_noop_if_already_run_today(self, db):
        """Already synced at 2:05am today — a later 3am tick must not re-run."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        already_ran_at = datetime(2026, 7, 20, 2, 5, tzinfo=timezone.utc)
        self._make_settings(
            db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0,
            sf_auto_sync_last_run_at=already_ran_at,
        )

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.run_full_salesforce_sync") as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_sync.assert_not_called()

    def test_runs_again_next_day_after_previous_run(self, db):
        """Ran yesterday at 2am — today's 3am tick must run again (new calendar day)."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        ran_yesterday = datetime(2026, 7, 19, 2, 0, tzinfo=timezone.utc)
        self._make_settings(
            db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0,
            sf_auto_sync_last_run_at=ran_yesterday,
        )
        sf_client = MagicMock()

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client", return_value=sf_client), \
             patch("salesforce.run_full_salesforce_sync", return_value={"leads_pushed_to_sf": 0, "leads_synced": 0}) as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            _salesforce_auto_sync_job()

        mock_sync.assert_called_once()

    def test_noop_when_sf_client_unavailable(self, db):
        """Scheduled window has passed but Salesforce isn't configured — must not crash."""
        from datetime import datetime, timezone
        from scheduled_jobs import _salesforce_auto_sync_job

        self._make_settings(db, sf_auto_sync_hour_utc=2, sf_auto_sync_minute_utc=0)

        with patch("database.SessionLocal", return_value=db), \
             patch("salesforce.get_sf_client", return_value=None), \
             patch("salesforce.run_full_salesforce_sync") as mock_sync, \
             patch("scheduled_jobs.datetime") as mock_dt:
            mock_dt.now.return_value = datetime(2026, 7, 20, 3, 0, tzinfo=timezone.utc)
            try:
                _salesforce_auto_sync_job()
            except Exception as e:
                pytest.fail(f"Job should exit quietly when SF client is unavailable, got: {e}")

        mock_sync.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# _email_sync_job — v10.9.5 (see scheduled_jobs.py docstring for the RCA:
# email sync had no scheduler and no webhook at all before this — only ran
# as a side-effect of a user opening a lead's Email tab).
# ─────────────────────────────────────────────────────────────────────────────

class TestEmailSyncJob:

    def test_noop_when_nylas_not_configured(self, db):
        from scheduled_jobs import _email_sync_job

        with patch("database.SessionLocal", return_value=db):
            result = _email_sync_job()

        assert result["ran"] is False
        assert "not configured" in result["reason"].lower()

    def test_noop_when_no_connected_mailbox(self, db):
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config

        create_nylas_config(db)

        with patch("database.SessionLocal", return_value=db):
            result = _email_sync_job()

        assert result["ran"] is False
        assert "no connected mailbox" in result["reason"].lower()

    def test_syncs_active_leads_and_records_last_run(self, db):
        import models
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config, create_user_mailbox, create_test_user, create_test_lead

        create_nylas_config(db)
        sdr = create_test_user(db, email="sdr@test.com", role="SDR")
        create_user_mailbox(db, user_id=sdr.id, email_address="sdr@test.com")
        lead = create_test_lead(db, email="active@test.com")
        lead_id = lead.id

        settings = models.SyncSettings(id=1)
        db.add(settings)
        db.commit()

        with patch("database.SessionLocal", return_value=db), \
             patch("routes.email_routes._sync_full_mailbox") as mock_sync:
            result = _email_sync_job()

        assert result["ran"] is True
        assert result["synced"] == 1
        mock_sync.assert_called_once()
        assert mock_sync.call_args[0][0] == lead_id

        refreshed = db.query(models.SyncSettings).filter(models.SyncSettings.id == 1).first()
        assert refreshed.email_sync_last_run_at is not None

    def test_skips_parked_leads(self, db):
        import models
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config, create_user_mailbox, create_test_user, create_test_lead

        create_nylas_config(db)
        sdr = create_test_user(db, email="sdr2@test.com", role="SDR")
        create_user_mailbox(db, user_id=sdr.id, email_address="sdr2@test.com")
        create_test_lead(db, email="parked@test.com", status="No Phone - Parked")

        with patch("database.SessionLocal", return_value=db), \
             patch("routes.email_routes._sync_full_mailbox") as mock_sync:
            result = _email_sync_job()

        assert result["ran"] is True
        assert result["synced"] == 0
        mock_sync.assert_not_called()

    def test_second_concurrent_call_does_not_run(self, db):
        import scheduled_jobs
        assert scheduled_jobs._email_sync_lock.acquire(blocking=False)
        try:
            result = scheduled_jobs._email_sync_job()
        finally:
            scheduled_jobs._email_sync_lock.release()

        assert result["ran"] is False
        assert "already running" in result["reason"].lower()

    def test_one_lead_failing_does_not_block_the_rest(self, db):
        import models
        from scheduled_jobs import _email_sync_job
        from conftest import create_nylas_config, create_user_mailbox, create_test_user, create_test_lead

        create_nylas_config(db)
        sdr = create_test_user(db, email="sdr3@test.com", role="SDR")
        create_user_mailbox(db, user_id=sdr.id, email_address="sdr3@test.com")
        create_test_lead(db, email="a@test.com")
        create_test_lead(db, email="b@test.com")

        with patch("database.SessionLocal", return_value=db), \
             patch("routes.email_routes._sync_full_mailbox", side_effect=[Exception("boom"), None]):
            result = _email_sync_job()

        assert result["ran"] is True
        assert result["synced"] == 1
        assert result["considered"] == 2

"""
Tests for routes/ai_research_routes.py — AI research endpoint and _call_groq helper.
Mocks all external HTTP calls (Groq API) to run fully offline.
"""
import sys, os
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch required env vars BEFORE any import that triggers auth.py
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-for-tests-only")
os.environ.setdefault("GROQ_API_KEY", "sk-test-key")

from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException

from routes.ai_research_routes import (
    _call_groq_single as _call_groq,
    _sanitize_research_v2 as _sanitize_research,
    _build_prompt_v2 as _build_prompt,
    _map_persona,
    _extract_json_from_prose,
    _normalise_company_key,
)


# ── _call_groq unit tests ────────────────────────────────────────────────────

class TestCallGroq:
    """Unit tests for the _call_groq async helper."""

    @pytest.mark.asyncio
    async def test_raises_if_no_api_key(self):
        """Missing API key should raise 500 immediately — no HTTP call made."""
        with pytest.raises(HTTPException) as exc_info:
            await _call_groq("some prompt", api_key="", model="llama-3.3-70b-versatile")
        assert exc_info.value.status_code == 500
        assert "API key not configured" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_successful_json_response(self):
        """Happy path: Groq returns a valid JSON string — should be parsed and returned."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": '{"research_company": "Acme Corp does X", "research_industry": "SaaS"}'}}]
        }

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await _call_groq("test prompt", api_key="sk-fake-key", model="llama-3.3-70b-versatile")

        assert result["research_company"] == "Acme Corp does X"
        assert result["research_industry"] == "SaaS"

    @pytest.mark.asyncio
    async def test_strips_markdown_fences(self):
        """Groq sometimes wraps JSON in ```json ... ``` — should be stripped."""
        content = "```json\n{\"research_company\": \"Wrapped Corp\"}\n```"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": content}}]
        }

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client):
            result = await _call_groq("test prompt", api_key="sk-fake-key", model="llama-3.3-70b-versatile")

        assert result["research_company"] == "Wrapped Corp"

    @pytest.mark.asyncio
    async def test_401_raises_502_invalid_key(self):
        """A 401 from Groq should surface as a 502 with a helpful message."""
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await _call_groq("test prompt", api_key="sk-bad-key", model="llama-3.3-70b-versatile")

        assert exc_info.value.status_code == 502
        assert "Invalid API key" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_429_raises_429_rate_limit(self):
        """A 429 from Groq should be propagated as a 429 to the client."""
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.text = "Too Many Requests"

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await _call_groq("test prompt", api_key="sk-fake-key", model="model")

        assert exc_info.value.status_code == 429
        assert "rate limit" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_429_with_large_retry_after_fails_fast_without_waiting(self):
        """RCA 2026-08-07: Groq quoted a 615s retry-after on a real prod 429,
        and the old code slept through it verbatim, hanging the request for
        13-23 minutes and starving unrelated endpoints. It must now fail
        fast — one call, no retry, no multi-minute sleep — instead of
        trusting the header past a sane cap."""
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.text = "Too Many Requests"
        mock_response.headers = {"retry-after": "615"}

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client), \
             patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            with pytest.raises(HTTPException) as exc_info:
                await _call_groq("test prompt", api_key="sk-fake-key", model="model")

        assert exc_info.value.status_code == 429
        assert mock_client.post.call_count == 1  # no retry attempted
        for call in mock_sleep.call_args_list:
            assert call.args[0] < 30  # never told to sleep the full 615s

    @pytest.mark.asyncio
    async def test_timeout_raises_504(self):
        """Network timeout should raise a 504."""
        import httpx

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await _call_groq("test prompt", api_key="sk-fake-key", model="model")

        assert exc_info.value.status_code == 504

    @pytest.mark.asyncio
    async def test_invalid_json_response_raises_502(self):
        """If Groq returns non-JSON content, raise 502 with a parse-error message."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Sorry, I can't help with that."}}]
        }

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await _call_groq("test prompt", api_key="sk-fake-key", model="model")

        assert exc_info.value.status_code == 502
        assert "unexpected format" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_connect_error_raises_502(self):
        """Network connection failure should raise a 502."""
        import httpx

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=httpx.ConnectError("refused"))

        with patch("httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(HTTPException) as exc_info:
                await _call_groq("test prompt", api_key="sk-fake-key", model="model")

        assert exc_info.value.status_code == 502


# ── _sanitize_research unit tests (v2) ───────────────────────────────────────

class TestSanitizeResearch:
    """Unit tests for the v2 sanitizer. Output: 6 fields + heat_score."""

    def _valid_v2(self):
        return {
            "company_pulse": "Acme Corp is a 200-person SaaS company.",
            "why_they_need_us": "They run 3 SDR teams. RCM cuts setup time.",
            "opening_line": "Hi John, saw Acme hired 3 SDRs — worth 90 seconds?",
            "likely_objection": "We have a system → What are you using today?",
            "persona_signal": "Decision maker. Signs off on ops tools.",
            "heat_score": "hot, CEO at fast-growing SaaS",
        }

    def test_valid_output_passes_through(self):
        result = _sanitize_research(self._valid_v2())
        assert result["company_pulse"] == "Acme Corp is a 200-person SaaS company."
        assert result["heat_score"] == "hot"

    def test_invalid_heat_score_defaults_to_warm(self):
        data = self._valid_v2(); data["heat_score"] = "medium"
        assert _sanitize_research(data)["heat_score"] == "warm"

    def test_missing_heat_score_defaults_to_warm(self):
        assert _sanitize_research({})["heat_score"] == "warm"

    def test_opening_line_truncated_at_280_chars(self):
        data = self._valid_v2(); data["opening_line"] = "x" * 400
        assert len(_sanitize_research(data)["opening_line"]) <= 280

    def test_text_fields_truncated_to_500(self):
        data = self._valid_v2(); data["company_pulse"] = "x" * 1000
        assert len(_sanitize_research(data)["company_pulse"]) <= 500

    def test_missing_fields_default_to_empty_string(self):
        result = _sanitize_research({})
        for key in ["company_pulse", "why_they_need_us", "opening_line",
                    "likely_objection", "persona_signal"]:
            assert key in result and isinstance(result[key], str)

    def test_legacy_fields_backfilled(self):
        result = _sanitize_research(self._valid_v2())
        assert result["research_company"] == result["company_pulse"]
        assert result["research_opening"] == result["opening_line"]
        assert result["research_heat"] == result["heat_score"]

    def test_cold_heat_score_accepted(self):
        data = self._valid_v2(); data["heat_score"] = "cold, no SDR team visible"
        assert _sanitize_research(data)["heat_score"] == "cold"


# ── _build_prompt unit tests (v2) ─────────────────────────────────────────────

class TestBuildPrompt:
    """Verify the v2 prompt builder."""

    def _make_lead(self, **kw):
        lead = MagicMock()
        lead.company = kw.get("company", "Acme")
        lead.first_name = kw.get("first_name", "John")
        lead.last_name = kw.get("last_name", "Doe")
        lead.title = kw.get("title", "CEO")
        lead.email = kw.get("email", "john@acme.com")
        lead.industry = kw.get("industry", None)
        lead.website = kw.get("website", None)
        lead.city = kw.get("city", None)
        lead.state = kw.get("state", None)
        lead.country = kw.get("country", None)
        lead.employee_count = kw.get("employee_count", None)
        lead.annual_revenue = kw.get("annual_revenue", None)
        return lead

    def test_includes_company(self):
        prompt = _build_prompt(self._make_lead())
        assert "Acme" in prompt and "CEO" in prompt

    def test_contains_rcm_product_context(self):
        assert "RCM" in _build_prompt(self._make_lead())

    def test_contains_all_6_output_fields(self):
        prompt = _build_prompt(self._make_lead())
        for f in ["company_pulse", "why_they_need_us", "opening_line",
                  "likely_objection", "persona_signal", "heat_score"]:
            assert f in prompt

    def test_no_crash_on_empty_lead(self):
        """EC-6: all fields None — prompt still generates (uses fallback text)."""
        lead = self._make_lead(company=None, first_name=None, last_name=None,
                               title=None, email=None)
        prompt = _build_prompt(lead)
        assert len(prompt) > 50
        assert "Minimal lead data" in prompt

    def test_india_title_uses_generic_persona(self):
        """EC-1: title='India' → generic_ops persona."""
        prompt = _build_prompt(self._make_lead(title="India"))
        assert "Unknown / General" in prompt

    def test_clinical_title_flags_nonbuyer(self):
        """EC-4: clinical role → clinical_nonbuyer persona."""
        prompt = _build_prompt(self._make_lead(title="Patient Care Technician"))
        assert "Clinical" in prompt or "buyer" in prompt.lower()


# ── _map_persona unit tests ───────────────────────────────────────────────────

class TestMapPersona:
    def test_ceo(self):          assert _map_persona("CEO") == "decision_maker_founder"
    def test_founder(self):      assert _map_persona("Founder") == "decision_maker_founder"
    def test_vp_sales(self):     assert _map_persona("VP of Sales") == "sales_leader"
    def test_coo(self):          assert _map_persona("Chief Operating Officer") == "ops_buyer"
    def test_ops_manager(self):  assert _map_persona("Operations Manager") == "ops_buyer"
    def test_marketing(self):    assert _map_persona("Marketing Manager") == "marketing_influencer"
    def test_it_manager(self):   assert _map_persona("IT Manager") == "technical_blocker"
    def test_india_ec1(self):    assert _map_persona("India") == "generic_ops"
    def test_not_provided_ec2(self): assert _map_persona("[not provided]") == "generic_ops"
    def test_none_ec3(self):     assert _map_persona(None) == "generic_ops"
    def test_empty(self):        assert _map_persona("") == "generic_ops"
    def test_clinical_ec4(self): assert _map_persona("Patient Care Technician") == "clinical_nonbuyer"


# ── AI Research endpoint integration test ────────────────────────────────────

class TestAiResearchEndpoint:
    """Integration-level tests via the full FastAPI app."""

    def test_404_on_unknown_lead(self, client, db):
        resp = client.post("/api/leads/nonexistent-id/ai-research")
        assert resp.status_code == 404

    def test_cache_miss_calls_groq_and_returns_v2_fields(self, client, db):
        from conftest import create_test_lead
        lead = create_test_lead(db, company="NewCorp")
        mock_result = {
            "company_pulse": "NewCorp builds SDR tools.",
            "why_they_need_us": "They have 5 SDRs. RCM cuts dial time.",
            "opening_line": "Hi there, worth 2 minutes?",
            "likely_objection": "Too expensive → ROI in 30 days.",
            "persona_signal": "Decision maker.",
            "heat_score": "warm, COO at mid-size firm",
        }
        with patch("routes.ai_research_routes._call_groq_single", new_callable=AsyncMock) as mock_groq:
            mock_groq.return_value = mock_result
            resp = client.post(f"/api/leads/{lead.id}/ai-research")
        assert resp.status_code == 200
        data = resp.json()
        assert data["company_pulse"] == "NewCorp builds SDR tools."
        assert data["heat_score"] == "warm"
        mock_groq.assert_called_once()

    def test_cache_hit_for_different_contact_at_same_company_regenerates(self, client, db):
        """A CompanyResearch row cached for one contact (e.g. Erica) must NOT be
        served verbatim to a different contact at the same company (e.g. Jon) —
        the persona fields (why_they_need_us/opening_line/etc.) are tailored to
        one person. Bug report: switching leads at the same company showed the
        previous contact's research."""
        from conftest import create_test_lead
        import models

        db.add(models.CompanyResearch(
            company_name="beforepaygroup",
            research_contact="Erica Haupt",
            research_company="Beforepay Group offers financial services.",
            research_hypothesis="Erica likely struggles with manual SDR tracking.",
            research_opening="Hi Erica, worth 2 minutes?",
            research_heat="hot",
        ))
        db.commit()

        jon = create_test_lead(db, first_name="Jon", last_name="Whitby", company="Beforepay Group")
        mock_result = {
            "company_pulse": "Beforepay Group offers financial services.",
            "why_they_need_us": "Jon likely struggles with partnership tracking.",
            "opening_line": "Hi Jon, worth 2 minutes?",
            "likely_objection": "Too expensive → ROI in 30 days.",
            "persona_signal": "Decision maker.",
            "heat_score": "hot, Head of Marketing & Partnership",
        }
        with patch("routes.ai_research_routes._call_groq_single", new_callable=AsyncMock) as mock_groq:
            mock_groq.return_value = mock_result
            resp = client.post(f"/api/leads/{jon.id}/ai-research")
        assert resp.status_code == 200
        data = resp.json()
        # Must NOT return Erica's cached persona content
        assert "Erica" not in data["why_they_need_us"]
        assert data["why_they_need_us"] == "Jon likely struggles with partnership tracking."
        assert data["from_cache"] is False
        mock_groq.assert_called_once()


class TestMeetingAgendaDraft:
    """POST /{lead_id}/meeting-agenda-draft — client-safe agenda text for the
    "Meeting Booked" modal. Must never surface the persona/objection/heat-score
    fields (see _build_agenda_prompt's docstring) — that's enforced by prompt
    design, not sanitization, so these tests check the endpoint's plumbing
    (success/failure/missing-data), not prompt content."""

    def test_404_on_unknown_lead(self, client, db):
        resp = client.post("/api/leads/nonexistent-id/meeting-agenda-draft")
        assert resp.status_code == 404

    def test_success_returns_drafted_agenda(self, client, db):
        from conftest import create_test_lead
        lead = create_test_lead(db, company="Acme Corp")
        with patch("routes.ai_research_routes._call_groq_single", new_callable=AsyncMock) as mock_groq:
            mock_groq.return_value = {"agenda": "We'll review Acme Corp's current sales workflow and discuss next steps."}
            resp = client.post(f"/api/leads/{lead.id}/meeting-agenda-draft")
        assert resp.status_code == 200
        assert resp.json()["agenda"] == "We'll review Acme Corp's current sales workflow and discuss next steps."
        mock_groq.assert_called_once()

    def test_works_without_research_company_set(self, client, db):
        """Lead with no AI Research run yet — prompt still works, just more generic."""
        from conftest import create_test_lead
        lead = create_test_lead(db, company="NoResearchYet Inc")
        assert not lead.research_company
        with patch("routes.ai_research_routes._call_groq_single", new_callable=AsyncMock) as mock_groq:
            mock_groq.return_value = {"agenda": "We'll discuss your needs and how we can help."}
            resp = client.post(f"/api/leads/{lead.id}/meeting-agenda-draft")
        assert resp.status_code == 200
        assert resp.json()["agenda"]

    def test_groq_failure_propagates_same_error_shape_as_research_endpoint(self, client, db):
        from conftest import create_test_lead
        lead = create_test_lead(db, company="FailCorp")
        with patch("routes.ai_research_routes._call_groq_single", new_callable=AsyncMock) as mock_groq:
            mock_groq.side_effect = HTTPException(status_code=502, detail="AI service error: 500")
            resp = client.post(f"/api/leads/{lead.id}/meeting-agenda-draft")
        assert resp.status_code == 502


"""
test_ai_copy.py — journey_engine/ai_copy.py (AI-generated cadence email copy).
Reuses services/smart_analytics.py's Groq config resolution; these tests
cover the generation call itself, not that shared config-resolution code
(already implicitly exercised by smart_analytics' own route tests).
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
from unittest.mock import patch

import models
from journey_engine.ai_copy import generate_email_copy, AICopyError


class _FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


def _configure_llm(db, api_key="fake-groq-key", model="llama-3.1-8b-instant"):
    settings = models.SyncSettings(id=1, llm_api_key=api_key, llm_model=model)
    db.add(settings)
    db.commit()
    return settings


def _groq_response(subject, body):
    content = json.dumps({"subject": subject, "body": body})
    return _FakeResp(200, {"choices": [{"message": {"content": content}}]})


def test_generates_subject_and_body_from_a_prompt(db):
    _configure_llm(db)
    with patch("httpx.post", return_value=_groq_response("Quick question, {{first_name}}", "Hi {{first_name}}, ...")):
        result = generate_email_copy(db, "Follow-up after a demo no-show")

    assert result == {"subject": "Quick question, {{first_name}}", "body": "Hi {{first_name}}, ..."}


def test_strips_markdown_fences_from_the_response(db):
    _configure_llm(db)
    content = "```json\n" + json.dumps({"subject": "Hi", "body": "Body text"}) + "\n```"
    with patch("httpx.post", return_value=_FakeResp(200, {"choices": [{"message": {"content": content}}]})):
        result = generate_email_copy(db, "A brief")

    assert result == {"subject": "Hi", "body": "Body text"}


def test_no_api_key_configured_raises_llm_not_configured(db):
    db.add(models.SyncSettings(id=1))
    db.commit()
    try:
        generate_email_copy(db, "A brief")
        assert False, "expected AICopyError"
    except AICopyError as e:
        assert e.code == "llm_not_configured"


def test_non_200_response_raises_llm_error(db):
    _configure_llm(db)
    with patch("httpx.post", return_value=_FakeResp(500, text="server error")):
        try:
            generate_email_copy(db, "A brief")
            assert False, "expected AICopyError"
        except AICopyError as e:
            assert e.code == "llm_error"


def test_non_json_response_raises_invalid_llm_response(db):
    _configure_llm(db)
    with patch("httpx.post", return_value=_FakeResp(200, {"choices": [{"message": {"content": "not json"}}]})):
        try:
            generate_email_copy(db, "A brief")
            assert False, "expected AICopyError"
        except AICopyError as e:
            assert e.code == "invalid_llm_response"


def test_response_missing_subject_or_body_raises_invalid_llm_response(db):
    _configure_llm(db)
    content = json.dumps({"subject": "Hi"})   # missing "body"
    with patch("httpx.post", return_value=_FakeResp(200, {"choices": [{"message": {"content": content}}]})):
        try:
            generate_email_copy(db, "A brief")
            assert False, "expected AICopyError"
        except AICopyError as e:
            assert e.code == "invalid_llm_response"

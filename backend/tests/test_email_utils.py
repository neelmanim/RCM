"""
test_email_utils.py — Unit tests for email_utils.sanitize_preview().
Pure function tests — no DB or HTTP fixtures needed.

Updated for v2 behaviour: sanitize_preview now stores the FULL sanitized
body (HTML preserved, dangerous tags removed) instead of a 200-char
plain-text strip. Quote/signature stripping is NO LONGER performed on
the stored body — the frontend handles display-level truncation.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from email_utils import sanitize_preview, is_auto_reply


class TestIsAutoReply:
    """Tests for the is_auto_reply OOO/auto-responder detector."""

    def test_rfc3834_auto_submitted_header_detected(self):
        headers = [{"name": "Auto-Submitted", "value": "auto-replied"}]
        assert is_auto_reply(headers, "Re: Following up") is True

    def test_auto_submitted_no_is_not_auto_reply(self):
        # RFC 3834: "no" is the explicit non-auto-reply value.
        headers = [{"name": "Auto-Submitted", "value": "no"}]
        assert is_auto_reply(headers, "Re: Following up") is False

    def test_x_autoreply_header_detected(self):
        headers = [{"name": "X-Autoreply", "value": "yes"}]
        assert is_auto_reply(headers, "Re: Following up") is True

    def test_subject_heuristic_out_of_office(self):
        assert is_auto_reply([], "Out of Office: back Monday") is True

    def test_subject_heuristic_automatic_reply(self):
        assert is_auto_reply([], "Automatic reply: I am currently out of the office") is True

    def test_subject_heuristic_case_insensitive(self):
        assert is_auto_reply([], "AUTO-REPLY: vacation responder") is True

    def test_normal_reply_is_not_auto_reply(self):
        assert is_auto_reply([], "Re: pricing question") is False
        assert is_auto_reply(None, "Sounds good, let's talk Thursday") is False

    def test_missing_headers_falls_back_to_subject_only(self):
        assert is_auto_reply(None, "Automatic response: unavailable until next week") is True


class TestSanitizePreview:
    """Tests for the sanitize_preview helper."""

    def test_preserve_safe_html_tags(self):
        """Safe HTML tags are preserved; text content is intact."""
        html = "<p>Hello <b>World</b></p><br/><div>Content</div>"
        result = sanitize_preview(html)
        assert "Hello" in result
        assert "World" in result
        assert "Content" in result
        # Safe tags are kept (not stripped)
        assert "<p>" in result or "<b>" in result or "<div>" in result

    def test_strip_dangerous_html_tags(self):
        """Dangerous tags (script, iframe, object) must be removed.
        bleach strip=True removes the tags but keeps text content — that's fine,
        the executable context is gone."""
        html = "<p>Safe</p><script>alert('xss')</script>"
        result = sanitize_preview(html)
        assert "Safe" in result
        assert "<script" not in result.lower()
        assert "</script>" not in result.lower()

    def test_strip_iframe(self):
        """iframe tags must be stripped."""
        html = "<p>Content</p><iframe src='http://evil.com'></iframe>"
        result = sanitize_preview(html)
        assert "Content" in result
        assert "<iframe" not in result.lower()

    def test_full_body_stored_not_stripped(self):
        """Full body is stored — quoted replies are NOT stripped from storage.
        The frontend/display layer handles collapsing quoted content."""
        text = "Thanks.\n\nOn Mon, Mar 5, 2026 at 10:30 AM John wrote:\nOriginal message"
        result = sanitize_preview(text)
        # Full content including quoted reply is preserved
        assert "Thanks" in result
        assert "Original message" in result

    def test_signature_preserved(self):
        """Signatures are stored as-is (not stripped at storage layer)."""
        text = "Please review the doc.\n\nBest regards,\nJohn Doe"
        result = sanitize_preview(text)
        assert "Please review" in result
        assert "John Doe" in result

    def test_max_len_truncation(self):
        """Output should be truncated at max_len when specified."""
        text = "A" * 500
        result = sanitize_preview(text, max_len=100)
        assert len(result) == 100

    def test_default_max_len_64k(self):
        """Default max_len is 64 KB (65536 chars) — not 200 chars."""
        text = "B" * 70000
        result = sanitize_preview(text)
        assert len(result) == 65536

    def test_short_text_not_truncated(self):
        """Text shorter than max_len is returned as-is."""
        text = "Short text"
        result = sanitize_preview(text)
        assert "Short text" in result

    def test_empty_input(self):
        """Empty string and None should return empty string."""
        assert sanitize_preview("") == ""
        assert sanitize_preview(None) == ""

    def test_plain_text_passthrough(self):
        """Clean plain text without HTML passes through intact."""
        text = "Hi team, let's schedule a call for Thursday."
        result = sanitize_preview(text)
        assert "Hi team" in result
        assert "Thursday" in result

    def test_html_entities_preserved(self):
        """HTML entities like &middot; and &amp; are preserved in output."""
        html = "<p>RCM &middot; Powered by RCM</p>"
        result = sanitize_preview(html)
        assert "&middot;" in result or "·" in result
        assert "RCM" in result
        assert "RCM" in result

    def test_large_html_body(self):
        """Large HTML email body (e.g. newsletter) is stored without truncation at 200."""
        body = "<p>" + ("Some email content. " * 50) + "</p>"  # ~1000 chars
        result = sanitize_preview(body)
        assert len(result) > 500  # Was truncated to 200 before — now stored fully
        assert "Some email content" in result

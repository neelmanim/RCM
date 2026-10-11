"""Tests for email_send.py's send_email — the shared Nylas
POST + LeadEmailActivity helper used by both Email Campaigns and Sales
Journey (extracted from journey_engine/channels/email_channel.py)."""
import os
import pytest
from unittest.mock import patch

# Same idiom as test_email_stage1.py / test_journey_engine.py / test_public_api.py:
# crypto.encrypt_token needs this at call time. Without it this module only
# passed as part of a full-suite run, riding on another module's import-time
# setdefault — running it alone (or with -k) failed on a missing key.
os.environ.setdefault("APP_ENCRYPTION_KEY", "dGVzdGtleXRlc3RrZXl0ZXN0a2V5dGVzdGtleXRlc3Q=")

from crypto import encrypt_token
from email_send import send_email
from conftest import create_test_lead, create_test_user, create_nylas_config, create_user_mailbox


class _FakeResp:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


def _setup(db, owner_id="owner-1"):
    create_test_user(db, email="owner@test.com", name="Owner", role="Pod Admin", id=owner_id)
    create_nylas_config(db, api_key_encrypted=encrypt_token("fake-nylas-key"))
    return create_user_mailbox(db, user_id=owner_id)


def test_403_gets_a_clear_non_retryable_result(db):
    """RCA: a 403 (commonly a missing send scope on the Nylas connector)
    previously fell through to the generic 400-499 branch with no logging at
    all — the raw Nylas error was never visible anywhere, and a campaign/
    cadence dispatch loop had no way to distinguish it from any other 4xx.
    Now it gets the same "stop the batch" non-retryable treatment as 401."""
    mailbox = _setup(db)
    lead = create_test_lead(db, email="lead@example.com")

    with patch("httpx.post", return_value=_FakeResp(403, text='{"error":"forbidden"}')):
        result = send_email(db, mailbox, "Subject", "Body", lead)

    assert result.success is False
    assert result.retryable is False
    assert "not authorized to send" in result.error


def test_401_still_returns_non_retryable_reconnect_message(db):
    """Existing behavior, unchanged — asserted here so the new 403 branch
    demonstrably didn't regress the pre-existing 401 handling next to it."""
    mailbox = _setup(db)
    lead = create_test_lead(db, email="lead@example.com")

    with patch("httpx.post", return_value=_FakeResp(401)):
        result = send_email(db, mailbox, "Subject", "Body", lead)

    assert result.success is False
    assert result.retryable is False
    assert "reconnect" in result.error.lower()

# ── v12.2: body_is_html picks the HTML policy ───────────────────────────────
# Bug this covers: an Email Campaign body is authored in a rich-text editor,
# so it is real HTML, but every send went through the escape path — recipients
# got a literal "<p>Hi Shreyash,</p>" in the message text.


class _CapturingResp:
    """200 with the minimal Nylas success shape send_email reads back."""
    status_code = 200
    text = ""

    @staticmethod
    def json():
        return {"data": {"id": "msg-1", "thread_id": "thread-1"}}


def _sent_html(db, body, **kwargs):
    mailbox = _setup(db)
    lead = create_test_lead(db, email="lead@example.com")
    with patch("httpx.post", return_value=_CapturingResp()) as posted:
        result = send_email(db, mailbox, "Subject", body, lead, **kwargs)
    assert result.success is True
    return posted.call_args.kwargs["json"]["body"]


def test_html_body_reaches_nylas_as_real_markup(db):
    html = _sent_html(db, "<p>Hi Shreyash,</p><p>Second line</p>", body_is_html=True)
    assert "<p>Hi Shreyash,</p>" in html
    # The exact failure mode from the bug report — escaped tags in the body.
    assert "&lt;p&gt;" not in html


def test_html_body_keeps_the_formatting_the_editor_can_produce(db):
    html = _sent_html(
        db,
        '<p><b>Bold</b> <i>italic</i></p><ul><li>One</li></ul><a href="https://x.test">link</a>',
        body_is_html=True,
    )
    for tag in ("<b>", "<i>", "<ul>", "<li>", "href="):
        assert tag in html, f"{tag} was stripped from an HTML campaign body"


def test_html_body_is_still_sanitized_of_dangerous_markup(db):
    """body_is_html means "sanitize", not "trust" — the campaign body is
    stored server-side and could carry anything a direct API caller sent."""
    html = _sent_html(db, '<p>Hi</p><script>alert(1)</script>', body_is_html=True)
    assert "<script>" not in html
    assert "<p>Hi</p>" in html


def test_plain_body_is_still_escaped_and_newlines_preserved(db):
    """The Sales Journey cadence path (a plain <textarea>) must NOT change —
    it relies on escaping, and on \\n becoming <br>."""
    html = _sent_html(db, "Hi there\nSecond line <not-a-tag>")
    assert "<br>" in html
    assert "&lt;not-a-tag&gt;" in html


@pytest.mark.parametrize("code", [401, 403])
def test_grant_failure_marks_the_mailbox_unhealthy(db, code):
    """Reported live on staging: a campaign send failed with "Mailbox is
    connected but not authorized to send" while My Settings still showed a
    green "Connected" badge, and nothing anywhere told the user to reconnect.

    routes/email_routes.py's own /email/send has always set status="error"
    on 401/403; this shared path (Email Campaigns + Sales Journey cadences)
    never did — so failures that arrived through a campaign left the mailbox
    looking healthy forever. GET /email/mailbox-status derives "connected"
    straight from this column, so the badge could not have known.
    """
    mailbox = _setup(db)
    lead = create_test_lead(db, email="lead@example.com")
    assert mailbox.status == "connected"

    with patch("httpx.post", return_value=_FakeResp(code, text='{"error":"nope"}')):
        result = send_email(db, mailbox, "Subject", "Body", lead)

    assert result.success is False
    db.commit()  # callers commit their own per-recipient result row
    db.refresh(mailbox)
    assert mailbox.status == "error", (
        f"Nylas {code} left the mailbox marked {mailbox.status!r}, so My "
        f"Settings keeps showing 'Connected' for a mailbox that cannot send."
    )


def test_successful_send_leaves_status_connected(db):
    """The flip side — a healthy send must not touch status."""
    mailbox = _setup(db)
    lead = create_test_lead(db, email="lead@example.com")

    with patch("httpx.post", return_value=_CapturingResp()):
        result = send_email(db, mailbox, "Subject", "Body", lead)

    assert result.success is True
    db.commit()
    db.refresh(mailbox)
    assert mailbox.status == "connected"


# ── v12.3: send_email now appends the mailbox owner's saved signature ──────
# Bug this covers: neither Sales Journey cadences nor Email Campaigns ever
# included the sender's My Settings signature — this shared function simply
# never read User.email_signature_html at all, despite the standalone
# /email/send compose endpoint doing it correctly all along.


def test_signature_is_appended_by_default(db):
    mailbox = _setup(db)
    mailbox.user.email_signature_html = "<p>Jane Doe</p>"
    db.commit()
    lead = create_test_lead(db, email="lead@example.com")

    with patch("httpx.post", return_value=_CapturingResp()) as posted:
        result = send_email(db, mailbox, "Subject", "Body", lead)

    assert result.success is True
    assert "Jane Doe" in posted.call_args.kwargs["json"]["body"]


def test_signature_omitted_when_include_signature_is_false(db):
    """The Email Campaigns per-campaign toggle, threaded through as
    include_signature=False."""
    mailbox = _setup(db)
    mailbox.user.email_signature_html = "<p>Jane Doe</p>"
    db.commit()
    lead = create_test_lead(db, email="lead@example.com")

    with patch("httpx.post", return_value=_CapturingResp()) as posted:
        result = send_email(db, mailbox, "Subject", "Body", lead, include_signature=False)

    assert result.success is True
    assert "Jane Doe" not in posted.call_args.kwargs["json"]["body"]


def test_no_signature_block_when_user_has_none_saved(db):
    """A blank/unset signature must not render an empty wrapper div."""
    mailbox = _setup(db)
    lead = create_test_lead(db, email="lead@example.com")

    with patch("httpx.post", return_value=_CapturingResp()) as posted:
        result = send_email(db, mailbox, "Subject", "Body", lead)

    assert result.success is True
    html = posted.call_args.kwargs["json"]["body"]
    assert "Jane Doe" not in html

"""Wrong number, end to end.

Before: "Wrong Number" was a call outcome that changed nothing, and with no call
the only way out was Disqualify (which closes the whole lead). Now one helper
(lead_service.mark_phone_invalid) flags the phone, notes it, and closes the
cadences' open call reminders; call/text steps then skip, email carries on, and
editing the phone clears the flag. Every entry point (button, call log, Aircall
tag) reaches the same helper.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

import models
from journey_engine import engine as je
from journey_engine.channels.call_channel import CallChannelProvider
from journey_engine.channels.sms_channel import SMSChannelProvider
from journey_engine.channels.whatsapp_channel import WhatsAppChannelProvider
from services.lead_service import mark_phone_invalid, update_lead_fields
from conftest import create_test_lead, create_test_user, create_test_task, SDR_USER
from test_cadence_playbook import TRIGGER, WAIT, _edges, _journey, _rep_lead, _run


def _assign(db, lead, user_id, email, role="SDR"):
    u = db.query(models.User).filter(models.User.id == user_id).first() or create_test_user(db, email=email, role=role, id=user_id)
    u.assigned_leads.append(lead)
    db.commit()


# ── Endpoint ─────────────────────────────────────────────────────────────────

class TestEndpoint:
    def test_sdr_marks_own_lead(self, client_as_sdr, db):
        lead = create_test_lead(db, phone="+15551230000")
        _assign(db, lead, "sdr-user-id", "sdr@test.com")
        r = client_as_sdr.post(f"/api/leads/{lead.id}/phone/invalid")
        assert r.status_code == 200 and r.json()["phone_invalid_at"]
        db.refresh(lead)
        assert lead.phone_invalid_at is not None
        assert lead.status == "Lead Assigned"  # not a disqualify
        assert client_as_sdr.get(f"/api/leads/{lead.id}").json()["phone_invalid_at"]

    def test_sdr_cannot_mark_another_reps_lead(self, client_as_sdr, db):
        lead = create_test_lead(db, email="other@x.com", phone="+15551230000")
        _assign(db, lead, "other-sdr-id", "other@test.com")
        assert client_as_sdr.post(f"/api/leads/{lead.id}/phone/invalid").status_code == 404
        db.refresh(lead)
        assert lead.phone_invalid_at is None

    def test_csm_without_assignment_is_refused_and_assigned_is_allowed(self, client_as_csm, db):
        lead = create_test_lead(db, phone="+15551230000")
        assert client_as_csm.post(f"/api/leads/{lead.id}/phone/invalid").status_code == 404
        _assign(db, lead, "csm-user-id", "csm@test.com", role="CSM")
        assert client_as_csm.post(f"/api/leads/{lead.id}/phone/invalid").status_code == 200

    def test_super_admin_and_unknown_lead(self, client, db):
        lead = create_test_lead(db, phone="+15551230000")
        assert client.post(f"/api/leads/{lead.id}/phone/invalid").status_code == 200
        assert client.post("/api/leads/nope/phone/invalid").status_code == 404

    def test_repeat_click_is_idempotent(self, client, db):
        lead = create_test_lead(db, phone="+15551230000")
        client.post(f"/api/leads/{lead.id}/phone/invalid")
        first = db.query(models.Lead).get(lead.id).phone_invalid_at
        client.post(f"/api/leads/{lead.id}/phone/invalid")
        db.expire_all()
        assert db.query(models.Lead).get(lead.id).phone_invalid_at == first
        assert db.query(models.Note).filter(models.Note.lead_id == lead.id).count() == 1


# ── Helper ───────────────────────────────────────────────────────────────────

def _enrolled_with_tasks(db):
    """A lead in a cadence with one call step and one LinkedIn step, each with its open Task."""
    lead = create_test_lead(db, phone="+15551230000")
    j = _journey(db, [TRIGGER, {"id": "c", "type": "call", "data": {}},
                      {"id": "li", "type": "task", "data": {"task_kind": "linkedin_message"}}],
                 _edges(("t", "c"), ("c", "li")))
    e = models.JourneyEnrollment(journey_id=j.id, version_id=j.live_version_id, lead_id=lead.id, current_node_id="li")
    db.add(e)
    db.commit()

    def task(node, **kw):
        t = models.Task(lead_id=lead.id, title=node, journey_enrollment_id=e.id, journey_node_id=node, **kw)
        db.add(t)
        return t
    call, linkedin = task("c"), task("li")
    approval = task("c", kind="email_approval")
    db.add(models.Task(lead_id=lead.id, title="manual follow-up"))
    db.commit()
    return lead, call, linkedin, approval


class TestHelper:
    def test_flags_notes_and_closes_only_call_reminders(self, db):
        lead, call, linkedin, approval = _enrolled_with_tasks(db)
        assert mark_phone_invalid(db, lead, "Asha") is True
        db.commit()
        db.refresh(call), db.refresh(linkedin), db.refresh(approval)

        assert lead.phone_invalid_at is not None
        assert (call.done, call.outcome) == ("true", "wrong_number")
        assert linkedin.done == "false"           # a manual LinkedIn step has nothing to do with the phone
        assert approval.done == "false"           # nor does an approval
        notes = db.query(models.Note).filter(models.Note.lead_id == lead.id).all()
        assert [n.content for n in notes] == ["Phone marked wrong by Asha"]
        assert notes[0].author == "Asha"
        # the lead's own status and the rest of its tasks are untouched
        assert lead.status == "Lead Assigned"
        assert db.query(models.Task).filter(models.Task.title == "manual follow-up").one().done == "false"

    def test_idempotent(self, db):
        lead, *_ = _enrolled_with_tasks(db)
        assert mark_phone_invalid(db, lead, "Asha") is True
        db.commit()
        stamp = lead.phone_invalid_at
        assert mark_phone_invalid(db, lead, "Someone else") is False
        db.commit()
        assert lead.phone_invalid_at == stamp
        assert db.query(models.Note).filter(models.Note.lead_id == lead.id).count() == 1


# ── Clearing ─────────────────────────────────────────────────────────────────

class TestClearOnPhoneEdit:
    def _flagged(self, db):
        lead = create_test_lead(db, phone="+1 (555) 123-0000")
        lead.phone_invalid_at = datetime.now(timezone.utc)
        db.commit()
        return lead

    def test_new_number_clears_the_flag(self, db):
        lead = self._flagged(db)
        update_lead_fields(db, lead, {"phone": "+15559998888"}, SDR_USER)
        assert lead.phone_invalid_at is None

    def test_same_number_reformatted_keeps_the_flag(self, db):
        lead = self._flagged(db)
        update_lead_fields(db, lead, {"phone": "+15551230000"}, SDR_USER)
        assert lead.phone_invalid_at is not None

    def test_editing_other_fields_keeps_the_flag(self, db):
        lead = self._flagged(db)
        update_lead_fields(db, lead, {"title": "CTO", "phone_secondary": "+15550001111"}, SDR_USER)
        assert lead.phone_invalid_at is not None


# ── Cadence effect ───────────────────────────────────────────────────────────

class TestChannelsSkip:
    def _lead(self):
        return models.Lead(first_name="A", last_name="B", phone="+15551230000",
                           phone_invalid_at=datetime.now(timezone.utc))

    @pytest.mark.parametrize("provider", [CallChannelProvider, SMSChannelProvider, WhatsAppChannelProvider])
    def test_send_skips_with_a_clear_error(self, provider):
        result = provider().send(MagicMock(), self._lead(), MagicMock(), {})
        assert result.skip is True and result.success is False
        assert result.retryable is False and "wrong" in result.error.lower()

    def test_sms_preflight_refuses_the_approval(self):
        assert "wrong" in SMSChannelProvider().preflight(MagicMock(), self._lead(), MagicMock()).lower()

    def test_call_step_in_a_live_cadence_is_skipped_and_the_cadence_moves_on(self, db):
        _, _, lead = _rep_lead(db, phone="+15551230000")
        lead.phone_invalid_at = datetime.now(timezone.utc)
        db.commit()
        j = _journey(db, [TRIGGER, {"id": "c", "type": "call", "data": {}}, WAIT], _edges(("t", "c"), ("c", "w")))
        e = _run(db, je.enroll_lead(db, j, lead))
        assert e.status == "active" and e.current_node_id == "w"
        assert db.query(models.Task).filter(models.Task.lead_id == lead.id).count() == 0
        assert db.query(models.ExecutionLog).filter(models.ExecutionLog.event_type == "step_skipped").count() == 1

    def test_call_step_still_creates_its_reminder_when_the_phone_is_fine(self, db):
        _, _, lead = _rep_lead(db, phone="+15551230000")
        j = _journey(db, [TRIGGER, {"id": "c", "type": "call", "data": {}}, WAIT], _edges(("t", "c"), ("c", "w")))
        _run(db, je.enroll_lead(db, j, lead))
        assert db.query(models.Task).filter(models.Task.lead_id == lead.id).count() == 1


# ── Other entry points ───────────────────────────────────────────────────────

class TestEveryRouteMarksThePhone:
    def test_log_call_wrong_number(self, client, db):
        create_test_user(db, email="admin@test.com")
        lead = create_test_lead(db, phone="+15551230000", status="Calling")
        r = client.post(f"/api/leads/{lead.id}/calls", json={"outcome": "Wrong Number", "notes": ""})
        assert r.status_code == 200, r.text
        db.refresh(lead)
        assert lead.phone_invalid_at is not None
        assert lead.status == "Calling"

    def test_log_call_other_outcome_leaves_the_phone_alone(self, client, db):
        create_test_user(db, email="admin@test.com")
        lead = create_test_lead(db, phone="+15551230000", status="Calling")
        client.post(f"/api/leads/{lead.id}/calls", json={"outcome": "No Answer", "notes": ""})
        db.refresh(lead)
        assert lead.phone_invalid_at is None

    def test_aircall_wrong_number_tag(self, db):
        from test_call_attempt_counting import _webhook
        lead = create_test_lead(db, phone="+919876543210", status="Calling")
        _webhook(db, tags=["Bad Number"])
        db.refresh(lead)
        assert lead.phone_invalid_at is not None
        assert "Aircall tag" in db.query(models.Note).filter(models.Note.lead_id == lead.id).one().content

    def test_aircall_other_tag_leaves_the_phone_alone(self, db):
        from test_call_attempt_counting import _webhook
        lead = create_test_lead(db, phone="+919876543210", status="Calling")
        _webhook(db, tags=["Not Answered"])
        db.refresh(lead)
        assert lead.phone_invalid_at is None

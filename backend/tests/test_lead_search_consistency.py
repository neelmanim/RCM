"""v13.9.0 — every screen that searches leads uses the one shared clause (routes/lead_helpers.lead_search_clause):
a full "First Last" name, in either order, a word from the name plus one from the company, and a phone only when
digits are typed. One test per screen so they can't drift apart again."""
from datetime import datetime, timezone

import models
from conftest import create_test_lead, create_test_user


def _world(db):
    hit = create_test_lead(db, first_name="Gopala", last_name="Tale", email="g@zeta.com", company="Zeta Corp", phone="+91 98765 43210")
    miss = create_test_lead(db, first_name="Gopal", last_name="Other", email="o@other.com", company="Other Inc", phone="+1 555 000 1111")
    return hit, miss


# phrases that must find "Gopala Tale" and must NOT find "Gopal Other"
FINDS = ["Gopala Tale", "Tale Gopala", "gopala  tale", "Gopala Zeta", "Tale", "98765"]
MISSES = ["Nobody Here", "Gopala Other"]


def _check(ids_for, hit, miss):
    for q in FINDS:
        assert ids_for(q) == {hit.id}, f"{q!r} should find only the Gopala Tale lead"
    for q in MISSES:
        assert ids_for(q) == set(), f"{q!r} should find nothing"


def test_leads_list(client, db):
    hit, miss = _world(db)
    def ids(q):
        body = client.get("/api/leads", params={"search": q, "per_page": 50}).json()
        return {l["id"] for l in (body if isinstance(body, list) else body["data"])}
    _check(ids, hit, miss)


def test_global_search_bar(client, db):
    hit, miss = _world(db)
    _check(lambda q: {l["id"] for l in client.get("/api/search", params={"q": q}).json()["leads"]}, hit, miss)
    # the other phone columns still work, with digits
    db.query(models.Lead).filter_by(id=hit.id).update({"phone_secondary": "415-555-1234"}); db.commit()
    assert {l["id"] for l in client.get("/api/search", params={"q": "415-555"}).json()["leads"]} == {hit.id}


def test_call_monitor(client, db):
    hit, miss = _world(db)
    sdr = create_test_user(db, email="sdr@t.com", role="SDR")
    for lead in (hit, miss):
        db.add(models.DialerCall(user_id=sdr.id, lead_id=lead.id, provider="messenger", direction="outbound",
                                 status="CALL_ENDED", outcome="No Answer", duration=30, phone_number="+10000000000"))
    db.commit()
    def ids(q):
        return {i["lead_id"] for i in client.get("/api/admin/call-logs", params={"search": q}).json()["items"] if i.get("lead_id")}
    for q in ("Gopala Tale", "Tale Gopala", "Gopala Zeta"):
        assert ids(q) == {hit.id}, q
    assert ids("Nobody Here") == set()


def test_replies_inbox_also_searches_the_subject(client, db):
    hit, miss = _world(db)
    now = datetime.now(timezone.utc)
    for lead, subj in ((hit, "Pricing question"), (miss, "Other topic")):
        db.add(models.LeadEmailActivity(lead_id=lead.id, direction="inbound", source="instantly", instantly_email_id=f"r-{lead.id}",
                                        instantly_thread_id=f"t-{lead.id}", subject=subj, body_preview="x", from_email="a@x.com",
                                        to_email="b@x.com", timestamp=now, is_auto_reply=False))
    db.commit()
    def ids(q):
        return {i["lead_id"] for i in client.get("/api/instantly/replies", params={"search": q}).json()["items"]}
    for q in ("Gopala Tale", "Tale Gopala", "Pricing", "Gopala Pricing"):
        assert ids(q) == {hit.id}, q
    assert ids("Nobody Here") == set()


def test_activity_monitor_email_and_sms(client, db):
    hit, miss = _world(db)
    sdr = create_test_user(db, email="sdr@t.com", role="SDR")
    now = datetime.now(timezone.utc)
    for lead, subj in ((hit, "Intro call"), (miss, "Something else")):
        db.add(models.LeadEmailActivity(lead_id=lead.id, user_id=sdr.id, direction="outbound", source="nylas", subject=subj,
                                        body_preview="x", from_email="u@t.com", to_email="l@t.com", timestamp=now,
                                        nylas_message_id=f"m-{lead.id}"))
        db.add(models.SmsLog(lead_id=lead.id, user_id=sdr.id, direction="outbound", phone_number="+10000000000", message_text=f"hello {subj}",
                             status="delivered", sent_at=now))
    db.commit()
    def email_ids(q):
        return {i["lead_id"] for i in client.get("/api/admin/email-logs", params={"search": q}).json()["items"]}
    def sms_ids(q):
        return {i["lead_id"] for i in client.get("/api/admin/message-logs", params={"search": q}).json()["items"]}
    for ids in (email_ids, sms_ids):
        for q in ("Gopala Tale", "Tale Gopala", "Gopala Zeta"):
            assert ids(q) == {hit.id}, (ids.__name__, q)
        assert ids("Nobody Here") == set()
    assert email_ids("Intro") == {hit.id}
    assert sms_ids("Something") == {miss.id}

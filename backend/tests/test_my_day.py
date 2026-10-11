"""v13.9.4 — My Day: what was given to me and what I did, in my own timezone."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

import models
from conftest import create_test_user, create_test_lead, grant_export

now = lambda: datetime.now(timezone.utc)


@pytest.fixture()
def me(client_as_sdr, db):
    user = create_test_user(db, email="sdr@test.com", name="SDR User", role="SDR", id="sdr-user-id")
    return client_as_sdr, user


def _assign(db, user, lead, at=None):
    user.assigned_leads.append(lead)
    db.commit()
    if at:
        db.execute(update(models.lead_assignments).where(models.lead_assignments.c.lead_id == lead.id)
                   .values(assigned_at=at))
        db.commit()


def _get(client, **params):
    r = client.get("/api/my-day", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_given_today_covers_new_assignments_and_resets_but_not_old_untouched_leads(me, db):
    client, user = me
    fresh = create_test_lead(db, email="fresh@x.com", first_name="Fresh")
    reset = create_test_lead(db, email="reset@x.com", first_name="Reset")
    old = create_test_lead(db, email="old@x.com", first_name="Old")
    other = create_test_lead(db, email="other@x.com", first_name="Other")
    _assign(db, user, fresh)
    _assign(db, user, reset, at=now() - timedelta(days=9))
    _assign(db, user, old, at=now() - timedelta(days=9))
    db.add(models.LeadStatusLog(lead_id=reset.id, from_status="Calling", to_status="Lead Assigned", changed_by="Admin"))
    db.add(models.LeadStatusLog(lead_id=other.id, from_status="Calling", to_status="Lead Assigned", changed_by="Admin"))
    db.commit()

    given = _get(client)["given"]
    by = {l["name"]: l["reason"] for l in given["leads"]}
    assert by == {"Fresh Doe": "Assigned to you", "Reset Doe": "Reset to Lead Assigned"}
    assert (given["total"], given["assigned"], given["reset"]) == (2, 1, 1)


def test_did_today_counts_my_calls_notes_moves_and_lists_them(me, db):
    client, user = me
    lead = create_test_lead(db, email="l@x.com", first_name="Lee")
    _assign(db, user, lead, at=now() - timedelta(days=3))
    db.add(models.CallLog(lead_id=lead.id, user_id=user.id, outcome="No Answer", called_at=now()))
    db.add(models.CallLog(lead_id=lead.id, user_id=user.id, outcome="Old call", called_at=now() - timedelta(days=2)))
    db.add(models.CallLog(lead_id=lead.id, user_id="someone-else", outcome="Not mine", called_at=now()))
    db.add(models.Note(lead_id=lead.id, content="n", author="SDR User"))
    db.add(models.LeadStatusLog(lead_id=lead.id, from_status="Lead Assigned", to_status="Meeting Scheduled", changed_by="SDR User"))
    db.add(models.LeadStatusLog(lead_id=lead.id, from_status="Calling", to_status="Disqualified", changed_by="Admin"))
    db.commit()

    did = _get(client)["did"]
    assert (did["calls"], did["notes"], did["status_changes"], did["meetings_booked"], did["leads_worked"]) == (1, 1, 1, 1, 1)
    assert {a["kind"] for a in did["activity"]} == {"call", "note", "status"}
    assert "Call — No Answer" in [a["text"] for a in did["activity"]]


def test_the_day_is_the_persons_own_day_not_utc(me, db):
    client, user = me
    lead = create_test_lead(db, email="tz@x.com")
    _assign(db, user, lead, at=now() - timedelta(days=5))
    # 00:15 IST today = 18:45 UTC yesterday
    ist_now = now() + timedelta(minutes=330)
    ist_midnight = ist_now.replace(hour=0, minute=0, second=0, microsecond=0)
    just_after_ist_midnight = ist_midnight - timedelta(minutes=330) + timedelta(minutes=15)
    db.add(models.CallLog(lead_id=lead.id, user_id=user.id, outcome="Early", called_at=just_after_ist_midnight))
    db.commit()
    if just_after_ist_midnight > now():
        pytest.skip("before 00:15 IST the call would be in the future")
    assert _get(client, tz_offset_min=-330)["did"]["calls"] == 1
    # same instant seen from UTC is "yesterday" when it is before UTC midnight
    utc_midnight = now().replace(hour=0, minute=0, second=0, microsecond=0)
    expected_utc = 1 if just_after_ist_midnight >= utc_midnight else 0
    assert _get(client, tz_offset_min=0)["did"]["calls"] == expected_utc


def test_not_yet_called_is_leads_nobody_ever_called(me, db):
    client, user = me
    never = create_test_lead(db, email="never@x.com", status="Lead Assigned")
    called = create_test_lead(db, email="called@x.com", status="Lead Assigned")
    closed = create_test_lead(db, email="closed@x.com", status="Disqualified")
    for l in (never, called, closed):
        _assign(db, user, l, at=now() - timedelta(days=4))
    db.add(models.CallLog(lead_id=called.id, user_id=user.id, outcome="Call Back Later", called_at=now() - timedelta(days=4)))
    db.commit()
    assert _get(client)["now"]["not_yet_called"] == 1


def test_a_past_date_and_a_bad_date(me, db):
    client, user = me
    assert _get(client, date="2020-01-01")["date"] == "2020-01-01"
    assert client.get("/api/my-day", params={"date": "yesterday"}).status_code == 400


# ── Saved views (per user, server-side) ──────────────────────────────────────

def _view(name="Tagged", keys=("tag",), **kw):
    return {"name": name, "filters": {"tag": ["India Sep"]}, "keys": list(keys), "search": "", **kw}


def test_saved_views_round_trip_and_are_private(me, db, client):
    client_sdr, user = me
    other = create_test_user(db, email="o@t.com", name="Other", role="SDR", id="other-id")
    db.add(models.SavedView(user_id=other.id, name="Theirs", filters={}, keys=["status"]))
    db.commit()

    created = client_sdr.post("/api/me/saved-views", json=_view())
    assert created.status_code == 200, created.text
    listed = client_sdr.get("/api/me/saved-views").json()["views"]
    assert [v["name"] for v in listed] == ["Tagged"] and listed[0]["filters"] == {"tag": ["India Sep"]}
    # another person's view can't be removed
    theirs = db.query(models.SavedView).filter_by(name="Theirs").first()
    assert client_sdr.delete(f"/api/me/saved-views/{theirs.id}").status_code == 404
    assert client_sdr.delete(f"/api/me/saved-views/{listed[0]['id']}").status_code == 200
    assert client_sdr.get("/api/me/saved-views").json()["views"] == []


def test_saved_view_validation_messages(me):
    client, _ = me
    assert "name" in client.post("/api/me/saved-views", json=_view(name=" ")).json()["detail"].lower()
    assert "filter" in client.post("/api/me/saved-views", json=_view(keys=())).json()["detail"].lower()
    assert client.post("/api/me/saved-views", json=_view()).status_code == 200
    dup = client.post("/api/me/saved-views", json=_view())
    assert dup.status_code == 409 and "already" in dup.json()["detail"]
    for i in range(29):
        assert client.post("/api/me/saved-views", json=_view(name=f"v{i}")).status_code == 200
    assert "up to 30" in client.post("/api/me/saved-views", json=_view(name="one-too-many")).json()["detail"]


# ── v13.9.5: pagination, kind filter, CSV export ─────────────────────────────

def _busy_day(db, user, n=25):
    lead = create_test_lead(db, email="busy@x.com", first_name="Busy")
    _assign(db, user, lead, at=now() - timedelta(days=3))
    for i in range(n):
        db.add(models.CallLog(lead_id=lead.id, user_id=user.id, outcome=f"Outcome {i}", called_at=now() - timedelta(seconds=i)))   # seconds, not minutes: stays inside "today" right after midnight
    db.add(models.Note(lead_id=lead.id, content="n", author=user.name))
    db.commit()
    return lead


def test_activity_is_paginated_server_side_with_no_silent_cap(me, db):
    client, user = me
    _busy_day(db, user, n=125)
    p1 = _get(client, per_page=50)["did"]
    assert (p1["activity_total"], p1["pages"], len(p1["activity"])) == (126, 3, 50)
    p3 = _get(client, per_page=50, did_page=3)["did"]
    assert len(p3["activity"]) == 26 and p3["page"] == 3                      # the rows past 100 are reachable
    assert _get(client, per_page=50, did_page=99)["did"]["page"] == 3         # out-of-range page clamps, no error


def test_kind_filter_and_counts_by_kind(me, db):
    client, user = me
    _busy_day(db, user, n=4)
    did = _get(client, kind="note")["did"]
    assert did["activity_total"] == 1 and [a["kind"] for a in did["activity"]] == ["note"]
    assert did["by_kind"] == {"call": 4, "note": 1, "status": 0, "email": 0}  # counts ignore the filter so tabs stay stable
    assert client.get("/api/my-day", params={"kind": "bogus"}).status_code == 400


def test_given_list_is_paginated_too(me, db):
    client, user = me
    for i in range(12):
        _assign(db, user, create_test_lead(db, email=f"g{i}@x.com", first_name=f"G{i}"))
    g = _get(client, per_page=5)["given"]
    assert (g["total"], g["pages"], len(g["leads"])) == (12, 3, 5)
    assert len(_get(client, per_page=5, given_page=3)["given"]["leads"]) == 2


def test_export_is_the_whole_day_as_csv_and_neutralises_formulas(me, db):
    client, user = me
    grant_export(db, user.id)
    lead = create_test_lead(db, email="f@x.com", first_name="=SUM(A1)", last_name="Boom")
    _assign(db, user, lead)
    for i in range(60):
        db.add(models.CallLog(lead_id=lead.id, user_id=user.id, outcome="No Answer", called_at=now() - timedelta(seconds=i)))   # seconds, not minutes: stays inside "today" right after midnight
    db.commit()
    r = client.get("/api/my-day/export", params={"tz_offset_min": 0})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"] and ".csv" in r.headers["content-disposition"]
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("Section,Time (UTC),Lead,Company,Detail,Lead ID")
    assert len(lines) == 1 + 1 + 60                                           # header + the given lead + every call (not a page)
    assert "'=SUM(A1) Boom" in r.text and ",=SUM" not in r.text


# ── Dashboard click-through: the Leads list opens exactly what the card counted ──

def test_smart_views_open_exactly_what_the_dashboard_counted(me, db):
    client, user = me
    fresh = create_test_lead(db, email="sf@x.com", first_name="Fresh", status="Lead Assigned")
    reset = create_test_lead(db, email="sr@x.com", first_name="Reset", status="Lead Assigned")
    called = create_test_lead(db, email="sc@x.com", first_name="Called", status="Calling")
    old = create_test_lead(db, email="so@x.com", first_name="Old", status="Lead Assigned")
    _assign(db, user, fresh)
    for l in (reset, called, old):
        _assign(db, user, l, at=now() - timedelta(days=9))
    db.add(models.LeadStatusLog(lead_id=reset.id, from_status="Calling", to_status="Lead Assigned", changed_by="Admin"))
    db.add(models.CallLog(lead_id=called.id, user_id=user.id, outcome="No Answer", called_at=now() - timedelta(days=9)))
    db.add(models.CallLog(lead_id=reset.id, user_id=user.id, outcome="No Answer", called_at=now() - timedelta(days=9)))
    db.commit()

    day = _get(client)
    w = day["window"]
    listed = client.get("/api/leads", params={"smart": "given_today", "smart_from": w["start"], "smart_to": w["end"], "per_page": 50})
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == day["given"]["total"] == 2
    assert {l["first_name"] for l in listed.json()["data"]} == {"Fresh", "Reset"}

    # the browser sends its own day bounds as ISO strings, often ending in Z — same answer
    as_z = client.get("/api/leads", params={"smart": "given_today", "smart_from": w["start"].replace("+00:00", ".000Z"),
                                            "smart_to": w["end"].replace("+00:00", ".000Z"), "per_page": 50})
    assert as_z.status_code == 200, as_z.text
    assert as_z.json()["total"] == 2

    never = client.get("/api/leads", params={"smart": "not_yet_called", "per_page": 50}).json()
    assert never["total"] == day["now"]["not_yet_called"]
    assert {l["first_name"] for l in never["data"]} == {"Fresh", "Old"}      # Reset/Called have a call in their history


def test_smart_view_rejects_bad_input(me):
    client, _ = me
    assert client.get("/api/leads", params={"smart": "bogus"}).status_code == 400
    assert client.get("/api/leads", params={"smart": "given_today"}).status_code == 400

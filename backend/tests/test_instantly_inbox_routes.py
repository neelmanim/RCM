"""v13.8.0 — Instantly replies inbox + report: what each role may see, the
numbers, the filters and read state."""
from datetime import datetime, timedelta, timezone

import models
from conftest import create_test_lead, create_test_user

NOW = datetime.now(timezone.utc)
LEA = models.LeadEmailActivity


def _add(db, lead, eid, direction, hours_ago=2, campaign="camp-1", subject=None, body=None, **kw):
    row = LEA(lead_id=lead.id, direction=direction, source="instantly", instantly_email_id=eid,
              instantly_thread_id=kw.pop("thread", f"th-{lead.id}"), instantly_campaign_id=campaign,
              instantly_eaccount=kw.pop("mailbox", "rep@send.example.com"), instantly_step=kw.pop("step", 0),
              subject=subject or ("hi" if direction == "outbound" else "Re: hi"), body_preview=body or "body text",
              from_email="a@x.com", to_email="b@x.com", timestamp=NOW - timedelta(hours=hours_ago),
              is_auto_reply=kw.pop("auto", False if direction == "inbound" else None), **kw)
    db.add(row)
    db.commit()
    return row


def _world(db):
    """Three leads: one assigned to the SDR, one to the AE, one in the pod (unassigned)."""
    sdr = create_test_user(db, email="sdr@test.com", id="sdr-user-id", role="SDR", name="Sam SDR")
    ae = create_test_user(db, email="ae@test.com", id="ae-user-id", role="AE", name="Amy AE")
    mine = create_test_lead(db, email="mine@t.com", first_name="Mia", company="MineCo")
    other = create_test_lead(db, email="other@t.com", first_name="Omar", company="OtherCo")
    db.add(models.Pod(id="test-pod-id", name="Test Pod"))
    db.flush()
    podl = create_test_lead(db, email="pod@t.com", first_name="Pia", company="PodCo", pod_id="test-pod-id")
    mine.assigned_users.append(sdr)
    other.assigned_users.append(ae)
    mine.instantly_interest_label = "Interested"
    db.add(models.Journey(id="j1", name="Q4 Outbound", status="active"))
    db.add(models.JourneyInstantlyCampaign(journey_id="j1", node_id="n1", instantly_campaign_id="camp-1", content_hash="h"))
    db.commit()
    rows = {}
    for lead, tag in ((mine, "mine"), (other, "other"), (podl, "pod")):
        _add(db, lead, f"s-{tag}", "outbound", hours_ago=5)
        rows[tag] = _add(db, lead, f"r-{tag}", "inbound", hours_ago=2)
    return rows, {"mine": mine, "other": other, "pod": podl}


def _subjects(resp):
    return sorted(i["lead_name"] for i in resp.json()["items"])


def test_each_role_sees_only_the_leads_it_may(client, client_as_sdr, client_as_ae, client_as_pod_admin, db):
    _world(db)
    assert client.get("/api/instantly/replies").json()["total"] == 3                    # Super Admin: all
    assert _subjects(client_as_sdr.get("/api/instantly/replies")) == ["Mia Doe"]       # SDR: own
    assert _subjects(client_as_ae.get("/api/instantly/replies")) == ["Omar Doe"]       # AE: own
    assert _subjects(client_as_pod_admin.get("/api/instantly/replies")) == ["Pia Doe"]  # Pod Admin: their pod


def test_csm_is_refused_everywhere(client_as_csm, db):
    rows, _ = _world(db)
    for path in ("/api/instantly/replies", "/api/instantly/filters", "/api/instantly/report", "/api/instantly/summary",
                 f"/api/instantly/replies/{rows['mine'].id}"):
        assert client_as_csm.get(path).status_code == 403, path
    assert client_as_csm.patch(f"/api/instantly/replies/{rows['mine'].id}/read", json={"read": True}).status_code == 403


def test_a_rep_cannot_open_or_mark_another_reps_reply(client_as_sdr, db):
    rows, _ = _world(db)
    assert client_as_sdr.get(f"/api/instantly/replies/{rows['other'].id}").status_code == 404
    assert client_as_sdr.patch(f"/api/instantly/replies/{rows['other'].id}/read", json={"read": True}).status_code == 404
    assert client_as_sdr.get(f"/api/instantly/replies/{rows['mine'].id}").status_code == 200


def test_list_item_shape_and_summary(client, db):
    rows, _ = _world(db)
    body = client.get("/api/instantly/replies").json()
    item = next(i for i in body["items"] if i["lead_name"] == "Mia Doe")
    assert item["subject"] == "Re: hi" and item["snippet"] == "body text" and item["unread"] is True
    assert (item["intent_label"], item["positive"]) == ("Interested", True)
    assert (item["journey_name"], item["step"], item["mailbox"]) == ("Q4 Outbound", 1, "rep@send.example.com")      # step numbers are 1-based
    assert body["summary"] == {"replies": 3, "sent": 3, "reply_rate": 100.0, "positive": 1, "unread": 3}
    assert {"page", "per_page", "pages", "summary"} <= set(body) and "sdrs" not in body


def test_out_of_office_is_hidden_unless_asked_for(client, db):
    _, leads = _world(db)
    _add(db, leads["mine"], "r-ooo", "inbound", subject="Out of office", auto=True)
    assert client.get("/api/instantly/replies").json()["total"] == 3
    assert client.get("/api/instantly/replies?include_auto=true").json()["total"] == 4


def test_filters_narrow_the_list(client, db):
    rows, leads = _world(db)
    _add(db, leads["other"], "r-2", "inbound", campaign="camp-2", mailbox="b@send.example.com", hours_ago=60)
    assert client.get("/api/instantly/replies?journey_id=j1").json()["total"] == 3          # camp-2 isn't j1's
    assert client.get("/api/instantly/replies?mailbox=b@send.example.com").json()["total"] == 1
    assert client.get("/api/instantly/replies?intent=Interested").json()["total"] == 1
    assert client.get("/api/instantly/replies?rep_id=ae-user-id").json()["total"] == 2
    assert client.get("/api/instantly/replies?search=PodCo").json()["total"] == 1
    day = (NOW - timedelta(days=1)).strftime("%Y-%m-%d")
    assert client.get(f"/api/instantly/replies?from={day}").json()["total"] == 3            # the 60h-old one is out


def test_read_state_and_the_unread_filter(client, db):
    rows, _ = _world(db)
    r = client.patch(f"/api/instantly/replies/{rows['mine'].id}/read", json={"read": True}).json()
    assert r["read_at"] is not None
    assert client.get("/api/instantly/replies?status=unread").json()["total"] == 2
    assert client.get("/api/instantly/replies?status=read").json()["total"] == 1
    client.patch(f"/api/instantly/replies/{rows['mine'].id}/read", json={"read": False})
    assert client.get("/api/instantly/replies?status=unread").json()["total"] == 3


def test_pagination_and_sort(client, db):
    rows, leads = _world(db)
    for i in range(4):
        _add(db, leads["mine"], f"r-x{i}", "inbound", hours_ago=10 + i)
    page = client.get("/api/instantly/replies?per_page=3&page=2").json()
    assert page["total"] == 7 and page["pages"] == 3 and len(page["items"]) == 3
    newest = client.get("/api/instantly/replies?per_page=100").json()["items"]
    oldest = client.get("/api/instantly/replies?per_page=100&sort=oldest").json()["items"]
    stamps = [i["timestamp"] for i in newest]
    assert stamps == sorted(stamps, reverse=True) and [i["timestamp"] for i in oldest] == sorted(stamps)


def test_reply_detail_includes_the_earlier_thread(client, db):
    rows, leads = _world(db)
    thread = f"th-{leads['mine'].id}"
    detail = client.get(f"/api/instantly/replies/{rows['mine'].id}").json()
    assert detail["body"] == "body text" and detail["to_email"] == "b@x.com"
    assert [m["direction"] for m in detail["thread"]] == ["outbound"] and thread


def test_report_by_cadence_counts_distinct_leads_and_excludes_out_of_office(client, db):
    _, leads = _world(db)
    _add(db, leads["mine"], "r-2nd", "inbound", hours_ago=1)                       # same lead replies twice: one replied lead
    _add(db, leads["other"], "r-ooo", "inbound", auto=True, subject="Out of office")
    rep = client.get("/api/instantly/report?group_by=cadence").json()
    row = next(r for r in rep["rows"] if r["label"] == "Q4 Outbound")
    assert (row["sent"], row["contacted"], row["replied"], row["positive"]) == (3, 3, 3, 1)
    assert (row["reply_rate"], row["positive_rate"]) == (100.0, 33.3)
    assert rep["totals"]["replied"] == 3


def test_report_groups_by_step_mailbox_and_rep(client, db):
    _, leads = _world(db)
    _add(db, leads["mine"], "s2", "outbound", step=1, mailbox="b@send.example.com", hours_ago=4)
    by = {g: client.get(f"/api/instantly/report?group_by={g}").json() for g in ("step", "mailbox", "rep")}
    assert {r["label"] for r in by["step"]["rows"]} == {"Q4 Outbound · step 1", "Q4 Outbound · step 2"}
    assert {r["label"] for r in by["mailbox"]["rows"]} == {"rep@send.example.com", "b@send.example.com"}
    assert {r["label"] for r in by["rep"]["rows"]} == {"Sam SDR", "Amy AE", "Unassigned"}
    # open/click counters can't be attributed to a step or mailbox: shown as unknown, not 0
    assert all(r["opens"] is None for r in by["step"]["rows"] + by["mailbox"]["rows"])


def test_report_opens_and_clicks_come_from_the_counter_rows(client, db):
    _, leads = _world(db)
    db.add(LEA(lead_id=leads["mine"].id, direction="outbound", source="instantly", instantly_campaign_id="camp-1",
               opened_at=NOW, open_count=3, clicked_at=NOW, click_count=1, timestamp=NOW))
    db.commit()
    row = client.get("/api/instantly/report?group_by=cadence").json()["rows"][0]
    assert (row["opens"], row["clicks"]) == (1, 1)


def test_report_respects_visibility_and_validates_input(client, client_as_sdr, db):
    _world(db)
    assert client_as_sdr.get("/api/instantly/report?group_by=cadence").json()["totals"]["sent"] == 1
    assert client.get("/api/instantly/report?group_by=nonsense").status_code == 422
    assert client.get("/api/instantly/replies?from=not-a-date").status_code == 422


def test_summary_is_the_last_seven_days_plus_all_unread(client, db):
    _, leads = _world(db)
    _add(db, leads["mine"], "r-old", "inbound", hours_ago=24 * 20)
    s = client.get("/api/instantly/summary").json()
    assert (s["days"], s["replies"], s["sent"], s["unread"]) == (7, 3, 3, 4)


def test_filters_lists_only_what_the_viewer_can_see(client, client_as_sdr, db):
    _world(db)
    f = client.get("/api/instantly/filters").json()
    assert f["journeys"] == [{"id": "j1", "name": "Q4 Outbound"}] and f["mailboxes"] == ["rep@send.example.com"]
    assert f["intents"] == ["Interested"]
    assert [r["id"] for r in client_as_sdr.get("/api/instantly/filters").json()["reps"]] == ["sdr-user-id"]
    assert client_as_sdr.get("/api/instantly/filters").json()["intents"] == ["Interested"]


def test_counter_rows_and_pre_v13_8_rows_are_not_listed_as_replies(client, db):
    _, leads = _world(db)
    db.add(LEA(lead_id=leads["mine"].id, direction="inbound", source="instantly", timestamp=NOW))   # legacy: no email id
    db.commit()
    assert client.get("/api/instantly/replies").json()["total"] == 3


def test_the_bell_shows_one_entry_per_instantly_reply_and_skips_out_of_office(client, db):
    """The bell reads the same rows: no duplicate per reply, no OOO."""
    me = create_test_user(db, email="me@t.com", id="test-user-id", role="Super Admin", name="Me")
    lead = create_test_lead(db, email="bell@t.com")
    lead.assigned_users.append(me)
    db.commit()
    _add(db, lead, "r-bell", "inbound", subject="Re: pricing")
    _add(db, lead, "r-bell-ooo", "inbound", subject="Out of office", auto=True)
    titles = [i["title"] for i in client.get("/api/my/replies/pending").json()]
    assert titles == ["Re: pricing"]


# ── regressions from the v13.8.0 pre-ship review ─────────────────────────────

def test_reply_rate_counts_only_leads_contacted_in_the_window_so_it_never_passes_100(client, db):
    _, leads = _world(db)
    old = create_test_lead(db, email="old@t.com", first_name="Olga")
    _add(db, old, "s-old", "outbound", hours_ago=24 * 40)          # emailed 40 days ago…
    _add(db, old, "r-old2", "inbound", hours_ago=24)               # …replied yesterday
    rep = client.get("/api/instantly/report?group_by=cadence").json()
    row = rep["rows"][0]
    assert row["replied"] == 3 and row["contacted"] == 3 and row["reply_rate"] == 100.0   # Olga is outside the 30-day cohort
    assert rep["totals"]["reply_rate"] == 100.0


def test_a_lead_in_two_campaigns_of_one_cadence_is_counted_once(client, db):
    _, leads = _world(db)
    db.add(models.JourneyInstantlyCampaign(journey_id="j1", node_id="n1", instantly_campaign_id="camp-1b", content_hash="h2"))
    db.commit()
    _add(db, leads["mine"], "s-1b", "outbound", campaign="camp-1b", hours_ago=4)
    _add(db, leads["mine"], "r-1b", "inbound", campaign="camp-1b", hours_ago=1)
    rep = client.get("/api/instantly/report?group_by=cadence").json()
    assert [r["label"] for r in rep["rows"]] == ["Q4 Outbound"]
    row = rep["rows"][0]
    assert (row["contacted"], row["replied"]) == (3, 3) and row["sent"] == 4      # Mia: 1 lead, 2 sends


def test_a_managers_implicit_open_does_not_clear_the_reps_bell_but_the_reps_own_open_does(client, client_as_sdr, db):
    rows, _ = _world(db)
    rid = rows["mine"].id
    manager = client.patch(f"/api/instantly/replies/{rid}/read", json={"read": True, "implicit": True}).json()
    assert manager["read_at"] is None                                              # Super Admin isn't Mia's rep
    assert client_as_sdr.patch(f"/api/instantly/replies/{rid}/read", json={"read": True, "implicit": True}).json()["read_at"]
    client_as_sdr.patch(f"/api/instantly/replies/{rid}/read", json={"read": False})
    assert client.patch(f"/api/instantly/replies/{rid}/read", json={"read": True}).json()["read_at"]   # explicit click works for anyone


def test_the_detail_thread_is_what_came_before_newest_twenty(client, db):
    rows, leads = _world(db)
    th = f"th-{leads['mine'].id}"
    for i in range(25):
        _add(db, leads["mine"], f"early-{i}", "outbound", hours_ago=100 + i, thread=th)
    _add(db, leads["mine"], "later", "inbound", hours_ago=0, thread=th)            # newer than the reply being opened
    thread = client.get(f"/api/instantly/replies/{rows['mine'].id}").json()["thread"]
    ids = [m["id"] for m in thread]
    assert len(thread) == 20 and thread == sorted(thread, key=lambda m: m["timestamp"])
    assert all(m["subject"] != "later" for m in thread)
    later = db.query(LEA).filter_by(instantly_email_id="later").one()
    assert later.id not in ids

"""A rate is never above 100%, and its numerator and denominator come from the same rows (the v14.0.1 open-rate bug:
Instantly keeps opens on counter rows that 'sent' excludes, so the Activity Monitor read 223%)."""
from datetime import datetime

import pytest

from conftest import create_test_lead, create_test_user
from tests.test_activity_monitor import _make_email


def _instantly(db, lead, real, opened):
    e = _make_email(db, None, lead.id, direction="outbound", opened_at=datetime(2024, 6, 1) if opened else None,
                    nylas_thread_id=None)
    e.source = "instantly"
    e.instantly_email_id = "em-%s" % e.id if real else None
    db.commit()


@pytest.mark.parametrize("real_sends,counter_rows", [(1, 5), (0, 3), (3, 3), (2, 0)])
def test_activity_monitor_open_rate_within_100(client, db, real_sends, counter_rows):
    lead = create_test_lead(db, email=f"ms_{real_sends}_{counter_rows}@t.com")
    for _ in range(real_sends):
        _instantly(db, lead, real=True, opened=False)
    for _ in range(counter_rows):
        _instantly(db, lead, real=False, opened=True)
    s = client.get("/api/admin/email-logs").json()["summary"]
    assert s["open_rate"] is None or 0 <= s["open_rate"] <= 100, s


def test_open_rate_counts_each_lead_once(client, db):
    sdr = create_test_user(db, email="ms_sdr@t.com", role="SDR")
    lead = create_test_lead(db, email="ms_one@t.com")
    for _ in range(4):
        _make_email(db, sdr.id, lead.id, direction="outbound", opened_at=datetime(2024, 6, 1))
    s = client.get("/api/admin/email-logs").json()["summary"]
    assert s["opened"] == 1 and s["open_rate"] == 100.0

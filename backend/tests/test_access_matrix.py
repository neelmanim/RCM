"""docs/ACCESS_MATRIX.md, one test per cell — including every cell that says "do not see"."""
from contextlib import contextmanager

import pytest

from conftest import create_test_user, create_test_lead, create_test_pod, SUPER_ADMIN
import models
from tests.test_activity_monitor import _make_email, _make_message, _pod_admin_client
from tests.test_call_monitor import _make_dialer_call

ENDPOINTS = ("call-logs", "email-logs", "message-logs")


@pytest.fixture
def world(db):
    """Two pods; each has a rep who acted on a lead in pod A. Plus a no-person row on a lead owned by an A rep."""
    a, b = create_test_pod(db, name="Matrix A"), create_test_pod(db, name="Matrix B")
    rep_a = create_test_user(db, email="mx_rep_a@t.com", role="SDR", pod_id=a.id)
    rep_b = create_test_user(db, email="mx_rep_b@t.com", role="SDR", pod_id=b.id)
    lead_a = create_test_lead(db, email="mx_lead_a@t.com", pod_id=a.id)
    lead_a.assigned_users.append(rep_a)
    db.commit()
    rows = {}
    rows["call-logs"] = {"mine": _make_dialer_call(db, rep_a.id, lead_a.id).id,
                         "other_rep_on_my_lead": _make_dialer_call(db, rep_b.id, lead_a.id).id}
    rows["email-logs"] = {"mine": _make_email(db, rep_a.id, lead_a.id, subject="mine").id,
                          "other_rep_on_my_lead": _make_email(db, rep_b.id, lead_a.id, subject="theirs").id,
                          "no_person_owner_in_my_pod": _make_email(db, None, lead_a.id, subject="sync").id}
    rows["message-logs"] = {"mine": _make_message(db, rep_a.id, lead_a.id).id,
                            "other_rep_on_my_lead": _make_message(db, rep_b.id, lead_a.id).id}
    return {"a": a, "b": b, "rows": rows}


@contextmanager
def _as_pod_admin(db, pod_id, email):
    c, app = _pod_admin_client(db, pod_id, email=email)
    try:
        with c:
            yield c
    finally:
        app.dependency_overrides.clear()


def _ids(client, endpoint):
    return {i["id"] for i in client.get(f"/api/admin/{endpoint}", params={"per_page": 200}).json()["items"]}


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_super_admin_sees_everything(client, world, endpoint):
    assert set(world["rows"][endpoint].values()) <= _ids(client, endpoint)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_pod_admin_sees_own_pods_reps(db, world, endpoint):
    with _as_pod_admin(db, world["a"].id, f"mx_pa_a_{endpoint}@t.com") as c:
        assert world["rows"][endpoint]["mine"] in _ids(c, endpoint)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_pod_admin_does_not_see_another_pods_rep_on_a_lead_in_their_pod(db, world, endpoint):
    with _as_pod_admin(db, world["a"].id, f"mx_pa_a2_{endpoint}@t.com") as c:
        assert world["rows"][endpoint]["other_rep_on_my_lead"] not in _ids(c, endpoint)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_pod_admin_of_the_other_pod_does_not_see_this_pods_records(db, world, endpoint):
    with _as_pod_admin(db, world["b"].id, f"mx_pa_b_{endpoint}@t.com") as c:
        assert world["rows"][endpoint]["mine"] not in _ids(c, endpoint)


def test_no_person_row_follows_the_lead_owners_pod(db, world):
    row = world["rows"]["email-logs"]["no_person_owner_in_my_pod"]
    ca, app_a = _pod_admin_client(db, world["a"].id, email="mx_pa_a3@t.com")
    with ca:
        assert row in _ids(ca, "email-logs")
    cb, app_b = _pod_admin_client(db, world["b"].id, email="mx_pa_b3@t.com")
    with cb:
        assert row not in _ids(cb, "email-logs")
    app_a.dependency_overrides.clear(); app_b.dependency_overrides.clear()


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_pod_admin_with_no_pod_sees_nothing(db, world, endpoint):
    with _as_pod_admin(db, None, f"mx_pa_none_{endpoint}@t.com") as c:
        assert _ids(c, endpoint) == set()


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_sdr_is_refused(client_as_sdr, endpoint):
    assert client_as_sdr.get(f"/api/admin/{endpoint}").status_code in (401, 403)

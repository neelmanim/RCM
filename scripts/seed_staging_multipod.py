#!/usr/bin/env python3
"""Seed STAGING with the cross-pod situations that bit prod, so the negative checks have something to fail on.

    STAGING_DATABASE_URL='postgresql://...staging...' python3 scripts/seed_staging_multipod.py

Idempotent (everything is keyed on the `qa-matrix-` prefix) and refuses anything that looks like prod. Creates:
two pods, a Pod Admin per pod, a Pod Admin with no pod, one rep per pod, a lead in pod A owned by A's rep, and records
on that lead from BOTH reps (calls, emails, an SMS, a no-person email) — all marked "QA-MATRIX".
Then run:  npx playwright test tests/v14-0-2-negatives.spec.js
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

url = os.environ.get("STAGING_DATABASE_URL", "")
if not url or "prod" in url.lower() or "dpg-d6ncblh5pdvs73aacnhg" in url:
    sys.exit("Set STAGING_DATABASE_URL to the STAGING database (refusing anything that looks like prod).")
os.environ["DATABASE_URL"] = url

import models  # noqa: E402
from database import SessionLocal  # noqa: E402

P = "qa-matrix-"


def main():
    db = SessionLocal()
    now = datetime.now(timezone.utc)

    def one(model, **where):
        return db.query(model).filter_by(**where).first()

    def pod(name):
        return one(models.Pod, name=name) or _add(models.Pod(name=name))

    def _add(row):
        db.add(row); db.commit(); db.refresh(row); return row

    def user(key, role, pod_id):
        email = f"{P}{key}@screen-magic.com"
        u = one(models.User, email=email) or _add(models.User(email=email, name=f"QA-MATRIX {key}", role=role, pod_id=pod_id))
        if not db.get(models.AllowedUser, email):
            db.add(models.AllowedUser(email=email, role=role)); db.commit()
        return u

    a, b = pod("QA-MATRIX Pod A"), pod("QA-MATRIX Pod B")
    pa_a = user("pa-a", "Pod Admin", a.id)
    user("pa-none", "Pod Admin", None)
    rep_a, rep_b = user("rep-a", "SDR", a.id), user("rep-b", "SDR", b.id)
    if not one(models.PodAdmin, pod_id=a.id, user_id=pa_a.id):
        db.add(models.PodAdmin(pod_id=a.id, user_id=pa_a.id)); db.commit()

    lead = one(models.Lead, email=f"{P}lead@example.com") or _add(models.Lead(
        first_name="QA-MATRIX", last_name="Lead", email=f"{P}lead@example.com", company="QA Matrix Co",
        status="Calling", lead_source="salesforce", pod_id=a.id, sf_lead_id=f"upload-{P}lead"))
    if rep_a not in lead.assigned_users:
        lead.assigned_users.append(rep_a); db.commit()

    if not one(models.LeadEmailActivity, subject="QA-MATRIX mine"):
        for who, subj in ((rep_a, "QA-MATRIX mine"), (rep_b, "QA-MATRIX theirs"), (None, "QA-MATRIX sync")):
            db.add(models.LeadEmailActivity(lead_id=lead.id, user_id=who.id if who else None, direction="outbound",
                                            subject=subj, body_preview="qa", nylas_thread_id=f"{P}{subj}", timestamp=now))
        for who in (rep_a, rep_b):
            db.add(models.DialerCall(user_id=who.id, lead_id=lead.id, provider="messenger", direction="outbound",
                                     status="CALL_ENDED", duration=30, notes="QA-MATRIX"))
            db.add(models.SmsLog(user_id=who.id, lead_id=lead.id, direction="outbound", status="sent", channel="sms",
                                 message_text=f"QA-MATRIX from {who.name}", phone_number="+10000000009"))
        db.commit()
    print("seeded: pods A/B, pa-a, pa-none, rep-a, rep-b, 1 lead (pod A, owned by rep-a), calls/emails/sms from both reps")


if __name__ == "__main__":
    main()

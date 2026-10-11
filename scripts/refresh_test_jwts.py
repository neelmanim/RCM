#!/usr/bin/env python3
"""Mint fresh staging JWTs for .env.test, reusing the same user identities.

All tokens currently in .env.test are expired. This reconstructs the exact
same payload (sub/email/name/role/pod_id/flags) that was in each token
before, with a new `exp`, signed the same way backend/auth.py does
(jose, HS256).

Run locally with the SAME JWT_SECRET staging uses (never pass it on the
command line — export it first so it doesn't land in shell history):

    export JWT_SECRET=...   # staging's secret
    python3 scripts/refresh_test_jwts.py [--days 30] [--write]

Without --write, prints the new KEY=token lines to stdout for review.
With --write, updates .env.test in place (replacing each TOKEN= line).
"""
import argparse
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from jose import jwt

_SUPER_ADMIN = dict(sub="6de0d567-1acf-4e98-944b-542c77d308e4", email="neelmani.mishra@screen-magic.com",
                     name="Neelmani Mishra", role="Super Admin", pod_id=None,
                     dialer_enabled=True, email_sync_enabled=True)

USERS = {
    "JWT_TOKEN": _SUPER_ADMIN, "SA_TOKEN": _SUPER_ADMIN, "ADMIN_TOKEN": _SUPER_ADMIN,
    "SDR_TOKEN": dict(sub="a170ab52-a041-4fe5-9796-f02e1327115a", email="demo.sdr@messenger.dev",
                      name="Demo SDR", role="SDR", pod_id=None,
                      dialer_enabled=False, email_sync_enabled=False),
    "AE_TOKEN": dict(sub="d620c5c8-79d2-41ac-b698-adfd600701b9", email="demo.ae@messenger.dev",
                     name="Demo AE", role="AE", pod_id=None,
                     dialer_enabled=False, email_sync_enabled=False),
    "CSM_TOKEN": dict(sub="3206a225-c6e5-4d12-93b8-8a52ba6f2741", email="demo.csm@messenger.dev",
                      name="Demo CSM", role="CSM", pod_id=None,
                      dialer_enabled=False, email_sync_enabled=False),
    "PA_TOKEN": dict(sub="88f25e8f-c422-4a70-85d2-10eda72aecd8", email="demo.podadmin@messenger.dev",
                     name="Demo Pod Admin", role="Pod Admin", pod_id=None,
                     dialer_enabled=False, email_sync_enabled=False),
    "POD_ADMIN_TOKEN": dict(sub="d9faa1f8-2aaa-4aa0-8274-c135b11979e7", email="amit.patel@testcrm.com",
                            name="Amit Patel", role="Pod Admin", pod_id="fc9ed4f6-c215-4399-b382-378b159ea20c",
                            dialer_enabled=False, email_sync_enabled=False),
    # The identity tests/v13-0-1-staging-writes.spec.js already uses as its
    # SDR (confirmed still access_allowed=true on staging as of 2026-10-01;
    # demo.sdr@messenger.dev above is NOT — kept for other specs that may
    # still reference it, but new specs should prefer this one).
    "SDR_DEVKAPOOR_TOKEN": dict(sub="5635a809-52f3-44a2-b9f3-c5f2118f049b", email="dev.beta@test.messenger.com",
                                name="Dev Kapoor", role="SDR", pod_id="b9d226b8-da78-42ef-a850-586d7da9a645",
                                dialer_enabled=False, email_sync_enabled=False),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    secret = os.environ.get("JWT_SECRET")
    if not secret:
        sys.exit("JWT_SECRET is not set in this shell's environment — export it first.")

    exp = datetime.now(timezone.utc) + timedelta(days=args.days)
    lines = {}
    for key, payload in USERS.items():
        token = jwt.encode({**payload, "exp": exp}, secret, algorithm="HS256")
        lines[key] = token

    if not args.write:
        for key, token in lines.items():
            print(f"{key}={token}")
        return

    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.test")
    with open(env_path) as f:
        content = f.read()
    for key, token in lines.items():
        new_content, n = re.subn(rf"^{key}=.*$", f"{key}={token}", content, flags=re.MULTILINE)
        content = new_content if n else content.rstrip("\n") + f"\n{key}={token}\n"
    with open(env_path, "w") as f:
        f.write(content)
    print(f"Updated {len(lines)} tokens in {env_path}, expiring {exp.isoformat()}")


if __name__ == "__main__":
    main()

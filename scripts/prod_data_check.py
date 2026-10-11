#!/usr/bin/env python3
"""Read-only data hygiene check for prod (or staging). Run before every release and after every deploy.

    PROD_DSN='postgresql://user:pass@host/db' python3 scripts/prod_data_check.py

Opens a read-only session (the database refuses any write) and never stores the DSN. Exit code 1 when a BLOCKER is found.
"""
import os
import sys

import psycopg2

INTERNAL = "(lower(l.email) LIKE '%@screen-magic.com' OR lower(l.email) LIKE '%@staging.in')"

CHECKS = [  # (level, title, SQL returning rows to show; any row = finding)
    ("BLOCKER", "Internal staff addresses that are live leads (their mail gets logged as lead replies)",
     f"SELECT l.id, l.first_name, l.last_name, l.email FROM leads l WHERE l.deleted_at IS NULL AND {INTERNAL}"),
    ("BLOCKER", "Pod Admins with no pod (they would see nothing)",
     "SELECT u.id, u.name FROM users u WHERE u.role = 'Pod Admin' AND u.pod_id IS NULL "
     "AND NOT EXISTS (SELECT 1 FROM pod_admins p WHERE p.user_id = u.id)"),
    ("WARN", "Pods with a Pod Admin but no time zone (their Daily Digest day runs on UTC)",
     "SELECT p.id, p.name FROM pods p WHERE p.timezone IS NULL AND EXISTS "
     "(SELECT 1 FROM pod_admins a WHERE a.pod_id = p.id)"),
    ("WARN", "People no longer allowed to log in who still own leads (reassign them)",
     "SELECT u.name, count(*) FROM users u JOIN lead_assignments la ON la.user_id = u.id "
     "WHERE u.left_at IS NOT NULL OR lower(u.email) NOT IN (SELECT lower(email) FROM allowed_users) "
     "GROUP BY u.name ORDER BY 2 DESC"),
    ("WARN", "Live leads in no pod (no Pod Admin can see them)",
     "SELECT count(*) FROM leads WHERE deleted_at IS NULL AND pod_id IS NULL HAVING count(*) > 0"),
    ("WARN", "Leads owned by a rep from a different pod than the lead's pod",
     "SELECT count(*) FROM leads l JOIN lead_assignments la ON la.lead_id = l.id JOIN users u ON u.id = la.user_id "
     "WHERE l.deleted_at IS NULL AND l.pod_id IS NOT NULL AND u.pod_id IS NOT NULL AND u.pod_id <> l.pod_id "
     "HAVING count(*) > 0"),
    ("WARN", "Email rows on internal-address leads",
     f"SELECT count(*) FROM lead_email_activity e JOIN leads l ON l.id = e.lead_id WHERE {INTERNAL} HAVING count(*) > 0"),
    ("INFO", "Lead statuses outside the known set (e.g. 'Meeting Booked')",
     "SELECT status, count(*) FROM leads WHERE deleted_at IS NULL AND status NOT IN ('Lead Assigned','Calling',"
     "'Meeting Scheduled','1st Discovery Meeting','Discovery Complete','Demo Scheduled','Demo Done','Completed',"
     "'Disqualified','Won','Lost') GROUP BY status ORDER BY 2 DESC"),
]


def main():
    dsn = os.environ.get("PROD_DSN")
    if not dsn:
        sys.exit("Set PROD_DSN in the shell (never in a file).")
    conn = psycopg2.connect(dsn, connect_timeout=15, options="-c default_transaction_read_only=on -c statement_timeout=60000")
    conn.set_session(readonly=True, autocommit=False)
    cur, blockers = conn.cursor(), 0
    for level, title, sql in CHECKS:
        try:
            cur.execute(sql)
            rows = cur.fetchall()
        except Exception as e:  # a missing table/column must not hide the other checks
            conn.rollback()
            print(f"[ERR ] {title}: {str(e)[:120]}")
            continue
        print(f"[{'OK  ' if not rows else level:<4}] {title}" + (f" — {len(rows)} row(s)" if rows else ""))
        for r in rows[:25]:
            print("         ", r)
        blockers += level == "BLOCKER" and bool(rows)
    conn.rollback()
    sys.exit(1 if blockers else 0)


if __name__ == "__main__":
    main()

"""One-off (2026-10-07): add a "tag added" history row for each of the 666 leads that were tagged
"India Healthcare Distribution Sep 2026" directly in the prod database, so the lead timeline shows it.

Run from a terminal, with the prod connection string in an environment variable (it is NOT in this file):

    cd "/Users/neelmani-mishra/Documents/CRM Alternate"
    PROD_DSN='postgresql://...'  .venv/bin/python -I scripts/prod_one_off/backfill_tag_history.py

One transaction. It checks the tag still has exactly 666 leads and that no tag history exists yet, inserts 666 rows
(only touches lead_field_history), checks the count, then commits. Any failed check rolls everything back.
Running it twice is safe: the second run stops at the "no tag history yet" check.
"""
import os
import psycopg2

TAG = "India Healthcare Distribution Sep 2026"
BY = "Neelmani Mishra (bulk tag, 2026-10-07)"

con = psycopg2.connect(os.environ["PROD_DSN"])
con.autocommit = False
cur = con.cursor()


def one(q, a=None):
    cur.execute(q, a)
    return cur.fetchone()[0]


try:
    tid = one("select id from tags where name=%s", (TAG,))
    n = one("select count(*) from lead_tags where tag_id=%s", (tid,))
    assert n == 666, f"expected 666 tagged leads, found {n}"
    assert one("select count(*) from lead_field_history where field_name='tags'") == 0, "tag history already exists"
    before = one("select count(*) from lead_field_history")
    cur.execute(
        """insert into lead_field_history(id, lead_id, field_name, old_value, new_value, changed_by, changed_at)
           select gen_random_uuid()::text, lt.lead_id, 'tags', null, %s, %s, t.created_at
           from lead_tags lt join tags t on t.id = lt.tag_id where lt.tag_id = %s""",
        (TAG, BY, tid),
    )
    assert cur.rowcount == 666, cur.rowcount
    assert one("select count(*) from lead_field_history") == before + 666
    con.commit()
    print("COMMITTED: 666 tag history rows")
except Exception as e:
    con.rollback()
    print("ROLLED BACK:", repr(e))
    raise

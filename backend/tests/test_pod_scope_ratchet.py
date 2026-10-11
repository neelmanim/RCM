"""Ratchet: pod scoping must go through the shared helpers (access_db.pod_of / pod_for, analytics_routes._effective_pod_id,
_pod_scope_activity_query). A new hand-written pod filter, or a new raw `.get("pod_id")` on an identity (which is None for
a pod-less Pod Admin, i.e. "no filter" — the v14.0.1 Activity Monitor hole), fails here.

Counts below are today's baseline. Lowering one is welcome. Raising one needs a reason: route the new code through the
helper instead, or — if it genuinely must filter by pod itself — raise the number in the same PR and say why in the commit.
"""
import glob
import os
import re

HERE = os.path.dirname(os.path.dirname(__file__))
FILTER = re.compile(r"pod_id\s*==|\.pod_id\s*!=|pod_id\.in_|Pod\.id\s*==")
RAW_GET = re.compile(r"""\.get\(["']pod_id["']\)""")

FILTER_BASELINE = {
    "routes/activity_feed_routes.py": 2, "routes/admin_assignment_routes.py": 6, "routes/admin_routes.py": 3,
    "routes/admin_upload_routes.py": 5, "routes/admin_user_routes.py": 4, "routes/ae_pipeline_routes.py": 1,
    "routes/analytics_digest_routes.py": 7,   # v14.3.0: _drill_scope picks the reps with the Digest's own rule (pod from access_db.pod_of)
     "routes/analytics_routes.py": 14, "routes/csm_portal_routes.py": 1,
    "routes/dialer_routes.py": 1, "routes/disqualify_routes.py": 2, "routes/email_campaign_routes.py": 1,
    "routes/error_log_routes.py": 2, "routes/export_routes.py": 1, "routes/growth_intelligence_routes.py": 1,
    "routes/instantly_inbox_routes.py": 1, "routes/journey_routes.py": 2, "routes/lead_routes.py": 4,
    "routes/leaderboard_routes.py": 2, "routes/metrics_routes.py": 3, "routes/pod_routes.py": 20,
    "routes/reassign_routes.py": 3, "routes/report_routes.py": 2, "routes/sdr_performance_routes.py": 1,
    "routes/search_routes.py": 2, "routes/smart_analytics_routes.py": 1, "services/daily_activity.py": 1,
    "services/smart_analytics.py": 26,
}
RAW_GET_BASELINE = {
    "routes/activity_feed_routes.py": 1, "routes/admin_routes.py": 1, "routes/admin_upload_routes.py": 2,
    "routes/admin_user_routes.py": 3, "routes/analytics_routes.py": 2, "routes/csm_portal_routes.py": 1,
    "routes/dialer_routes.py": 1, "routes/email_campaign_routes.py": 1, "routes/export_routes.py": 1,
    "routes/journey_routes.py": 1, "routes/lead_routes.py": 9, "routes/leaderboard_routes.py": 3,
    "routes/metrics_routes.py": 6, "routes/report_routes.py": 1,
}


def _counts(pattern):
    out = {}
    for path in glob.glob(os.path.join(HERE, "routes", "*.py")) + glob.glob(os.path.join(HERE, "services", "*.py")):
        n = sum(1 for line in open(path) if pattern.search(line) and not line.strip().startswith("#"))
        if n:
            out[os.path.relpath(path, HERE)] = n
    return out


def _grown(now, baseline):
    return {f: (baseline.get(f, 0), n) for f, n in now.items() if n > baseline.get(f, 0)}


def test_no_new_hand_written_pod_filters():
    grown = _grown(_counts(FILTER), FILTER_BASELINE)
    assert not grown, f"new pod filter(s) outside the shared helpers (baseline, now): {grown}"


def test_no_new_raw_identity_pod_id_reads():
    grown = _grown(_counts(RAW_GET), RAW_GET_BASELINE)
    assert not grown, f'new .get("pod_id") on an identity — None for a pod-less Pod Admin means no filter; use access_db.pod_of: {grown}'

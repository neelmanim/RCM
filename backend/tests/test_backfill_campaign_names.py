"""Tests for scripts/backfill_campaign_names.py's matching logic (find_renames)."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import models
from backfill_campaign_names import find_renames


def test_renames_a_campaign_that_matches_a_current_template(db):
    db.add(models.EmailTemplate(name="Patient Inquiry Follow-up", subject="Hi {{first_name}}", body="Body text"))
    db.add(models.EmailCampaign(
        name="Hi {{first_name}}", subject="Hi {{first_name}}", body="Body text",
        created_by="test-user-id", status="completed",
    ))
    db.commit()

    renames, total_candidates = find_renames(db)
    assert total_candidates == 1
    assert len(renames) == 1
    campaign, new_name = renames[0]
    assert new_name == "Patient Inquiry Follow-up"


def test_no_matching_template_is_not_renamed(db):
    db.add(models.EmailCampaign(
        name="Hi {{first_name}}", subject="Hi {{first_name}}", body="Body text",
        created_by="test-user-id", status="completed",
    ))
    db.commit()

    renames, total_candidates = find_renames(db)
    assert total_candidates == 1
    assert renames == []


def test_ignores_a_campaign_that_already_has_a_real_name(db):
    """name != subject[:80] means it was either created after v12.7.11 (real
    name from the compose form) or already renamed — never touch it."""
    db.add(models.EmailTemplate(name="Should Not Match", subject="Hi {{first_name}}", body="Body text"))
    db.add(models.EmailCampaign(
        name="My real campaign name", subject="Hi {{first_name}}", body="Body text",
        created_by="test-user-id", status="completed",
    ))
    db.commit()

    renames, total_candidates = find_renames(db)
    assert total_candidates == 0
    assert renames == []


def test_body_must_also_match_not_just_subject(db):
    db.add(models.EmailTemplate(name="Wrong Template", subject="Hi {{first_name}}", body="Different body"))
    db.add(models.EmailCampaign(
        name="Hi {{first_name}}", subject="Hi {{first_name}}", body="Body text",
        created_by="test-user-id", status="completed",
    ))
    db.commit()

    renames, total_candidates = find_renames(db)
    assert total_candidates == 1
    assert renames == []

"""
Tests for csm_health.py's factor plumbing — specifically that adding a health
factor is genuinely additive.

The plan promises Usage/Support/Payment/Sentiment "slot in additively later
without a rewrite". Two things used to make that false: `partial` was a
hardcoded True and `partial_label` a frozen string naming Usage/Support, so
the score would have claimed those were missing forever even once they
landed. These tests pin the derived behaviour instead.

Run with: JWT_SECRET=test_secret .venv/bin/pytest backend/tests/test_csm_health_factors.py -q
"""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import csm_health


def _account():
    return SimpleNamespace(customer_since=None, manual_health_tier=None)


def _score():
    return csm_health.compute_health_score(_account(), [], [], [])


class TestHealthFactorPlumbing:
    def test_factors_dict_reports_every_weighted_factor(self):
        result = _score()
        assert set(result["factors"]) == set(csm_health._FACTOR_WEIGHTS)

    def test_partial_and_label_are_derived_from_the_missing_factor_list(self):
        result = _score()
        assert result["partial"] is True
        # Names what we do have and what we don't, both from the real lists.
        for present in csm_health._FACTOR_WEIGHTS:
            assert present.capitalize() in result["partial_label"]
        for missing in csm_health._MISSING_FACTORS:
            assert missing in result["partial_label"]
        assert "not yet available" in result["partial_label"]

    def test_promoting_a_factor_moves_it_from_missing_into_the_label_header(self, monkeypatch):
        """The additive contract, stated honestly: writing the factor's own
        compute function and appending one tuple in compute_health_score is
        unavoidable — you have to say how it's calculated. What must NOT need
        touching is the label prose or the partial flag. Promoting "Usage"
        moves it from the "not yet available" half into the "Based on" half
        with no edit to _partial_label itself."""
        monkeypatch.setitem(csm_health._FACTOR_WEIGHTS, "usage", 0.5)
        monkeypatch.setattr(csm_health, "_MISSING_FACTORS", ("Support",))

        label = _score()["partial_label"]
        have_half, _, missing_half = label.partition("—")

        assert "Usage" in have_half
        assert "Usage" not in missing_half
        assert "Support" in missing_half

    def test_no_missing_factors_means_not_partial_and_no_label(self, monkeypatch):
        """Once every factor has a data source, the footnote must disappear
        on its own rather than needing a code edit."""
        monkeypatch.setattr(csm_health, "_MISSING_FACTORS", ())
        result = _score()
        assert result["partial"] is False
        assert result["partial_label"] == ""

    def test_weights_are_normalised_so_they_need_not_sum_to_one(self, monkeypatch):
        """Guards the 'append to the list' promise: a contributor adding a
        factor shouldn't have to rebalance the existing weights."""
        monkeypatch.setitem(csm_health._FACTOR_WEIGHTS, "commercial", 3.0)
        monkeypatch.setitem(csm_health._FACTOR_WEIGHTS, "relationship", 7.0)
        result = _score()
        assert 0.0 <= result["score"] <= 100.0


class TestChampionPresentSignal:
    """CSM feedback (2026-09-17): an AccountStakeholder tagged Champion is a
    broader signal than ClosingBrief.champion_active (which only exists for
    accounts with an AE handover) — it should nudge relationship up, but
    never override an actual departure."""

    def _stakeholder(self, role):
        return SimpleNamespace(role=role)

    def test_champion_tagged_stakeholder_raises_relationship_score(self):
        no_champion = csm_health.compute_health_score(_account(), [], [], [], [])
        with_champion = csm_health.compute_health_score(_account(), [], [], [], [self._stakeholder("Champion")])
        assert with_champion["factors"]["relationship"] > no_champion["factors"]["relationship"]

    def test_non_champion_role_gives_no_bonus(self):
        baseline = csm_health.compute_health_score(_account(), [], [], [], [])
        with_poc = csm_health.compute_health_score(_account(), [], [], [], [self._stakeholder("POC")])
        assert with_poc["factors"]["relationship"] == baseline["factors"]["relationship"]

    def test_departed_champion_penalty_still_wins_over_the_tag_bonus(self):
        """A stakeholder can still be tagged Champion in the portal after the
        deal's ClosingBrief says they left — the departure penalty must not
        be masked by the presence bonus."""
        brief = SimpleNamespace(champion_active=False)
        departed = csm_health.compute_health_score(_account(), [], [], [brief], [self._stakeholder("Champion")])
        no_tag_no_brief = csm_health.compute_health_score(_account(), [], [], [], [])
        assert departed["factors"]["relationship"] < no_tag_no_brief["factors"]["relationship"]

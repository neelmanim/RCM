"""
test_phone_utils.py — Unit tests for the shared phone_utils module.

Covers every input variant documented in the edge case catalogue:
  - strip_extension: all extension formats, no extension, None/empty
  - validate_phone_dialable: valid numbers, all invalid cases
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from typing import Optional
from phone_utils import strip_extension, validate_phone_dialable


# ══════════════════════════════════════════════════════════════════════════════
# 1. strip_extension
# ══════════════════════════════════════════════════════════════════════════════

class TestStripExtension:
    """
    Tests for strip_extension(phone) -> (cleaned, extension_or_None).
    """

    # ── Returns extension found ──────────────────────────────────────────────

    def test_ext_space_digits(self):
        """'+1 800-887-8965 ext 288' — exact prod failure."""
        cleaned, ext = strip_extension("+1 800-887-8965 ext 288")
        assert cleaned == "+1 800-887-8965"
        assert ext == "ext 288"

    def test_ext_no_space(self):
        """'ext288' glued directly."""
        cleaned, ext = strip_extension("+18008878965ext288")
        assert cleaned == "+18008878965"
        assert ext is not None

    def test_ext_dot(self):
        """'ext.288' with dot."""
        cleaned, ext = strip_extension("+18008878965 ext.288")
        assert cleaned == "+18008878965"
        assert ext is not None

    def test_ext_uppercase(self):
        """'EXT 288' — case insensitive."""
        cleaned, ext = strip_extension("+18008878965 EXT 288")
        assert cleaned == "+18008878965"
        assert ext is not None

    def test_x_prefix_with_space(self):
        """' x288' suffix."""
        cleaned, ext = strip_extension("+18008878965 x288")
        assert cleaned == "+18008878965"
        assert ext is not None

    def test_x_prefix_no_space(self):
        """'x288' glued."""
        cleaned, ext = strip_extension("+18008878965x288")
        assert cleaned == "+18008878965"
        assert ext is not None

    def test_hash_extension(self):
        """'#288' suffix."""
        cleaned, ext = strip_extension("+18008878965#288")
        assert cleaned == "+18008878965"
        assert ext is not None

    def test_x_with_space_around_digits(self):
        """' x 288' (space both sides of digits)."""
        cleaned, ext = strip_extension("+18008878965 x 288")
        assert cleaned == "+18008878965"
        assert ext is not None

    # ── Returns no extension ─────────────────────────────────────────────────

    def test_no_extension_e164(self):
        """Clean E.164 — no extension found."""
        cleaned, ext = strip_extension("+919876543210")
        assert cleaned == "+919876543210"
        assert ext is None

    def test_no_extension_bare_digits(self):
        """Bare 10-digit — no extension found."""
        cleaned, ext = strip_extension("9876543210")
        assert cleaned == "9876543210"
        assert ext is None

    # ── Edge: None / empty ───────────────────────────────────────────────────

    def test_none_input(self):
        """None input returns ('', None) — no crash."""
        cleaned, ext = strip_extension(None)
        assert cleaned == ""
        assert ext is None

    def test_empty_string(self):
        """Empty string — no crash, returns ('', None)."""
        cleaned, ext = strip_extension("")
        assert cleaned == ""
        assert ext is None

    def test_whitespace_only(self):
        """Whitespace-only string — stripped, no extension."""
        cleaned, ext = strip_extension("   ")
        # Stripped of leading/trailing whitespace; no ext pattern matched
        assert ext is None

    # ── Extension does not match mid-string ──────────────────────────────────

    def test_ext_in_middle_not_stripped(self):
        """'ext' in the middle of a number is NOT an extension suffix."""
        cleaned, ext = strip_extension("+1800ext2885551234")
        # The regex is anchored to end-of-string, so mid-string 'ext' is ignored
        # unless it's followed only by digits and optional whitespace to end
        # This is an unusual case but should not crash
        assert cleaned is not None


# ══════════════════════════════════════════════════════════════════════════════
# 2. validate_phone_dialable
# ══════════════════════════════════════════════════════════════════════════════

class TestValidatePhoneDialable:
    """
    Tests for validate_phone_dialable(e164, original='') -> Optional[str].

    None return = valid. Non-None return = error message for the user.
    """

    # ── Valid numbers (should return None) ───────────────────────────────────

    def test_valid_us_212(self):
        """+12125551234 — NYC area code 212, valid NANP."""
        assert validate_phone_dialable("+12125551234") is None

    def test_valid_us_800_tollfree(self):
        """+18008878965 — US 800 toll-free; valid NANP (800 starts with 8)."""
        assert validate_phone_dialable("+18008878965") is None

    def test_valid_canada_416(self):
        """+14165551234 — Toronto 416, valid NANP."""
        assert validate_phone_dialable("+14165551234") is None

    def test_valid_india_mobile(self):
        """+919876543210 — valid Indian mobile (starts with 9)."""
        assert validate_phone_dialable("+919876543210") is None

    def test_valid_india_mobile_starts_6(self):
        """+916012345678 — valid Indian mobile (starts with 6)."""
        assert validate_phone_dialable("+916012345678") is None

    def test_valid_uk_mobile(self):
        """+447911123456 — valid UK mobile."""
        assert validate_phone_dialable("+447911123456") is None

    def test_valid_australia(self):
        """+61412345678 — valid Australian mobile."""
        assert validate_phone_dialable("+61412345678") is None

    def test_valid_short_7_digits(self):
        """7-digit number (minimum length) — passes length check."""
        assert validate_phone_dialable("+1234567") is None

    def test_valid_max_15_digits(self):
        """15-digit number (maximum E.164 length) — passes."""
        assert validate_phone_dialable("+" + "1" * 15) is None

    # ── Empty / missing ──────────────────────────────────────────────────────

    def test_none_input(self):
        """None → error (no crash)."""
        err = validate_phone_dialable(None)
        assert err is not None
        assert "international format" in err.lower() or "country code" in err.lower()

    def test_empty_string(self):
        """Empty string → error."""
        err = validate_phone_dialable("")
        assert err is not None

    def test_no_plus_prefix(self):
        """Number without + → error with hint."""
        err = validate_phone_dialable("12125551234", original="12125551234")
        assert err is not None
        assert "international format" in err.lower() or "country code" in err.lower()

    # ── Non-numeric characters ───────────────────────────────────────────────

    def test_non_numeric_after_plus(self):
        """'+1800FLOWERS' — letters after + → error."""
        err = validate_phone_dialable("+1800FLOWERS")
        assert err is not None
        assert "non-numeric" in err.lower()

    def test_dot_in_number(self):
        """+1.212.555.1234 (dots not stripped before validation) → non-numeric."""
        err = validate_phone_dialable("+1.212.555.1234")
        assert err is not None
        assert "non-numeric" in err.lower()

    # ── Length violations ────────────────────────────────────────────────────

    def test_too_short_5_digits(self):
        """5 digits — below 7 minimum."""
        err = validate_phone_dialable("+12345")
        assert err is not None
        assert "digit" in err.lower()

    def test_too_long_16_digits(self):
        """16 digits — exceeds 15 maximum."""
        err = validate_phone_dialable("+1" + "9" * 15)
        assert err is not None
        assert "digit" in err.lower()

    def test_boundary_6_digits_too_short(self):
        """6 digits — one below the minimum of 7."""
        err = validate_phone_dialable("+123456")
        assert err is not None

    def test_boundary_16_digits_too_long(self):
        """16 digits — one above the maximum of 15."""
        err = validate_phone_dialable("+" + "9" * 16)
        assert err is not None

    # ── NANP area code violations ────────────────────────────────────────────

    def test_nanp_area_code_starts_with_1(self):
        """+11860483970 — area code '186' starts with 1 → invalid NANP."""
        err = validate_phone_dialable("+11860483970")
        assert err is not None
        # Should mention the number is not valid or hint at Indian prefix
        assert "not a valid" in err.lower() or "indian" in err.lower() or "service" in err.lower()

    def test_nanp_area_code_starts_with_0(self):
        """+10125551234 — area code '012' starts with 0 → invalid NANP."""
        err = validate_phone_dialable("+10125551234")
        assert err is not None
        assert "area code" in err.lower() or "not a valid" in err.lower()

    def test_nanp_area_code_starts_with_1_message_hints_india(self):
        """When NANP area starts with 1, message should hint at +91 for India."""
        err = validate_phone_dialable("+11234567890")
        assert err is not None
        assert "91" in err

    def test_nanp_short_number_not_caught_by_area_check(self):
        """
        +11234567 is only 8 digits — length check passes (7–15 range),
        and the NANP area code check requires exactly 11 digits so it does NOT apply.
        This number passes all our validation rules (unusual length but within E.164 spec).
        The point: short +1 numbers don't trigger the NANP area code rule.
        """
        # +11234567 = 8 digits — within valid length, NANP check skipped (needs 11 digits)
        err = validate_phone_dialable("+11234567")
        # No error expected — length is valid and NANP rule doesn't apply
        assert err is None


    # ── Indian service numbers mis-stored with +1 ────────────────────────────

    def test_indian_1860_stored_as_us(self):
        """
        +11860483970 = Indian 1860 service number with wrong +1 prefix.
        Checked before generic NANP rule for more specific message.
        """
        err = validate_phone_dialable("+11860483970")
        assert err is not None
        assert "service" in err.lower() or "indian" in err.lower() or "1860" in err.lower() or "indian" in err.lower()

    def test_indian_1800_stored_as_us(self):
        """+11800123456 — Indian 1800 toll-free mis-stored with +1."""
        err = validate_phone_dialable("+11800123456")
        assert err is not None  # caught by either Indian-service or NANP check

    def test_indian_1900_stored_as_us(self):
        """+11900123456 — Indian 1900 service mis-stored with +1."""
        err = validate_phone_dialable("+11900123456")
        assert err is not None

    # ── Indian +91 service/toll-free numbers ────────────────────────────────

    def test_indian_1860_with_correct_91_prefix(self):
        """+911860483970 — 1860 with proper +91 still undiallable (domestic-only)."""
        err = validate_phone_dialable("+911860483970")
        assert err is not None
        assert "service" in err.lower() or "toll-free" in err.lower() or "domestic" in err.lower()

    def test_indian_1800_with_91_prefix(self):
        """+911800123456 — Indian 1800 toll-free with +91 → blocked."""
        err = validate_phone_dialable("+911800123456")
        assert err is not None
        assert "service" in err.lower() or "toll-free" in err.lower()

    def test_indian_1900_with_91_prefix(self):
        """+911900123456 — Indian 1900 service with +91 → blocked."""
        err = validate_phone_dailable = validate_phone_dialable("+911900123456")
        assert err is not None

    def test_indian_valid_mobile_not_blocked(self):
        """+916012345678 — Indian number starting with 6; NOT a service number."""
        assert validate_phone_dialable("+916012345678") is None

    def test_indian_valid_9xx_not_blocked(self):
        """+919876543210 — Indian mobile starting with 9; valid."""
        assert validate_phone_dialable("+919876543210") is None

    # ── original parameter in error messages ────────────────────────────────

    def test_original_shown_in_empty_error(self):
        """When e164 is empty/invalid, the original number appears in the error."""
        err = validate_phone_dialable("", original="+1 800-887-8965 ext 288")
        assert err is not None
        assert "+1 800-887-8965 ext 288" in err

    def test_original_shown_when_no_plus(self):
        """When no + prefix, original number shown in error."""
        err = validate_phone_dialable("9876543210", original="9876543210")
        assert err is not None
        assert "9876543210" in err

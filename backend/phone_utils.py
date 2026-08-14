"""
phone_utils.py — Shared phone number utilities for all dialer providers.

Centralises extension stripping and E.164 dialability validation so both
the Aircall and RCM providers share identical rules without duplication.

Usage:
    from phone_utils import strip_extension, validate_phone_dialable
"""
import re
import logging
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Matches: ' ext 288', 'ext.288', 'ext288', ' x288', ' x 288', '#288'
# Case-insensitive, anchored to end of string.
_EXT_PATTERN = re.compile(r'(?i)\s*(ext\.?\s*|x\s*|#)\d+\s*$')

# Indian domestic-only service number prefixes (not internationally dialable).
# 1800/1860/1900 numbers must be dialed within India only — no E.164 equivalent.
_INDIAN_SERVICE_PREFIXES = frozenset(("1800", "1860", "1900"))


def strip_extension(phone: str) -> Tuple[str, Optional[str]]:
    """
    Strip a phone extension suffix from a number string.

    Returns (cleaned_phone, extension_text) where extension_text is the
    raw extension string found, or None if no extension was present.

    Examples:
        '+1 800-887-8965 ext 288' → ('+1 800-887-8965', 'ext 288')
        '+1 800-887-8965 x288'   → ('+1 800-887-8965', 'x288')
        '+1 800-887-8965 #288'   → ('+1 800-887-8965', '#288')
        '+1 800-887-8965 EXT.288'→ ('+1 800-887-8965', 'EXT.288')
        '+919876543210'          → ('+919876543210', None)
        ''                       → ('', None)
        None                     → ('', None)
    """
    if not phone:
        return (phone or ""), None

    stripped = _EXT_PATTERN.sub('', phone.strip())
    if stripped != phone.strip():
        extension = phone.strip()[len(stripped):].strip()
        return stripped, extension
    return phone, None


def validate_phone_dialable(e164: str, original: str = "") -> Optional[str]:
    """
    Validate an E.164 phone number (+XX...) for international dialability.

    Returns a human-readable error string if the number is invalid or
    undiallable, or None if all checks pass.

    Checks applied (in order):
      1. Not empty / starts with '+'
      2. Digits-only after '+'
      3. Length: 7–15 digits (ITU-T E.164 max)
      4. Indian service numbers mis-stored with +1 prefix (1860/1800/1900)
         — detected before the generic NANP check for a more specific message
      5. NANP (+1): area code (digits 2–4) cannot start with 0 or 1
      6. Indian +91 service/toll-free (1800/1860/1900): domestic-only

    Args:
        e164:     The formatted E.164 string to validate (e.g. '+12125551234').
        original: The original user-entered string before formatting, used in
                  error messages for clarity.

    Returns:
        None if valid. A user-facing error string if invalid.
    """
    # ── 1. Must be non-empty and start with '+' ──────────────────────────────
    if not e164 or not e164.startswith("+"):
        display = original or e164 or "(empty)"
        return (
            f"Phone number '{display}' is not in a valid international format. "
            f"Please update the lead with a number including country code "
            f"(e.g. +1... for US/Canada, +91... for India)."
        )

    digits = e164[1:]  # everything after the '+'

    # ── 2. Digits only ───────────────────────────────────────────────────────
    if not digits.isdigit():
        return (
            f"Phone number '{e164}' contains non-numeric characters. "
            f"Please update the lead's phone number."
        )

    # ── 3. Length: 7–15 digits ───────────────────────────────────────────────
    if len(digits) < 7 or len(digits) > 15:
        return (
            f"Phone number '{e164}' has {len(digits)} digit(s) — "
            f"valid numbers are 7–15 digits. Please update the lead's phone number."
        )

    # ── 4. Indian service numbers mis-stored with +1 prefix ─────────────────
    # e.g. '1860483970' (10 digits) → _format_e164 maps to '+11860483970'
    # The subscriber part (after country code '1') starts with 1860/1800/1900.
    # Checked BEFORE the generic NANP rule to give a more specific message.
    if e164.startswith("+1") and len(digits) == 11:
        subscriber = digits[1:]  # digits after the country code digit
        if subscriber[:4] in _INDIAN_SERVICE_PREFIXES:
            return (
                f"'{e164}' looks like an Indian service number (1860/1800) "
                f"that was saved with a US country code. This number cannot be "
                f"dialed internationally. Please update the lead's phone number "
                f"with a direct mobile number."
            )

    # ── 5. NANP (+1): area code cannot start with 0 or 1 ───────────────────
    # US/Canada numbers are 11 digits total (+1 + 10 NANP digits).
    # Area code = digits 2–4 (index 1:4 after stripping the '+').
    if e164.startswith("+1") and len(digits) == 11:
        area_code = digits[1:4]
        if area_code[0] in "01":
            return (
                f"'{e164}' is not a valid US/Canada number — "
                f"area code '{area_code}' cannot start with '{area_code[0]}'. "
                f"Please check the lead's phone number. "
                f"If this is an Indian number, it needs a +91 country code instead."
            )

    # ── 6. Indian +91 service/toll-free numbers (domestic-only) ─────────────
    # +91 numbers are 12 digits total (country code 91 + 10 local digits).
    # 1800/1860/1900 prefixes are India-internal only; cannot be dialed via API.
    if e164.startswith("+91") and len(digits) == 12:
        local = digits[2:]  # strip country code '91'
        if local[:4] in _INDIAN_SERVICE_PREFIXES:
            return (
                f"'{e164}' is an Indian service/toll-free number and cannot "
                f"be dialed internationally via the dialer. "
                f"Please contact this lead on a direct mobile number."
            )

    return None  # all checks passed

"""
sms_service.py
─────────────────────────
Thin wrapper around the Alternate Messenger Messaging API v2 send endpoint.
Uses only the Python standard library (urllib) — zero new dependencies.

API ref: https://docs.alternatecrm.com/6PuY9sqj0B8-developer-guide
Endpoint: POST https://api.alternatecrm.com/api/v2/message/send
"""

import json
import logging
import uuid
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.alternatecrm.com"
_SEND_PATH = "/api/v2/message/send"


def send_sms(api_key: str, from_number: str, to_number: str, message: str) -> dict:
    """
    Send an outbound SMS via the Alternate Messenger Messaging API.

    Args:
        api_key:     Alternate Messenger API key (stored in SyncSettings.messenger_api_key)
        from_number: E.164 sender number (SyncSettings.messenger_from_number)
        to_number:   E.164 recipient number (lead.phone)
        message:     Plain-text message body

    Returns:
        {"success": True, "message_id": "alternatecrm-<uuid>"} on success
        {"success": False, "error": "<reason>"}              on failure
    """
    message_id = f"alternatecrm-{uuid.uuid4().hex[:12]}"

    payload = {
        "userPayload": {
            "type": "api",
            "apiKey": api_key,
        },
        "messageDetails": [
            {
                "source": "8001",
                "messageId": message_id,
                "sender": {
                    "phone": from_number,
                    "channelType": "SMS",
                },
                "recipient": [
                    {
                        "phone": to_number,
                        "channelType": "SMS",
                    }
                ],
                "message": {
                    "type": "text",
                    "content": {
                        "messageText": message,
                    },
                },
            }
        ],
    }

    encoded = json.dumps(payload).encode("utf-8")
    url = f"{_BASE_URL}{_SEND_PATH}"

    req = urllib.request.Request(
        url,
        data=encoded,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))

        # API returns {"response": {"vstatus": "success"|"failed", "responseText": "..."}}
        response_block = body.get("response", {})
        vstatus = response_block.get("vstatus", "")
        response_text = response_block.get("responseText", "")

        if vstatus == "success":
            logger.info("[SMS] Sent %s → %s (%s)", from_number, to_number, message_id)
            return {"success": True, "message_id": message_id, "response_text": response_text}
        else:
            logger.warning("[SMS] Send failed for %s: %s", to_number, response_text)
            return {"success": False, "error": response_text or "Alternate Messenger returned failed status"}

    except urllib.error.HTTPError as exc:
        logger.error("[SMS] HTTP %s from Alternate Messenger API: %s", exc.code, exc.reason)
        return {"success": False, "error": f"HTTP {exc.code}: {exc.reason}"}
    except urllib.error.URLError as exc:
        logger.error("[SMS] Network error reaching Alternate Messenger API: %s", exc.reason)
        return {"success": False, "error": f"Network error: {exc.reason}"}
    except Exception as exc:
        logger.exception("[SMS] Unexpected error sending SMS")
        return {"success": False, "error": str(exc)}

# ── messaging_sync.py — inbound message reconciliation ──────────────────────
"""
RCM Built-in Messaging's Converse Desk API has no push webhook for inbound
messages (unlike calls, unlike email/Nylas) — the only way to learn about a
lead's reply is to poll. This mirrors the existing nightly-sync pattern
(dialer_service.sync_historical_calls) one layer over: periodically list
recent conversations, and for any with a fresh inbound message, persist it
to the same sms_logs table the Widget's outbound sends and Cadence sends
already write to — so a reply shows up in the Activity feed same as a send.

Goes through the provider-agnostic MessagingProvider (messaging_service.py)
rather than importing RCM directly, so a second provider's inbound
messages land in the same place with no changes here.
"""
import logging

import models
from dialer_service import _find_lead_by_phone
from messaging_service import get_messaging_provider_for_org

logger = logging.getLogger(__name__)


def sync_recent_conversations(db, count: int = 100) -> dict:
    """
    Poll the active messaging provider for recent conversations, and persist
    any inbound message not already in sms_logs.

    Only conversations whose last message was inbound are fetched in full —
    a conversation that's all-outbound-so-far has nothing new to find, and
    fetching every thread on every tick would be a lot of API calls for no
    benefit.
    """
    stats = {
        "conversations_checked": 0,
        "conversations_with_inbound": 0,
        "messages_inserted": 0,
        "messages_already_logged": 0,
        "unmatched_phone": 0,
    }

    provider = get_messaging_provider_for_org(db)
    if provider is None:
        return stats

    conversations = provider.list_recent_conversations(count=count)
    stats["conversations_checked"] = len(conversations)

    for conv in conversations:
        if conv.last_message_direction != "inbound":
            continue
        stats["conversations_with_inbound"] += 1

        lead = _find_lead_by_phone(db, conv.phone_number)
        if lead is None:
            stats["unmatched_phone"] += 1
            continue

        try:
            messages = provider.get_inbound_messages(conv.conversation_id)
        except Exception as e:
            logger.warning("[MessagingSync] Failed to fetch thread %s: %s", conv.conversation_id, e)
            continue

        for msg in messages:
            already_logged = db.query(models.SmsLog).filter(
                models.SmsLog.message_id == msg.provider_message_id,
                models.SmsLog.direction == "inbound",
            ).first()
            if already_logged:
                stats["messages_already_logged"] += 1
                continue

            db.add(models.SmsLog(
                message_id=msg.provider_message_id,
                lead_id=lead.id,
                direction="inbound",
                status="received",
                phone_number=msg.phone_number,
                message_text=msg.text,
                channel=msg.channel,
                provider=provider.provider_name,
                conversation_id=conv.conversation_id,
            ))
            stats["messages_inserted"] += 1

    db.commit()
    logger.info("[MessagingSync] %s", stats)
    return stats

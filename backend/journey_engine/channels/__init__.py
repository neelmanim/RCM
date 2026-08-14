from .base import ChannelProvider, SendResult
from .email_channel import EmailChannelProvider
from .call_channel import CallChannelProvider
from .sms_channel import SMSChannelProvider
from .whatsapp_channel import WhatsAppChannelProvider

# Phase 5 (deferred): "linkedin", once a unification vendor is chosen.
_PROVIDERS = {
    "email": EmailChannelProvider,
    "call": CallChannelProvider,
    "sms": SMSChannelProvider,
    "whatsapp": WhatsAppChannelProvider,
}


def get_channel_provider(channel_name: str) -> ChannelProvider:
    cls = _PROVIDERS.get(channel_name)
    if cls is None:
        raise ValueError(f"Unknown or not-yet-implemented channel: {channel_name}")
    return cls()

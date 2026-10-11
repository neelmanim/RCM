from .base import ChannelProvider, SendResult
from .email_channel import EmailChannelProvider
from .call_channel import CallChannelProvider
from .sms_channel import SMSChannelProvider
from .whatsapp_channel import WhatsAppChannelProvider
from .task_channel import TaskChannelProvider

# LinkedIn is a manual "task" step (task_kind linkedin_*) — automated
# sending would need a third-party vendor (docs/SALES_JOURNEY_ARCHITECTURE.md).
_PROVIDERS = {
    "email": EmailChannelProvider,
    "call": CallChannelProvider,
    "sms": SMSChannelProvider,
    "whatsapp": WhatsAppChannelProvider,
    "task": TaskChannelProvider,
}


def get_channel_provider(channel_name: str) -> ChannelProvider:
    cls = _PROVIDERS.get(channel_name)
    if cls is None:
        raise ValueError(f"Unknown or not-yet-implemented channel: {channel_name}")
    return cls()

from dialer_provider import DialerProvider, NormalizedCallEvent

class RCMDialerProvider(DialerProvider):
    def __init__(self, **kwargs):
        self.provider_name = "rcm"
        for k, v in kwargs.items():
            setattr(self, k, v)
            
    def initiate_call(self, phone_number: str, user_email: str, lead_id: str, **kwargs):
        class Result:
            success = False
            provider_call_id = None
            error = "RCM Dialer not implemented"
            livekit_token = None
            livekit_url = None
            room_name = None
            agent_join_via_phone = None
        return Result()

    def handle_webhook(self, payload: dict):
        return None
        
class RCMProvider:
    pass

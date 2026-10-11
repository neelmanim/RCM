"""
Google OAuth helpers for authentication.
"""
import httpx
from config import settings

GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v3/userinfo"


def google_auth_url(state: str = "") -> str:
    """Build the Google OAuth consent screen URL."""
    params = {
        "client_id":     settings.GOOGLE_CLIENT_ID,
        "redirect_uri":  settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "offline",
        "state":         state,
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{GOOGLE_AUTH_URL}?{query}"


async def exchange_code_for_user(code: str) -> dict:
    """Exchange the OAuth code for user info from Google."""
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri":  settings.GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        token_resp.raise_for_status()
        tokens = token_resp.json()

        info_resp = await client.get(GOOGLE_USERINFO, headers={
            "Authorization": f"Bearer {tokens['access_token']}"
        })
        info_resp.raise_for_status()
        return info_resp.json()

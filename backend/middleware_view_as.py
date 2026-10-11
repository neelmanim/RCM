"""A Pod Admin's "View As" token is read-only: it can look at a rep's screens but every write (POST/PUT/PATCH/DELETE)
is refused, so nothing a Pod Admin clicks is ever credited to the rep. Pure ASGI so streaming (SSE) is untouched."""
import json

from auth import decode_jwt

_READ = {"GET", "HEAD", "OPTIONS"}


class ViewAsReadOnlyMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] not in _READ:
            auth = dict(scope["headers"]).get(b"authorization", b"").decode()
            if auth.lower().startswith("bearer "):
                try:
                    read_only = decode_jwt(auth[7:]).get("view_as_read_only")
                except Exception:
                    read_only = False
                if read_only:
                    body = json.dumps({"detail": "You are viewing as another person — this view is read-only."}).encode()
                    await send({"type": "http.response.start", "status": 403,
                                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
                    await send({"type": "http.response.body", "body": body})
                    return
        await self.app(scope, receive, send)

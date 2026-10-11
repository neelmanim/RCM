"""
middleware_cache_headers.py — HTTP Cache-Control headers for cacheable GET endpoints.

Uses stale-while-revalidate (SWR) pattern: browser serves stale data instantly
and refreshes in the background. This makes repeat page navigations feel instant
(0ms) for the user.

NOTE: Only applied to GET requests. POST/PATCH/DELETE always get no-cache.
NOTE: Only applied to API endpoints that return relatively stable data.
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# Streaming SSE route both this middleware and main.py's gzip middleware must
# bypass (BaseHTTPMiddleware/GZipMiddleware buffer streamed chunks in ways
# that break or delay SSE delivery). Shared so the two bypass checks can't
# drift out of sync if the route ever changes.
SSE_EVENTS_PATH = "/api/calls/events"

# ── Cache policies per endpoint prefix ───────────────────────────────────────
# (max_age, stale_while_revalidate) in seconds.
# max_age: browser will NOT make a request for this duration.
# swr: after max_age expires, browser serves stale AND fetches fresh in background.
CACHE_POLICIES = {
    "/api/leaderboard":          (30, 120),   # Aggregated data
    "/api/leads/dashboard-stats": (15, 60),   # Status counts
    "/api/leads/activity-feed":  (10, 30),    # Activity feed
    "/api/leads/my":             (10, 30),    # Per-SDR lead list
    "/api/leads":                (10, 30),    # Admin lead list (but not /leads/{id})
}

# Settings screens re-read these right after every change, so the browser must never answer from its own copy (RCA 2026-10-10: the
# Users list used to carry max-age=30 + stale-while-revalidate=120, so a switch the admin had just changed showed its OLD value
# until a hard refresh - the server's own cache was never the whole story). Exact paths; the server still caches for 120s.
NO_STORE_PATHS = ("/api/admin/users",)

# Endpoints that should NEVER be cached (mutations, auth, real-time)
NO_CACHE_PREFIXES = (
    "/api/auth",
    "/api/webhooks",
    "/api/dialer/initiate",
    "/api/monitoring",
    "/api/health",
)


class CacheHeaderMiddleware(BaseHTTPMiddleware):
    async def __call__(self, scope, receive, send):
        # RCA 2026-08-19: same BaseHTTPMiddleware + StreamingResponse +
        # client-disconnect crash as middleware/timing.py — see that file's
        # comment. This middleware has no existing skip-list, but the only
        # streaming route today is the SSE endpoint, so exclude it by path.
        if scope.get("type") == "http" and scope.get("path", "") == SSE_EVENTS_PATH:
            return await self.app(scope, receive, send)
        return await super().__call__(scope, receive, send)

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Only cache GET requests with 200 status
        if request.method != "GET" or response.status_code != 200:
            return response

        path = request.url.path

        # Skip no-cache endpoints
        if any(path.startswith(p) for p in NO_CACHE_PREFIXES):
            return response

        if path in NO_STORE_PATHS:
            response.headers["Cache-Control"] = "no-store"
            return response

        # Apply matching cache policy
        for prefix, (max_age, swr) in CACHE_POLICIES.items():
            if path.startswith(prefix):
                # Don't cache detail endpoints like /api/leads/{uuid}
                # Only cache exact matches or query-string variations
                remaining = path[len(prefix):]
                if remaining == "" or remaining.startswith("?"):
                    response.headers["Cache-Control"] = (
                        f"private, max-age={max_age}, "
                        f"stale-while-revalidate={swr}"
                    )
                    # Vary by Authorization so different users get their own cache
                    response.headers["Vary"] = "Authorization"
                    return response

        return response

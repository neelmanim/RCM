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

# ── Cache policies per endpoint prefix ───────────────────────────────────────
# (max_age, stale_while_revalidate) in seconds.
# max_age: browser will NOT make a request for this duration.
# swr: after max_age expires, browser serves stale AND fetches fresh in background.
CACHE_POLICIES = {
    "/api/admin/users":          (30, 120),   # User list — changes rarely
    "/api/leaderboard":          (30, 120),   # Aggregated data
    "/api/leads/dashboard-stats": (15, 60),   # Status counts
    "/api/leads/activity-feed":  (10, 30),    # Activity feed
    "/api/leads/my":             (10, 30),    # Per-SDR lead list
    "/api/leads":                (10, 30),    # Admin lead list (but not /leads/{id})
}

# Endpoints that should NEVER be cached (mutations, auth, real-time)
NO_CACHE_PREFIXES = (
    "/api/auth",
    "/api/webhooks",
    "/api/dialer/initiate",
    "/api/monitoring",
    "/api/health",
)


class CacheHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Only cache GET requests with 200 status
        if request.method != "GET" or response.status_code != 200:
            return response

        path = request.url.path

        # Skip no-cache endpoints
        if any(path.startswith(p) for p in NO_CACHE_PREFIXES):
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

# Production Image for Alternate Messenger CRM
FROM python:3.9-slim

WORKDIR /app

# Install system utilities + Postgres driver dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Copy and install Python requirements
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend and frontend source
COPY backend/ ./backend
COPY frontend/ ./frontend

# Change workdir to backend for execution
WORKDIR /app/backend

# Standard port for Render/Heroku (overridable via ENV)
ENV PORT=10000
# Staging OOM RCA 2026-10-06: measured on staging, most of the scheduler
# worker's climb was heap Python had already freed but glibc kept (a
# malloc_trim gave back 23 of 39 MB). Fewer per-thread malloc arenas keeps
# that from fanning out across every thread that ever ran.
ENV MALLOC_ARENA_MAX=2
EXPOSE 10000

# RCA 2026-10-01: single worker meant one request blocked on a slow external
# call (Upstash, an AI call, anything) consumed 100% of the app's capacity —
# every other request, even unrelated ones hitting only the (idle) database,
# queued behind it. The original single-worker reasoning ("multi-worker would
# isolate the in-process TTL cache per process = cache misses on every
# request") predates cache.py's Redis/Upstash layer, which is already shared
# across workers — so that reasoning no longer holds. 2 workers, not more:
# DB pool_size=8+max_overflow=15 per worker (database.py) already uses ~60%
# of Postgres's 103-connection ceiling at 2 workers; go higher only alongside
# shrinking the per-worker pool size. journey_engine's tick() already claims
# work via SELECT...FOR UPDATE SKIP LOCKED (engine.py), so running it from
# both workers is safe — no duplicate sends.
CMD uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2 --proxy-headers --forwarded-allow-ips='*'



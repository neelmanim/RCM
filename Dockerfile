# Production Image for Conversive CRM
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
EXPOSE 10000

# Run uvicorn with proxy headers and forwarded IPs enabled for production
# Single worker: in-process TTL cache (cache.py) is shared across all requests.
# Multi-worker would isolate memory per process = cache misses on every request.
# For a small CRM (~10 concurrent users), 1 worker + cache >> 4 workers + no cache.
# Single worker: in-process TTL cache shared across all requests (no Redis needed).
CMD uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'


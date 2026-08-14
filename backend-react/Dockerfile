# Production Image for Conversive CRM (React Backend)
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
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Create uploads directory for file attachments
RUN mkdir -p uploads/lead_attachments

# Standard port for Render/Heroku (overridable via ENV)
ENV PORT=10000
EXPOSE 10000

# Run uvicorn with proxy headers and forwarded IPs enabled for production
CMD uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'

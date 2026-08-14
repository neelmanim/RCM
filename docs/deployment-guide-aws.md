# RCM CRM — AWS Deployment Guide

> **Version:** 4.5.0 | **Date:** April 7, 2026 | **Author:** Engineering Team
> **Repository:** https://github.com/neelmanimishrasf/crmalternate.git

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [System Requirements](#2-system-requirements)
3. [Repository Structure](#3-repository-structure)
4. [Environment Variables](#4-environment-variables)
5. [Docker Deployment](#5-docker-deployment)
6. [AWS Infrastructure Setup](#6-aws-infrastructure-setup)
7. [Database Setup (PostgreSQL)](#7-database-setup-postgresql)
8. [Google OAuth Setup](#8-google-oauth-setup)
9. [DNS & SSL](#9-dns--ssl)
10. [Health Checks & Monitoring](#10-health-checks--monitoring)
11. [CI/CD Pipeline](#11-cicd-pipeline)
12. [Integrations (Optional)](#12-integrations-optional)
13. [Backup & Disaster Recovery](#13-backup--disaster-recovery)
14. [Troubleshooting](#14-troubleshooting)
15. [Security Checklist](#15-security-checklist)

---

## 1. Architecture Overview

RCM is a **monolithic Python web application** serving both the API and frontend from a single container.

```
┌──────────────────────────────────────────────────────────────┐
│                      Docker Container                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   Uvicorn (ASGI)                       │  │
│  │                   Port: 10000                          │  │
│  │                                                        │  │
│  │  ┌──────────────────┐  ┌────────────────────────────┐  │  │
│  │  │   FastAPI App    │  │   Static Files (frontend/) │  │  │
│  │  │   /api/*         │  │   /frontend/*              │  │  │
│  │  └──────────────────┘  └────────────────────────────┘  │  │
│  │                                                        │  │
│  │  Background Threads:                                   │  │
│  │  • SF Health Check (30min)                             │  │
│  │  • Daily Aggregation (24h)                             │  │
│  │  • Log Cleanup (24h)                                   │  │
│  │  • Keep-Alive Ping (10min)                             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│                   PostgreSQL (RDS)                            │
│                   Engine: PostgreSQL 14+                      │
└──────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend API** | Python 3.10 / FastAPI / Uvicorn | REST API, OAuth, business logic |
| **Frontend** | Vanilla HTML/CSS/JS | SPA served as static files via FastAPI |
| **Database** | PostgreSQL 14+ | Primary data store (SQLAlchemy ORM) |
| **Auth** | Google OAuth 2.0 + JWT | SSO login, 8-hour token expiry |
| **Encryption** | AES-256-GCM | Stored credentials (SF, Nylas, Aircall) |
| **Background Jobs** | Python `threading.Timer` | SF health check, metrics aggregation |

### Request Flow

```
Browser → ALB/CloudFront → ECS/EC2 (port 10000) → FastAPI → PostgreSQL
                                                  ↗ Static /frontend/*
```

---

## 2. System Requirements

### Minimum Instance Specifications

| Tier | Instance Type | vCPU | Memory | Use Case |
|------|---------------|------|--------|----------|
| **Staging** | `t3.small` | 2 | 2 GB | Testing, QA |
| **Production** | `t3.medium` | 2 | 4 GB | Up to 50 concurrent users |
| **Production (scaled)** | `t3.large` | 2 | 8 GB | 50-200 concurrent users |

### Software Dependencies

| Dependency | Version | Notes |
|-----------|---------|-------|
| Python | 3.10.x | Specified in `backend/runtime.txt` |
| PostgreSQL | 14+ | AWS RDS recommended |
| Docker | 20.10+ | Container runtime |
| gcc, libpq-dev | System | For `psycopg2-binary` compilation |

### Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| **10000** | HTTP | Application (configurable via `PORT` env var) |
| **5432** | TCP | PostgreSQL database |
| **443** | HTTPS | External access via ALB (recommended) |

---

## 3. Repository Structure

```
crmalternate/
├── Dockerfile                  # Production Docker image
├── .dockerignore               # Docker build exclusions
├── render.yaml                 # Render.com config (reference only)
├── package.json                # E2E testing (Playwright) — not needed for deployment
│
├── backend/
│   ├── main.py                 # ⭐ App entrypoint
│   ├── database.py             # SQLAlchemy engine + session factory
│   ├── models.py               # All ORM models (20+ tables)
│   ├── migrations.py           # Idempotent schema migrations (runs on startup)
│   ├── auth.py                 # JWT + Google OAuth helpers
│   ├── crypto.py               # AES-256-GCM encryption for stored secrets
│   ├── salesforce.py           # SF API integration
│   ├── audience_manager.py     # RCM Built-in Messaging contact sync
│   ├── scheduled_jobs.py       # Background timer-based jobs
│   ├── activity_logger.py      # User activity audit logging
│   ├── requirements.txt        # Python dependencies
│   ├── runtime.txt             # Python version: 3.10.13
│   ├── .env.example            # Environment variable template
│   └── routes/                 # 17 route modules (auth, leads, admin, email, etc.)
│
└── frontend/
    ├── index.html              # Main application (post-login)
    ├── login.html              # Login page with Google SSO
    ├── css/style.css           # Application styles
    ├── js/                     # Client-side JavaScript modules
    │   ├── app.js              # Main app controller
    │   ├── api.js              # API client
    │   ├── auth.js             # Token management
    │   └── views/              # UI view modules
    └── assets/                 # Static assets (logos, icons)
```

---

## 4. Environment Variables

### Required (App will not start without these)

| Variable | Description | Example | Generate Command |
|----------|-------------|---------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname` | — |
| `JWT_SECRET` | HMAC signing key for JWT tokens (min 48 chars) | `kR9x...random` | `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | `123456.apps.googleusercontent.com` | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret | `GOCSPX-abcdef...` | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `https://crm.yourcompany.com/api/auth/callback` | Must match Google Console |

### Required for integrations (Optional for initial setup)

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ENCRYPTION_KEY` | AES-256 key for credential storage (base64-encoded 32-byte) | *None* — required when using Salesforce/Nylas/Aircall integrations |

> **Generate with:** `python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`

### Optional (with defaults)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `10000` |
| `ALLOW_DEMO` | Enable demo login (bypass SSO) — **never** in production | `false` |
| `SF_DOMAIN` | Salesforce login domain | `login` |
| `SF_USERNAME` | Salesforce API username | *None* |
| `SF_PASSWORD` | Salesforce API password | *None* |
| `SF_SECURITY_TOKEN` | Salesforce security token | *None* |
| `SF_LEAD_LIMIT` | Max leads to sync from Salesforce | `1000` |
| `SF_HEALTH_CHECK_INTERVAL_MINUTES` | SF connection check interval | `30` |
| `ACTIVITY_LOG_RETENTION_DAYS` | Days to keep raw activity logs | `90` |
| `RENDER_EXTERNAL_URL` | Used for keep-alive self-ping. Set to app's public URL | *None* |

> [!IMPORTANT]
> **`ALLOW_DEMO` must be `false` in production.** Setting it to `true` allows unauthenticated login via `/api/auth/demo`.

> [!WARNING]
> **`JWT_SECRET` and `APP_ENCRYPTION_KEY` must be consistent across deployments.** Changing `JWT_SECRET` invalidates all active user sessions. Changing `APP_ENCRYPTION_KEY` makes all stored credentials (SF, Nylas, Aircall) unreadable — you'd need to re-enter them.

---

## 5. Docker Deployment

### Dockerfile (already in repo)

```dockerfile
FROM python:3.9-slim
WORKDIR /app

RUN apt-get update && apt-get install -y \
    postgresql-client \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend
COPY frontend/ ./frontend

WORKDIR /app/backend

ENV PORT=10000
EXPOSE 10000

CMD uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
```

### Build & Test Locally

```bash
# Build image
docker build -t rcm-crm:latest .

# Run with env file
docker run -d \
  --name rcm \
  -p 10000:10000 \
  --env-file backend/.env \
  rcm-crm:latest

# Verify health
curl http://localhost:10000/api/health
# Expected: {"status":"ok"}

# Check logs
docker logs -f rcm
```

### Push to ECR

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-2 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com

# Tag and push
docker tag rcm-crm:latest <ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com/rcm-crm:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com/rcm-crm:latest
```

---

## 6. AWS Infrastructure Setup

### Option A: ECS Fargate (Recommended)

```
                    Internet
                       │
                ┌──────┴───────┐
                │     ALB      │ (HTTPS:443 → Target:10000)
                └──────┬───────┘
                       │
              ┌────────┴────────┐
              │   ECS Fargate   │
              │   Task (1-2x)   │
              │   Port: 10000   │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │    RDS Postgres  │
              │    (Private SN)  │
              └─────────────────┘
```

#### ECS Task Definition

```json
{
  "family": "rcm-crm",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "rcm",
      "image": "<ACCOUNT_ID>.dkr.ecr.us-east-2.amazonaws.com/rcm-crm:latest",
      "portMappings": [
        {
          "containerPort": 10000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "PORT", "value": "10000" },
        { "name": "ALLOW_DEMO", "value": "false" }
      ],
      "secrets": [
        { "name": "DATABASE_URL", "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/rcm/DATABASE_URL" },
        { "name": "JWT_SECRET", "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/rcm/JWT_SECRET" },
        { "name": "GOOGLE_CLIENT_ID", "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/rcm/GOOGLE_CLIENT_ID" },
        { "name": "GOOGLE_CLIENT_SECRET", "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/rcm/GOOGLE_CLIENT_SECRET" },
        { "name": "GOOGLE_REDIRECT_URI", "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/rcm/GOOGLE_REDIRECT_URI" },
        { "name": "APP_ENCRYPTION_KEY", "valueFrom": "arn:aws:ssm:REGION:ACCOUNT:parameter/rcm/APP_ENCRYPTION_KEY" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/rcm-crm",
          "awslogs-region": "us-east-2",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:10000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

#### ALB Configuration

| Setting | Value |
|---------|-------|
| Listener | HTTPS:443 → Target Group (port 10000) |
| Health Check Path | `/api/health` |
| Health Check Interval | 30 seconds |
| Healthy Threshold | 2 |
| Unhealthy Threshold | 3 |
| Deregistration Delay | 60 seconds |
| Stickiness | Not required (JWT-based, stateless) |

### Option B: EC2 Directly

```bash
# On EC2 instance (Amazon Linux 2023 or Ubuntu 22.04)
sudo yum install -y docker git
sudo systemctl enable docker && sudo systemctl start docker

# Clone and build
git clone https://github.com/neelmanimishrasf/crmalternate.git
cd crmalternate
docker build -t rcm-crm:latest .

# Create env file
cat > .env << 'EOF'
DATABASE_URL=postgresql://user:password@your-rds-endpoint:5432/rcm
JWT_SECRET=<generated-secret>
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=https://crm.yourcompany.com/api/auth/callback
APP_ENCRYPTION_KEY=<generated-key>
PORT=10000
ALLOW_DEMO=false
EOF

# Run
docker run -d \
  --name rcm \
  --restart unless-stopped \
  -p 10000:10000 \
  --env-file .env \
  rcm-crm:latest
```

---

## 7. Database Setup (PostgreSQL)

### RDS Configuration

| Setting | Recommended Value |
|---------|-------------------|
| Engine | PostgreSQL 14.x or 15.x |
| Instance | `db.t3.micro` (staging) / `db.t3.small` (prod) |
| Storage | 20 GB gp3 (auto-scaling enabled) |
| Multi-AZ | No (staging) / Yes (production) |
| Backup Retention | 7 days |
| Public Access | **No** (private subnet, accessed via VPC) |
| Security Group | Allow inbound 5432 from ECS/EC2 SG only |

### Database Initialization

```bash
# Create database
psql -h <RDS_ENDPOINT> -U postgres -c "CREATE DATABASE rcm;"
psql -h <RDS_ENDPOINT> -U postgres -c "CREATE USER rcm_user WITH PASSWORD '<STRONG_PASSWORD>';"
psql -h <RDS_ENDPOINT> -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE rcm TO rcm_user;"
```

> [!NOTE]
> **No manual migrations needed.** The application automatically creates all tables and runs schema migrations on startup via `models.Base.metadata.create_all()` and `migrations.run_schema_migrations()`. These are fully idempotent — safe to run on every deployment.

### Connection String Format

```
postgresql://rcm_user:<PASSWORD>@<RDS_ENDPOINT>:5432/rcm
```

### Database Schema (Auto-created — 20+ tables)

| Table | Purpose |
|-------|---------|
| `users` | CRM users (SDR, Pod Admin, Super Admin) |
| `allowed_users` | Access control whitelist |
| `leads` | Lead records (40+ fields) |
| `lead_assignments` | Many-to-many user↔lead mapping |
| `call_logs` | Manual call logs |
| `lead_notes` | Notes on leads |
| `lead_tasks` | Tasks assigned to leads |
| `lead_status_logs` | Status change audit trail |
| `pods` | POD team definitions |
| `sync_settings` | Global system settings (SF, Nylas, Dialer, etc.) |
| `salesforce_connections` | Encrypted SF credentials |
| `salesforce_integration_logs` | SF sync audit logs |
| `nylas_config` | Encrypted Nylas API config |
| `user_mailboxes` | Connected email accounts |
| `lead_email_activity` | Email activity history |
| `email_threads` | Nylas thread→lead mapping |
| `dialer_calls` | Dialer call records |
| `login_logs` | Login audit trail with session tracking |
| `user_activity_logs` | Granular activity logging |
| `user_activity_daily_summary` | Pre-aggregated daily metrics |
| `feedback` | User feedback submissions |
| `lead_upload_logs` | CSV/GSheet import audit logs |
| `company_research` | AI research cache |

---

## 8. Google OAuth Setup

### Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Set **Authorized Redirect URI**:

| Environment | Redirect URI |
|-------------|-------------|
| Production | `https://crm.yourcompany.com/api/auth/callback` |
| Staging | `https://staging-crm.yourcompany.com/api/auth/callback` |

4. Enable the **Google People API** (or at minimum the OpenID Connect scope — `openid email profile`)

> [!IMPORTANT]
> The redirect URI in Google Console **must exactly match** the `GOOGLE_REDIRECT_URI` environment variable. Any mismatch (including trailing slashes or http vs https) will cause OAuth failures.

### OAuth Scopes Used

```
openid email profile
```

### Login Flow

```
1. User clicks "Continue with Google" → redirects to Google
2. Google authenticates → redirects to /api/auth/callback?code=...
3. Backend exchanges code for user info → creates/updates User record
4. Backend issues JWT (8h expiry) → redirects to /frontend/login.html?token=...
5. Frontend stores JWT in localStorage → uses Bearer token for all API calls
```

---

## 9. DNS & SSL

### ALB + ACM (Recommended)

1. Request certificate in **AWS Certificate Manager** for `crm.yourcompany.com`
2. Validate via DNS (CNAME record)
3. Attach certificate to ALB HTTPS:443 listener
4. Create Route 53 A record (Alias) pointing `crm.yourcompany.com` → ALB DNS

### Important: Proxy Headers

The Dockerfile CMD already includes `--proxy-headers --forwarded-allow-ips='*'` for Uvicorn, which ensures the app correctly reads `X-Forwarded-For` headers behind ALB.

---

## 10. Health Checks & Monitoring

### Health Endpoint

```
GET /api/health → {"status": "ok"}
```

This is the primary health check endpoint. Use it for:
- ALB target group health checks
- ECS task health checks
- External uptime monitoring

### Background Jobs (built-in)

| Job | Interval | Purpose |
|-----|----------|---------|
| SF Health Check | 30 min | Validates Salesforce connection |
| Daily Aggregation | 24h | Aggregates activity logs into daily summaries |
| Log Cleanup | 24h | Deletes raw activity logs older than 90 days |
| Keep-Alive Ping | 10 min | Self-pings to prevent idle shutdown |

> **Note:** The keep-alive ping requires `RENDER_EXTERNAL_URL` to be set. On AWS, this can be left unset (or set to your ALB URL) — it's only critical on platforms that auto-sleep (like Render free tier).

### Recommended CloudWatch Alarms

| Metric | Threshold | Action |
|--------|-----------|--------|
| ALB 5xx errors | > 5 in 5 min | Notify |
| ECS CPU utilization | > 80% for 5 min | Scale up |
| ECS Memory utilization | > 80% for 5 min | Scale up |
| RDS CPU | > 80% for 10 min | Notify |
| RDS Free Storage | < 2 GB | Notify |
| RDS Connection Count | > 80% max | Notify |

---

## 11. CI/CD Pipeline

### Branch Strategy (Current)

| Branch | Purpose | Deploys To |
|--------|---------|------------|
| `develop` | Active development | Staging |
| `main` | Production releases | Production |

### Deployment Workflow

```
Developer → push to develop → Staging auto-deploy → QA test
         → merge develop → main → Production auto-deploy
```

### Sample GitHub Actions (for AWS)

```yaml
# .github/workflows/deploy.yml
name: Deploy to AWS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-2

      - name: Login to ECR
        id: ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/rcm-crm:$IMAGE_TAG .
          docker build -t $ECR_REGISTRY/rcm-crm:latest .
          docker push $ECR_REGISTRY/rcm-crm:$IMAGE_TAG
          docker push $ECR_REGISTRY/rcm-crm:latest

      - name: Update ECS Service
        run: |
          aws ecs update-service \
            --cluster rcm-cluster \
            --service rcm-service \
            --force-new-deployment
```

---

## 12. Integrations (Optional)

These integrations are **configured via the Admin UI** at runtime and stored in the database. No extra infrastructure is needed, but the relevant external services must be reachable.

### Salesforce CRM

| Item | Details |
|------|---------|
| Purpose | Bi-directional lead sync |
| Config | Admin connects via UI: Settings → Salesforce → Connect |
| Credentials | Stored AES-256-GCM encrypted in `salesforce_connections` table |
| Requires | `APP_ENCRYPTION_KEY` env var |
| Outbound | HTTPS to `login.salesforce.com` / `test.salesforce.com` |

### Nylas Email Integration

| Item | Details |
|------|---------|
| Purpose | Email sync, send, and open tracking |
| Config | Admin connects via UI: Settings → Email Integration |
| Webhook | POST `https://crm.yourcompany.com/webhooks/nylas` |
| Requires | `APP_ENCRYPTION_KEY` env var |
| Outbound | HTTPS to `api.us.nylas.com` |

### Audience Manager / RCM (SMS Messaging)

| Item | Details |
|------|---------|
| Purpose | Lead contact sync for SMS/RCM messaging |
| Config | Admin connects via UI: Settings → RCM |
| Outbound | HTTPS to `app.bercm.com` |

### Aircall Dialer

| Item | Details |
|------|---------|
| Purpose | Cloud phone dialer integration |
| Config | Admin connects via UI: Settings → Dialer |
| Requires | `APP_ENCRYPTION_KEY` env var |

---

## 13. Backup & Disaster Recovery

### Database Backups

| Strategy | Details |
|----------|---------|
| Automated Snapshots | RDS automated backups (7+ day retention) |
| Manual Snapshots | Before major deployments |
| Point-in-Time Recovery | Available with RDS (restore to any point within retention) |

### Application Recovery

The application is **stateless** — no data is stored on the container filesystem. Recovery procedure:

1. Ensure RDS is accessible
2. Deploy container from ECR image
3. Pass environment variables
4. App auto-migrates schema on startup

### Key Data to Back Up

| Data | Location | Criticality |
|------|----------|------------|
| PostgreSQL database | RDS | **Critical** — all business data |
| `JWT_SECRET` | SSM Parameter Store | **Critical** — invalidates all sessions if lost |
| `APP_ENCRYPTION_KEY` | SSM Parameter Store | **Critical** — encrypts stored credentials |
| Google OAuth credentials | Google Cloud Console | **High** — needed for login |

> [!CAUTION]
> **If `APP_ENCRYPTION_KEY` is lost**, all stored integration credentials (Salesforce, Nylas, Aircall) become **permanently unreadable**. They must be re-entered by an admin. Store this key securely in AWS Secrets Manager or SSM Parameter Store (SecureString).

---

## 14. Troubleshooting

### App won't start

| Error | Cause | Fix |
|-------|-------|-----|
| `JWT_SECRET environment variable is required` | Missing `JWT_SECRET` | Set the env var |
| `connection refused` to database | Wrong `DATABASE_URL` or SG rules | Check SG allows 5432 from ECS/EC2 |
| `password authentication failed` | Wrong DB credentials | Verify `DATABASE_URL` credentials |

### OAuth login fails

| Error | Cause | Fix |
|-------|-------|-----|
| `redirect_uri_mismatch` | `GOOGLE_REDIRECT_URI` doesn't match Google Console | Ensure exact match (protocol, domain, path) |
| `error=unauthorized` on login | User email not in `allowed_users` table | Admin must add user via Settings → User Management |

### Common container issues

```bash
# View logs (ECS)
aws logs get-log-events --log-group-name /ecs/rcm-crm --log-stream-name <stream>

# SSH into EC2 for debugging
docker exec -it rcm /bin/bash

# Manual DB migration check
docker exec -it rcm python -c "from database import engine; from migrations import run_schema_migrations; run_schema_migrations(engine); print('OK')"
```

### Database connection pooling

The app uses SQLAlchemy's default pool settings. For production with multiple containers, consider adding pool configuration:

```python
# database.py — if needed:
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,
    pool_recycle=1800  # Recycle connections every 30 min
)
```

---

## 15. Security Checklist

- [ ] `ALLOW_DEMO=false` in production
- [ ] `JWT_SECRET` is a strong random string (48+ characters)
- [ ] `APP_ENCRYPTION_KEY` stored in AWS SSM/Secrets Manager (not plain env)
- [ ] PostgreSQL in **private subnet** (no public access)
- [ ] RDS Security Group allows inbound **only** from ECS/EC2 security group
- [ ] HTTPS enforced via ALB (HTTP → HTTPS redirect)
- [ ] Google OAuth redirect URI uses HTTPS
- [ ] `CORS allow_origins` restricted (currently `["*"]` — tighten for production)
- [ ] Database credentials rotated periodically
- [ ] RDS automated backups enabled (7+ day retention)
- [ ] CloudWatch alarms configured for 5xx errors and resource usage
- [ ] IAM roles use least-privilege for ECS task execution

---

## Appendix A: Quick Start Checklist

```
1. [ ] Create RDS PostgreSQL instance
2. [ ] Create database and user
3. [ ] Set up Google OAuth (Client ID + Secret + Redirect URI)
4. [ ] Generate JWT_SECRET and APP_ENCRYPTION_KEY
5. [ ] Store all secrets in SSM Parameter Store
6. [ ] Create ECR repository and push Docker image
7. [ ] Create ECS cluster, task definition, and service
8. [ ] Create ALB with HTTPS listener and target group
9. [ ] Configure DNS (Route 53 or external)
10. [ ] Deploy and verify health check: GET /api/health
11. [ ] Log in via Google SSO and verify first user is created as Super Admin
12. [ ] Configure integrations via Admin Settings UI
```

## Appendix B: Data Migration from Render

If migrating the existing production database from Render PostgreSQL to AWS RDS:

```bash
# Export from Render
pg_dump -Fc -h <RENDER_HOST> -U <USER> -d <DB_NAME> > rcm_backup.dump

# Import to AWS RDS
pg_restore -h <RDS_ENDPOINT> -U rcm_user -d rcm --no-owner --no-privileges rcm_backup.dump
```

> [!WARNING]
> **After migration, update `GOOGLE_REDIRECT_URI`** in both the env vars and Google Cloud Console to point to the new AWS domain.

---

*Document prepared by Engineering Team — April 2026*

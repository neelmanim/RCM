"""
Seed script: populate user_activity_daily_summary and user_activity_logs
with realistic test data for the metrics dashboard.

Usage:
    python seed_metrics.py

Requires DATABASE_URL env var (or defaults to local sqlite).
"""
import os, sys, random
from datetime import datetime, timedelta, timezone

# Fix imports — run from backend dir
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, engine
import models

def seed():
    db = SessionLocal()

    # Run schema migrations first
    try:
        from migrations import run_schema_migrations
        run_schema_migrations()
        print("✅ Schema migrations applied")
    except Exception as e:
        print(f"⚠️  Migrations skipped: {e}")

    # Get all SDR users
    sdrs = db.query(models.User).filter(models.User.role == 'SDR', models.User.is_active == True).all()
    if not sdrs:
        print("⚠️  No active SDR users found. Creating sample activity for all users...")
        sdrs = db.query(models.User).filter(models.User.is_active == True).all()

    if not sdrs:
        print("❌ No users found at all. Cannot seed data.")
        db.close()
        return

    print(f"📊 Found {len(sdrs)} users to seed data for")

    actions = ['VIEW_LEAD', 'UPDATE_LEAD_STATUS', 'LOG_CALL', 'SCHEDULE_MEETING', 'LOGIN']
    action_weights = [40, 20, 25, 10, 5]  # weighted distribution

    now = datetime.now(timezone.utc)
    days_back = 30

    # ── 1. Seed user_activity_logs ────────────────────────────────────────────
    print("\n🔄 Seeding user_activity_logs...")
    log_count = 0
    for sdr in sdrs:
        # Each SDR gets 5-20 actions per day for the last 30 days
        for day_offset in range(days_back):
            day = now - timedelta(days=day_offset)
            num_actions = random.randint(5, 20)
            for _ in range(num_actions):
                action = random.choices(actions, weights=action_weights, k=1)[0]
                hour = random.randint(8, 18)
                minute = random.randint(0, 59)
                ts = day.replace(hour=hour, minute=minute, second=random.randint(0, 59))

                log = models.UserActivityLog(
                    user_id=sdr.id,
                    user_email=sdr.email,
                    user_name=sdr.name or sdr.email,
                    action=action,
                    object_type='lead' if action != 'LOGIN' else 'session',
                    object_id=f"sample-{random.randint(1000, 9999)}",
                    metadata_json=f'{{"source":"seed","day_offset":{day_offset}}}',
                    created_at=ts
                )
                db.add(log)
                log_count += 1

    db.commit()
    print(f"   ✅ Inserted {log_count} activity logs")

    # ── 2. Seed user_activity_daily_summary ───────────────────────────────────
    print("\n🔄 Seeding user_activity_daily_summary...")
    summary_count = 0
    for sdr in sdrs:
        for day_offset in range(days_back):
            day_date = (now - timedelta(days=day_offset)).date()

            # Random but realistic numbers
            lead_views = random.randint(3, 25)
            status_updates = random.randint(1, 10)
            calls_logged = random.randint(2, 15)
            meetings_scheduled = random.randint(0, 3)
            login_count = random.randint(1, 4)
            total = lead_views + status_updates + calls_logged + meetings_scheduled + login_count
            time_spent = random.randint(20, 180)  # 20 min to 3 hours

            # Check if summary already exists
            existing = db.query(models.UserActivityDailySummary).filter(
                models.UserActivityDailySummary.user_id == sdr.id,
                models.UserActivityDailySummary.summary_date == day_date
            ).first()

            if existing:
                existing.lead_views = lead_views
                existing.status_updates = status_updates
                existing.calls_logged = calls_logged
                existing.meetings_scheduled = meetings_scheduled
                existing.login_count = login_count
                existing.total_actions = total
                existing.time_spent_minutes = time_spent
            else:
                summary = models.UserActivityDailySummary(
                    user_id=sdr.id,
                    user_email=sdr.email,
                    user_name=sdr.name or sdr.email,
                    summary_date=day_date,
                    lead_views=lead_views,
                    status_updates=status_updates,
                    calls_logged=calls_logged,
                    meetings_scheduled=meetings_scheduled,
                    login_count=login_count,
                    total_actions=total,
                    time_spent_minutes=time_spent
                )
                db.add(summary)
            summary_count += 1

    db.commit()
    print(f"   ✅ Inserted/updated {summary_count} daily summaries")

    # ── 3. Seed login_logs for time tracking ──────────────────────────────────
    print("\n🔄 Seeding login_logs for time tracking...")
    login_count = 0
    for sdr in sdrs:
        for day_offset in range(days_back):
            day = now - timedelta(days=day_offset)
            # 1-3 sessions per day
            num_sessions = random.randint(1, 3)
            for session in range(num_sessions):
                login_hour = random.choice([8, 9, 10, 13, 14])
                login_time = day.replace(hour=login_hour, minute=random.randint(0, 30))
                session_minutes = random.randint(30, 180)
                logout_time = login_time + timedelta(minutes=session_minutes)

                login_log = models.LoginLog(
                    user_id=sdr.id,
                    user_email=sdr.email,
                    user_name=sdr.name or sdr.email,
                    ip_address=f"10.0.{random.randint(1,254)}.{random.randint(1,254)}",
                    user_agent="Mozilla/5.0 (seed script)",
                    login_at=login_time,
                    logout_at=logout_time
                )
                db.add(login_log)
                login_count += 1

    db.commit()
    print(f"   ✅ Inserted {login_count} login logs")

    db.close()
    print(f"\n🎉 Done! Seeded data for {len(sdrs)} users over {days_back} days.")
    print(f"   Totals: {log_count} activity logs, {summary_count} daily summaries, {login_count} login logs")


if __name__ == "__main__":
    seed()

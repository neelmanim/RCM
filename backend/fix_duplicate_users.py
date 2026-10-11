"""
One-time cleanup script: Merge duplicate users caused by case-sensitive email matching.

This script:
1. Finds users with duplicate emails (differing only by case)
2. Keeps the ACTIVE user (the one with a google_id / last login)
3. Re-assigns all leads, call_logs, and activity from the stale duplicate to the active user
4. Normalizes all emails to lowercase
5. Removes the stale duplicate user record

Usage:
    cd backend
    python fix_duplicate_users.py

    # Dry-run first (default):
    python fix_duplicate_users.py

    # Actually apply:
    python fix_duplicate_users.py --apply
"""
import sys
import os

# Add parent dir to path so we can import from backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import func
from database import SessionLocal
import models

DRY_RUN = "--apply" not in sys.argv


def main():
    db = SessionLocal()
    try:
        print("=" * 60)
        print("  Duplicate User Cleanup (case-insensitive email merge)")
        print(f"  Mode: {'DRY RUN' if DRY_RUN else '⚠️  APPLYING CHANGES'}")
        print("=" * 60)

        # Find duplicate emails (case-insensitive)
        dupes = (
            db.query(func.lower(models.User.email).label("email_lower"), func.count().label("cnt"))
            .group_by(func.lower(models.User.email))
            .having(func.count() > 1)
            .all()
        )

        if not dupes:
            print("\n✅ No duplicate users found. All clean!")
            return

        print(f"\n🔍 Found {len(dupes)} email(s) with duplicates:\n")

        for row in dupes:
            email_lower = row.email_lower
            users = db.query(models.User).filter(
                func.lower(models.User.email) == email_lower
            ).all()

            print(f"  📧 {email_lower}")
            for u in users:
                login_status = "✅ SSO linked" if u.google_id else "❌ No SSO"
                lead_count = len(u.assigned_leads) if u.assigned_leads else 0
                call_count = len(u.call_logs) if u.call_logs else 0
                print(f"     ID: {u.id[:12]}...  Email: {u.email:<40}  {login_status}  Leads: {lead_count}  Calls: {call_count}  Last Login: {u.last_login_at}")

            # Pick the keeper: prefer the one with google_id (SSO linked) or most recent login
            keeper = None
            stale = []
            for u in users:
                if u.google_id and u.last_login_at:
                    if keeper is None or (u.last_login_at and keeper.last_login_at and u.last_login_at > keeper.last_login_at):
                        if keeper:
                            stale.append(keeper)
                        keeper = u
                    else:
                        stale.append(u)
                else:
                    stale.append(u)

            # Fallback: if no user has google_id, keep the most recently created
            if keeper is None:
                users_sorted = sorted(users, key=lambda u: u.created_at or "", reverse=True)
                keeper = users_sorted[0]
                stale = users_sorted[1:]

            print(f"     → KEEP:   {keeper.email} (ID: {keeper.id[:12]}...)")
            for s in stale:
                print(f"     → REMOVE: {s.email} (ID: {s.id[:12]}...)")

            if not DRY_RUN:
                # Normalize keeper email
                if keeper.email != email_lower:
                    print(f"     → Normalizing keeper email: {keeper.email} → {email_lower}")
                    keeper.email = email_lower

                for stale_user in stale:
                    # Move assigned leads
                    for lead in list(stale_user.assigned_leads):
                        if models.assign_lead(keeper, lead):
                            print(f"     → Moved lead: {lead.first_name} {lead.last_name} ({lead.company})")
                        stale_user.assigned_leads.remove(lead)

                    # Move call logs
                    for call in db.query(models.CallLog).filter(models.CallLog.user_id == stale_user.id).all():
                        call.user_id = keeper.id
                        print(f"     → Moved call log: {call.id[:12]}...")

                    # Move login logs
                    for login in db.query(models.LoginLog).filter(models.LoginLog.user_id == stale_user.id).all():
                        login.user_id = keeper.id

                    # Move activity logs
                    for activity in db.query(models.UserActivityLog).filter(models.UserActivityLog.user_id == stale_user.id).all():
                        activity.user_id = keeper.id

                    # Remove stale AllowedUser entry (if different email casing)
                    db.query(models.AllowedUser).filter(models.AllowedUser.email == stale_user.email).delete()

                    # Delete the stale user
                    print(f"     → Deleting stale user: {stale_user.email}")
                    db.delete(stale_user)

                db.commit()
                print(f"     ✅ Merged successfully\n")
            else:
                print(f"     (dry run — no changes made)\n")

        # Normalize ALL user emails to lowercase
        print("\n🔤 Normalizing all user emails to lowercase...")
        all_users = db.query(models.User).all()
        normalized = 0
        for u in all_users:
            if u.email != u.email.strip().lower():
                old = u.email
                if not DRY_RUN:
                    u.email = u.email.strip().lower()
                normalized += 1
                print(f"  {old} → {u.email.strip().lower()}")

        # Normalize AllowedUser emails too
        all_allowed = db.query(models.AllowedUser).all()
        for au in all_allowed:
            if au.email != au.email.strip().lower():
                old = au.email
                if not DRY_RUN:
                    au.email = au.email.strip().lower()
                normalized += 1
                print(f"  [allowed_users] {old} → {au.email.strip().lower()}")

        if not DRY_RUN:
            db.commit()

        if normalized:
            print(f"  {'Would normalize' if DRY_RUN else 'Normalized'} {normalized} email(s)")
        else:
            print("  All emails already lowercase ✅")

        print("\n" + "=" * 60)
        if DRY_RUN:
            print("  DRY RUN complete. Run with --apply to make changes.")
        else:
            print("  ✅ Cleanup complete!")
        print("=" * 60)

    finally:
        db.close()


if __name__ == "__main__":
    main()

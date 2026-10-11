"""
Seed script: Create test pods, pod admins, and SDRs for testing.
Run once: python seed_test_data.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
import models
import access_db

db = SessionLocal()

try:
    # ── Create 2 test pods ──────────────────────────────────────────────────
    pod_alpha = db.query(models.Pod).filter(models.Pod.name == "Alpha Team").first()
    if not pod_alpha:
        pod_alpha = models.Pod(name="Alpha Team")
        db.add(pod_alpha)
        db.commit()
        db.refresh(pod_alpha)
        print(f"✅ Created Pod: Alpha Team (id={pod_alpha.id})")
    else:
        print(f"⏭️  Pod 'Alpha Team' already exists (id={pod_alpha.id})")

    pod_beta = db.query(models.Pod).filter(models.Pod.name == "Beta Team").first()
    if not pod_beta:
        pod_beta = models.Pod(name="Beta Team")
        db.add(pod_beta)
        db.commit()
        db.refresh(pod_beta)
        print(f"✅ Created Pod: Beta Team (id={pod_beta.id})")
    else:
        print(f"⏭️  Pod 'Beta Team' already exists (id={pod_beta.id})")

    # ── Create Pod Admins ────────────────────────────────────────────────────
    def ensure_user(email, name, role, pod_id=None):
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            user = models.User(email=email, name=name, role=role, pod_id=pod_id)
            db.add(user)
            db.commit()
            db.refresh(user)
            access_db.add_allowed_user(db, email, name, role, "seed-script")
            print(f"✅ Created {role}: {name} ({email}) — Pod: {pod_id or 'None'}")
        else:
            # Update role and pod if needed
            changed = False
            if user.role != role:
                user.role = role
                changed = True
            if pod_id and user.pod_id != pod_id:
                user.pod_id = pod_id
                changed = True
            if changed:
                db.commit()
                print(f"🔄 Updated {name}: role={role}, pod_id={pod_id}")
            else:
                print(f"⏭️  {role} '{name}' already exists")
        return user

    # Pod Admin for Alpha Team
    alpha_admin = ensure_user(
        "alpha.admin@test.messenger.com",
        "Riya Sharma (Alpha Lead)",
        "Pod Admin",
        pod_alpha.id
    )
    pod_alpha.admin_id = alpha_admin.id
    db.commit()

    # Pod Admin for Beta Team
    beta_admin = ensure_user(
        "beta.admin@test.messenger.com",
        "Arjun Patel (Beta Lead)",
        "Pod Admin",
        pod_beta.id
    )
    pod_beta.admin_id = beta_admin.id
    db.commit()

    # ── Create SDRs for Alpha Team ───────────────────────────────────────────
    ensure_user("priya.alpha@test.messenger.com", "Priya Verma", "SDR", pod_alpha.id)
    ensure_user("rahul.alpha@test.messenger.com", "Rahul Singh", "SDR", pod_alpha.id)
    ensure_user("ananya.alpha@test.messenger.com", "Ananya Gupta", "SDR", pod_alpha.id)

    # ── Create SDRs for Beta Team ────────────────────────────────────────────
    ensure_user("karan.beta@test.messenger.com", "Karan Mehta", "SDR", pod_beta.id)
    ensure_user("sneha.beta@test.messenger.com", "Sneha Joshi", "SDR", pod_beta.id)
    ensure_user("dev.beta@test.messenger.com", "Dev Kapoor", "SDR", pod_beta.id)

    print("\n🎉 Test data seeded successfully!")
    print("\n📋 Summary:")
    print(f"   Alpha Team: admin={alpha_admin.email}, 3 SDRs")
    print(f"   Beta Team:  admin={beta_admin.email}, 3 SDRs")
    print("\n💡 To test Pod Admin view:")
    print("   1. Go to Admin Panel → View as Pod Admin (👁️ button)")
    print("   2. Or log in as alpha.admin@test.messenger.com")

except Exception as e:
    print(f"❌ Error: {e}")
    db.rollback()
    raise
finally:
    db.close()

"""
Seed script: AE Pipeline + CSM Portal test data.

Creates the demo AE (demo.ae@messenger.dev) and demo CSM
(demo.csm@messenger.dev) users if they don't already exist (same emails
auth_routes.py's /auth/demo endpoint auto-provisions), then a handful of
Accounts/Opportunities covering the scenarios the launch-readiness gaps
called out: an unassigned account (bulk-assign target), a silent account
(no CSM touches), a Closed-Won account with a ClosingBrief (handover card +
champion-departure playbook), a Closed-Won account with NO ClosingBrief
(gap #2's "closed before handover tracking" fallback), and two open
Opportunities for the AE to log calls against / close live.

Accounts/Opportunities have no creation endpoint by design (they're
Salesforce-sync-only in production — see models.py's Account/Opportunity
docstrings), so this seeds the DB directly, same as seed_test_data.py does
for Pods/Users.

Usage:
    DATABASE_URL=<staging-postgres-url> python3 seed_csm_ae_data.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal, engine
import models
import access_db

try:
    from migrations import run_schema_migrations
    run_schema_migrations(engine)
    models.Base.metadata.create_all(bind=engine)
    print("✅ Schema migrations + create_all applied")
except Exception as e:
    print(f"⚠️  Migrations skipped: {e}")

db = SessionLocal()


def ensure_user(email, name, role):
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        user = models.User(email=email, name=name, role=role)
        db.add(user)
        db.commit()
        db.refresh(user)
        access_db.add_allowed_user(db, email, name, role, "seed-script")
        print(f"✅ Created {role}: {name} ({email})")
    else:
        print(f"⏭️  {role} '{name}' already exists")
    return user


def ensure_account(name, **kwargs):
    account = db.query(models.Account).filter(models.Account.name == name).first()
    if account:
        print(f"⏭️  Account '{name}' already exists")
        return account
    account = models.Account(name=name, **kwargs)
    db.add(account)
    db.commit()
    db.refresh(account)
    print(f"✅ Created Account: {name} (id={account.id})")
    return account


def ensure_opportunity(account, name, **kwargs):
    opp = db.query(models.Opportunity).filter(
        models.Opportunity.account_id == account.id, models.Opportunity.name == name
    ).first()
    if opp:
        print(f"⏭️  Opportunity '{name}' already exists")
        return opp
    opp = models.Opportunity(account_id=account.id, name=name, **kwargs)
    db.add(opp)
    db.commit()
    db.refresh(opp)
    print(f"✅ Created Opportunity: {name} (id={opp.id})")
    return opp


def ensure_closing_brief(opportunity, **kwargs):
    brief = db.query(models.ClosingBrief).filter(models.ClosingBrief.opportunity_id == opportunity.id).first()
    if brief:
        print(f"⏭️  ClosingBrief for '{opportunity.name}' already exists")
        return brief
    brief = models.ClosingBrief(opportunity_id=opportunity.id, **kwargs)
    db.add(brief)
    db.commit()
    db.refresh(brief)
    print(f"✅ Created ClosingBrief for {opportunity.name}")
    return brief


def now_minus(days):
    return datetime.now(timezone.utc) - timedelta(days=days)


def now_plus(days):
    return datetime.now(timezone.utc) + timedelta(days=days)


try:
    ae = ensure_user("demo.ae@messenger.dev", "Demo AE", "AE")
    csm = ensure_user("demo.csm@messenger.dev", "Demo CSM", "CSM")

    # 1. Open pipeline, assigned to the CSM already — AE can log calls / close live.
    northwind = ensure_account(
        "Northwind Traders", industry="Retail", owner_user_id=ae.id,
        assigned_csm_id=csm.id, customer_since=now_minus(400),
    )
    ensure_opportunity(
        northwind, "Northwind — Expansion Deal", amount=50000.0,
        close_date=now_plus(20), stage_name="Negotiation",
        is_closed=False, is_won=False, owner_user_id=ae.id,
    )

    # 2. Renewal countdown playbook — closes soon.
    globex = ensure_account(
        "Globex Logistics", industry="Logistics", owner_user_id=ae.id,
        assigned_csm_id=csm.id, customer_since=now_minus(300),
    )
    ensure_opportunity(
        globex, "Globex — Renewal", amount=30000.0,
        close_date=now_plus(5), stage_name="Proposal",
        is_closed=False, is_won=False, owner_user_id=ae.id,
    )

    # 3. Unassigned — bulk-assign-to-CSM target (launch-readiness gap #1).
    initech = ensure_account(
        "Initech Systems", industry="Software", owner_user_id=ae.id,
        assigned_csm_id=None, customer_since=now_minus(90),
    )
    ensure_opportunity(
        initech, "Initech — New Business", amount=18000.0,
        close_date=now_plus(30), stage_name="Qualification",
        is_closed=False, is_won=False, owner_user_id=ae.id,
    )

    # 4. Silent account — assigned, no touches ever logged (Silent-account playbook).
    ensure_account(
        "Umbrella Health", industry="Healthcare", owner_user_id=ae.id,
        assigned_csm_id=csm.id, customer_since=now_minus(500),
    )

    # 5. Closed-Won WITH a ClosingBrief — handover card + champion-departure playbook.
    wayne = ensure_account(
        "Wayne Analytics", industry="Analytics", owner_user_id=ae.id,
        assigned_csm_id=csm.id, customer_since=now_minus(10),
    )
    wayne_opp = ensure_opportunity(
        wayne, "Wayne — Closed Won", amount=120000.0,
        close_date=now_minus(10), stage_name="Closed Won",
        is_closed=True, is_won=True, owner_user_id=ae.id,
    )
    ensure_closing_brief(
        wayne_opp,
        champion_name="Lucius Fox", champion_role="VP Operations",
        champion_contact="lucius.fox@wayneanalytics.com",
        promises_made="Dedicated onboarding call within first week.",
        handover_notes="Champion is enthusiastic, wants a QBR in 90 days.",
        created_by=ae.id, locked=False, champion_active=True,
    )

    # 6. Closed-Won WITHOUT a ClosingBrief — gap #2's fallback state.
    stark = ensure_account(
        "Stark Renewables", industry="Energy", owner_user_id=ae.id,
        assigned_csm_id=csm.id, customer_since=now_minus(600),
    )
    ensure_opportunity(
        stark, "Stark — Closed Won (legacy)", amount=200000.0,
        close_date=now_minus(200), stage_name="Closed Won",
        is_closed=True, is_won=True, owner_user_id=ae.id,
    )

    print("\n🎉 Seeding complete!")
    print(f"   Demo AE:  {ae.email}")
    print(f"   Demo CSM: {csm.email}")
    print("   Accounts: Northwind Traders, Globex Logistics, Initech Systems (unassigned),")
    print("             Umbrella Health (silent), Wayne Analytics (handover), Stark Renewables (no brief)")
finally:
    db.close()

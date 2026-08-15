import os
import sys
import random
from pathlib import Path
from faker import Faker

# Add backend directory to sys.path so we can import models and database
backend_dir = Path(__file__).parent.parent.parent / "backend"
sys.path.append(str(backend_dir.resolve()))

from database import SessionLocal
from models import Lead

def seed_database(num_leads=50):
    """
    Connects to the database and inserts realistic fake leads.
    Deletes existing fake data (is_test=True) before inserting to avoid duplicates.
    """
    print(f"-- Seeding database with {num_leads} leads...")
    fake = Faker()
    db = SessionLocal()
    
    try:
        # 1. Clean up existing demo data
        # Let's delete any lead created with a specific source to make this idempotent
        deleted = db.query(Lead).filter(Lead.lead_source == 'demo_seed').delete()
        print(f"-- Deleted {deleted} old demo leads.")
        
        # 2. Generate new leads
        lead_types = ['Insurance', 'Real Estate']
        policy_types = ['Life', 'Health', 'Home', 'Auto', 'Umbrella']
        
        leads_to_insert = []
        for _ in range(num_leads):
            lead_type = random.choice(lead_types)
            is_insurance = lead_type == 'Insurance'
            
            lead = Lead(
                first_name=fake.first_name(),
                last_name=fake.last_name(),
                email=fake.ascii_safe_email(),
                phone=fake.phone_number()[:20],
                company=fake.company(),
                title=fake.job()[:50],
                status="Lead Assigned",
                lead_source="demo_seed",
                is_test=True, # Mark as test lead
                
                # Enrichment fields for realism
                city=fake.city(),
                state=fake.state(),
                industry=lead_type,
                employee_count=random.randint(10, 500),
                annual_revenue=f"${random.randint(1, 100)}M",
                
                # Research context
                research_company=f"Leading {lead_type} firm specializing in targeted growth.",
                research_contact=f"Key decision maker.",
                research_geo=fake.state(),
                research_heat=random.choice(["hot", "warm", "cold"])
            )
            leads_to_insert.append(lead)
            
        db.add_all(leads_to_insert)
        db.commit()
        print(f"-- Successfully inserted {len(leads_to_insert)} new demo leads!")
        
    except Exception as e:
        print(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_database(50)

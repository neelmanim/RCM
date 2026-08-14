"""
seed_demo.py

This script generates 50 realistic 'Insurance' and 'Real Estate' leads using the Faker library.
It outputs SQL INSERT statements to stdout, simulating a database seeding process for the RCM CRM.
"""

import random
from faker import Faker

def generate_sql_inserts(num_leads=50):
    """
    Generates SQL INSERT statements for leads.
    """
    fake = Faker()
    
    # Pre-defined options for policy types and lead types
    lead_types = ['Insurance', 'Real Estate']
    policy_types = ['Life', 'Health', 'Home', 'Auto', 'Umbrella']
    
    # Target table name
    table_name = "leads"
    
    print(f"-- Generating {num_leads} leads for {table_name} table")
    print("BEGIN TRANSACTION;")
    
    for _ in range(num_leads):
        # Escape single quotes for SQL compatibility
        name = fake.name().replace("'", "''")
        email = fake.ascii_safe_email()
        property_address = fake.address().replace('\n', ', ').replace("'", "''")
        
        lead_type = random.choice(lead_types)
        
        # If lead is Insurance, assign a policy type, otherwise NULL or None equivalent
        if lead_type == 'Insurance':
            policy_type = random.choice(policy_types)
        else:
            policy_type = "None"
        
        # Construct the SQL INSERT statement
        # Assuming columns: name, email, property_address, lead_type, policy_type
        sql = (
            f"INSERT INTO {table_name} (name, email, property_address, lead_type, policy_type) "
            f"VALUES ('{name}', '{email}', '{property_address}', '{lead_type}', '{policy_type}');"
        )
        print(sql)
        
    print("COMMIT;")
    print("-- Seeding complete")

if __name__ == "__main__":
    generate_sql_inserts(50)

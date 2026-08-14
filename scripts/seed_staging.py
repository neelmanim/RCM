#!/usr/bin/env python3
"""
Seed script for staging: 4 Pod Admins, 12 SDRs (3 per pod), 4 Pods, 60 Leads (15 per pod).
Usage:
    python3 seed_staging.py --url https://rcm-crm.onrender.com --token <ADMIN_JWT>
"""

import requests
import argparse
import random
import time

# ── Test Data ─────────────────────────────────────────────────────────────────

POD_ADMINS = [
    {"name": "Rahul Sharma",    "email": "rahul.sharma@testcrm.com",    "role": "Pod Admin"},
    {"name": "Priya Verma",     "email": "priya.verma@testcrm.com",     "role": "Pod Admin"},
    {"name": "Amit Patel",      "email": "amit.patel@testcrm.com",      "role": "Pod Admin"},
    {"name": "Sneha Reddy",     "email": "sneha.reddy@testcrm.com",     "role": "Pod Admin"},
]

SDRS = [
    # Pod 1 – Alpha
    {"name": "Ankit Kumar",     "email": "ankit.kumar@testcrm.com",     "role": "SDR"},
    {"name": "Neha Singh",      "email": "neha.singh@testcrm.com",      "role": "SDR"},
    {"name": "Vikram Joshi",    "email": "vikram.joshi@testcrm.com",    "role": "SDR"},
    # Pod 2 – Beta
    {"name": "Riya Gupta",      "email": "riya.gupta@testcrm.com",      "role": "SDR"},
    {"name": "Siddharth Nair",  "email": "siddharth.nair@testcrm.com",  "role": "SDR"},
    {"name": "Meera Iyer",      "email": "meera.iyer@testcrm.com",      "role": "SDR"},
    # Pod 3 – Gamma
    {"name": "Arjun Mehta",     "email": "arjun.mehta@testcrm.com",     "role": "SDR"},
    {"name": "Kavya Desai",     "email": "kavya.desai@testcrm.com",     "role": "SDR"},
    {"name": "Rohan Pillai",    "email": "rohan.pillai@testcrm.com",    "role": "SDR"},
    # Pod 4 – Delta
    {"name": "Isha Banerjee",   "email": "isha.banerjee@testcrm.com",   "role": "SDR"},
    {"name": "Karan Malhotra",  "email": "karan.malhotra@testcrm.com",  "role": "SDR"},
    {"name": "Divya Saxena",    "email": "divya.saxena@testcrm.com",    "role": "SDR"},
]

PODS = [
    {"name": "Alpha Team", "admin_idx": 0, "sdr_range": (0, 3)},
    {"name": "Beta Team",  "admin_idx": 1, "sdr_range": (3, 6)},
    {"name": "Gamma Team", "admin_idx": 2, "sdr_range": (6, 9)},
    {"name": "Delta Team", "admin_idx": 3, "sdr_range": (9, 12)},
]

# 60 realistic leads
LEADS = [
    {"first_name": "Aditya",     "last_name": "Kapoor",     "email": "aditya.kapoor@techfirm.in",       "company": "TechFirm India",         "phone": "+91-9876543210"},
    {"first_name": "Sunita",     "last_name": "Deshpande",  "email": "sunita.d@globalmed.co",            "company": "GlobalMed Healthcare",   "phone": "+91-9876543211"},
    {"first_name": "Rajesh",     "last_name": "Menon",      "email": "rajesh.menon@infosys.com",         "company": "Infosys Ltd",            "phone": "+91-9876543212"},
    {"first_name": "Pooja",      "last_name": "Shah",       "email": "pooja.shah@wipro.com",             "company": "Wipro Technologies",     "phone": "+91-9876543213"},
    {"first_name": "Suresh",     "last_name": "Babu",       "email": "suresh.babu@tcs.com",              "company": "TCS Digital",            "phone": "+91-9876543214"},
    {"first_name": "Lakshmi",    "last_name": "Natarajan",  "email": "lakshmi.n@hcl.com",                "company": "HCL Group",              "phone": "+91-9876543215"},
    {"first_name": "Vikrant",    "last_name": "Choudary",   "email": "vikrant.c@reliancejio.com",        "company": "Reliance Jio",           "phone": "+91-9876543216"},
    {"first_name": "Ananya",     "last_name": "Mishra",     "email": "ananya.mishra@flipkart.com",       "company": "Flipkart India",         "phone": "+91-9876543217"},
    {"first_name": "Deepak",     "last_name": "Agarwal",    "email": "deepak.a@zoho.com",                "company": "Zoho Corporation",       "phone": "+91-9876543218"},
    {"first_name": "Shreya",     "last_name": "Kulkarni",   "email": "shreya.k@freshworks.com",          "company": "Freshworks Inc",         "phone": "+91-9876543219"},
    {"first_name": "Manoj",      "last_name": "Tiwari",     "email": "manoj.tiwari@apollo.in",           "company": "Apollo Hospitals",       "phone": "+91-9876543220"},
    {"first_name": "Kavita",     "last_name": "Bhatia",     "email": "kavita.b@maxhealthcare.com",       "company": "Max Healthcare",         "phone": "+91-9876543221"},
    {"first_name": "Rahul",      "last_name": "Saxena",     "email": "rahul.s@icicbank.in",              "company": "ICICI Bank",             "phone": "+91-9876543222"},
    {"first_name": "Nandini",    "last_name": "Rao",        "email": "nandini.rao@hdfc.com",             "company": "HDFC Financial",         "phone": "+91-9876543223"},
    {"first_name": "Gaurav",     "last_name": "Pandey",     "email": "gaurav.p@tatamotors.com",          "company": "Tata Motors",            "phone": "+91-9876543224"},
    {"first_name": "Priyanka",   "last_name": "Jain",       "email": "priyanka.jain@mahindra.com",       "company": "Mahindra Group",         "phone": "+91-9876543225"},
    {"first_name": "Sanjay",     "last_name": "Bose",       "email": "sanjay.bose@bharti.in",            "company": "Bharti Airtel",          "phone": "+91-9876543226"},
    {"first_name": "Ritika",     "last_name": "Sharma",     "email": "ritika.sharma@paytm.com",          "company": "Paytm Financial",        "phone": "+91-9876543227"},
    {"first_name": "Alok",       "last_name": "Verma",      "email": "alok.verma@ola.com",               "company": "Ola Mobility",           "phone": "+91-9876543228"},
    {"first_name": "Simran",     "last_name": "Kaur",       "email": "simran.kaur@swiggy.com",           "company": "Swiggy",                 "phone": "+91-9876543229"},
    {"first_name": "Prakash",    "last_name": "Nair",       "email": "prakash.nair@zomato.com",          "company": "Zomato Ltd",             "phone": "+91-9876543230"},
    {"first_name": "Bhavna",     "last_name": "Gupta",      "email": "bhavna.g@delhivery.com",           "company": "Delhivery Logistics",    "phone": "+91-9876543231"},
    {"first_name": "Tanmay",     "last_name": "Das",        "email": "tanmay.das@razorpay.com",          "company": "Razorpay",               "phone": "+91-9876543232"},
    {"first_name": "Aditi",      "last_name": "Sinha",      "email": "aditi.sinha@cred.club",            "company": "CRED Fintech",           "phone": "+91-9876543233"},
    {"first_name": "Vishal",     "last_name": "Reddy",      "email": "vishal.reddy@vedantu.com",         "company": "Vedantu EdTech",         "phone": "+91-9876543234"},
    {"first_name": "Pallavi",    "last_name": "Mehta",      "email": "pallavi.m@byjus.com",              "company": "BYJU'S Education",       "phone": "+91-9876543235"},
    {"first_name": "Ashish",     "last_name": "Rathore",    "email": "ashish.r@urbancompany.com",        "company": "Urban Company",          "phone": "+91-9876543236"},
    {"first_name": "Swati",      "last_name": "Patil",      "email": "swati.patil@nykaa.com",            "company": "Nykaa Fashion",          "phone": "+91-9876543237"},
    {"first_name": "Rohit",      "last_name": "Choudhary",  "email": "rohit.c@policybazaar.com",         "company": "Policybazaar",           "phone": "+91-9876543238"},
    {"first_name": "Megha",      "last_name": "Agrawal",    "email": "megha.a@carsdekho.com",            "company": "CarDekho Group",         "phone": "+91-9876543239"},
    {"first_name": "Nikhil",     "last_name": "Yadav",      "email": "nikhil.yadav@lenskart.com",        "company": "Lenskart Solutions",     "phone": "+91-9876543240"},
    {"first_name": "Jyoti",      "last_name": "Ramesh",     "email": "jyoti.r@practo.com",               "company": "Practo Health",          "phone": "+91-9876543241"},
    {"first_name": "Manish",     "last_name": "Dubey",      "email": "manish.d@cleartax.in",             "company": "ClearTax",               "phone": "+91-9876543242"},
    {"first_name": "Aparna",     "last_name": "Nair",       "email": "aparna.nair@sharechat.com",        "company": "ShareChat Media",        "phone": "+91-9876543243"},
    {"first_name": "Varun",      "last_name": "Malhotra",   "email": "varun.m@meesho.com",               "company": "Meesho Commerce",        "phone": "+91-9876543244"},
    {"first_name": "Tanya",      "last_name": "Bhatt",      "email": "tanya.bhatt@groww.in",             "company": "Groww Investments",      "phone": "+91-9876543245"},
    {"first_name": "Aniket",     "last_name": "Joshi",      "email": "aniket.joshi@zerodha.com",         "company": "Zerodha",                "phone": "+91-9876543246"},
    {"first_name": "Sakshi",     "last_name": "Chauhan",    "email": "sakshi.c@dunzo.in",                "company": "Dunzo Daily",            "phone": "+91-9876543247"},
    {"first_name": "Harsh",      "last_name": "Trivedi",    "email": "harsh.t@unacademy.com",            "company": "Unacademy",              "phone": "+91-9876543248"},
    {"first_name": "Komal",      "last_name": "Soni",       "email": "komal.soni@pharmeasy.in",          "company": "PharmEasy",              "phone": "+91-9876543249"},
    {"first_name": "Arun",       "last_name": "Krishnan",   "email": "arun.k@dream11.com",              "company": "Dream11",                "phone": "+91-9876543250"},
    {"first_name": "Shweta",     "last_name": "Bansal",     "email": "shweta.b@mpl.live",                "company": "Mobile Premier League",  "phone": "+91-9876543251"},
    {"first_name": "Kartik",     "last_name": "Singh",      "email": "kartik.singh@spinny.com",          "company": "Spinny Cars",            "phone": "+91-9876543252"},
    {"first_name": "Yamini",     "last_name": "Shankar",    "email": "yamini.s@jugalkibandi.co",         "company": "JugalBandi AI",          "phone": "+91-9876543253"},
    {"first_name": "Nitin",      "last_name": "Puri",       "email": "nitin.puri@snapdeal.com",          "company": "Snapdeal",               "phone": "+91-9876543254"},
    {"first_name": "Rashi",      "last_name": "Malviya",    "email": "rashi.m@dailyhunt.in",             "company": "DailyHunt",              "phone": "+91-9876543255"},
    {"first_name": "Kunal",      "last_name": "Ahuja",      "email": "kunal.a@slice.fin",                "company": "Slice Fintech",          "phone": "+91-9876543256"},
    {"first_name": "Neeraj",     "last_name": "Gupta",      "email": "neeraj.g@udaan.com",               "company": "Udaan B2B",              "phone": "+91-9876543257"},
    {"first_name": "Shilpa",     "last_name": "Rajput",     "email": "shilpa.r@bigbasket.com",           "company": "BigBasket",              "phone": "+91-9876543258"},
    {"first_name": "Tarun",      "last_name": "Chawla",     "email": "tarun.c@porter.in",                "company": "Porter Logistics",       "phone": "+91-9876543259"},
    {"first_name": "Geeta",      "last_name": "Naik",       "email": "geeta.naik@oyo.com",               "company": "OYO Rooms",              "phone": "+91-9876543260"},
    {"first_name": "Sumit",      "last_name": "Thakur",     "email": "sumit.t@makemytrip.com",           "company": "MakeMyTrip",             "phone": "+91-9876543261"},
    {"first_name": "Poonam",     "last_name": "Khandelwal", "email": "poonam.k@ixigo.com",               "company": "Ixigo Travel",           "phone": "+91-9876543262"},
    {"first_name": "Abhishek",   "last_name": "Roy",        "email": "abhishek.roy@yatra.com",           "company": "Yatra Online",           "phone": "+91-9876543263"},
    {"first_name": "Chandni",    "last_name": "Mathur",     "email": "chandni.m@winzo.games",            "company": "WinZo Games",            "phone": "+91-9876543264"},
    {"first_name": "Dhruv",      "last_name": "Anand",      "email": "dhruv.a@milkbasket.com",           "company": "MilkBasket",             "phone": "+91-9876543265"},
    {"first_name": "Falguni",    "last_name": "Doshi",      "email": "falguni.d@navi.com",               "company": "Navi Technologies",      "phone": "+91-9876543266"},
    {"first_name": "Girish",     "last_name": "Mathur",     "email": "girish.m@mindtree.com",            "company": "Mindtree Ltd",           "phone": "+91-9876543267"},
    {"first_name": "Heena",      "last_name": "Khan",       "email": "heena.khan@reliance.in",           "company": "Reliance Digital",       "phone": "+91-9876543268"},
    {"first_name": "Imran",      "last_name": "Shaikh",     "email": "imran.s@embibe.com",               "company": "Embibe Learning",        "phone": "+91-9876543269"},
]

assert len(LEADS) == 60, f"Expected 60 leads, got {len(LEADS)}"


def main():
    parser = argparse.ArgumentParser(description="Seed staging with test data")
    parser.add_argument("--url", required=True, help="Staging base URL (e.g. https://rcm-crm.onrender.com)")
    parser.add_argument("--token", required=True, help="Super Admin JWT token")
    args = parser.parse_args()

    BASE = args.url.rstrip("/")
    HEADERS = {"Authorization": f"Bearer {args.token}", "Content-Type": "application/json"}

    print("\n🚀 Seeding Staging Environment")
    print(f"   Target: {BASE}\n")

    # ── Step 1: Create Pod Admin Users ────────────────────────────────────────
    print("── Creating 4 Pod Admin users ──")
    admin_ids = []
    for admin in POD_ADMINS:
        r = requests.post(f"{BASE}/api/admin/users", json=admin, headers=HEADERS)
        if r.status_code == 200:
            uid = r.json().get("user_id")
            admin_ids.append(uid)
            print(f"  ✅ {admin['name']} ({admin['email']}) → {uid}")
        else:
            print(f"  ⚠️  {admin['name']}: {r.status_code} — {r.text}")
            # If user already exists, try to find their ID
            admin_ids.append(None)
    print()

    # ── Step 2: Create SDR Users ──────────────────────────────────────────────
    print("── Creating 12 SDR users ──")
    sdr_ids = []
    for sdr in SDRS:
        r = requests.post(f"{BASE}/api/admin/users", json=sdr, headers=HEADERS)
        if r.status_code == 200:
            uid = r.json().get("user_id")
            sdr_ids.append(uid)
            print(f"  ✅ {sdr['name']} ({sdr['email']}) → {uid}")
        else:
            print(f"  ⚠️  {sdr['name']}: {r.status_code} — {r.text}")
            sdr_ids.append(None)
    print()

    # ── Step 3: Create Pods ───────────────────────────────────────────────────
    print("── Creating 4 Pods ──")
    pod_ids = []
    for i, pod_def in enumerate(PODS):
        admin_id = admin_ids[pod_def["admin_idx"]]
        payload = {"name": pod_def["name"]}
        if admin_id:
            payload["admin_id"] = admin_id
        r = requests.post(f"{BASE}/api/pods", json=payload, headers=HEADERS)
        if r.status_code == 200:
            pod_id = r.json().get("id")
            pod_ids.append(pod_id)
            print(f"  ✅ {pod_def['name']} → {pod_id} (admin: {admin_id})")
        else:
            print(f"  ⚠️  {pod_def['name']}: {r.status_code} — {r.text}")
            pod_ids.append(None)
    print()

    # ── Step 4: Assign SDRs to Pods ───────────────────────────────────────────
    print("── Assigning SDRs to Pods ──")
    for i, pod_def in enumerate(PODS):
        pod_id = pod_ids[i]
        if not pod_id:
            print(f"  ⚠️  Skipping pod {pod_def['name']} — no pod_id")
            continue
        start, end = pod_def["sdr_range"]
        for j in range(start, end):
            sdr_id = sdr_ids[j]
            if not sdr_id:
                print(f"  ⚠️  Skipping SDR {SDRS[j]['name']} — no user_id")
                continue
            r = requests.post(f"{BASE}/api/pods/{pod_id}/members", json={"user_id": sdr_id}, headers=HEADERS)
            if r.status_code == 200:
                print(f"  ✅ {SDRS[j]['name']} → {pod_def['name']}")
            else:
                print(f"  ⚠️  {SDRS[j]['name']} → {pod_def['name']}: {r.status_code} — {r.text}")
    print()

    # ── Step 5: Create 60 Leads ───────────────────────────────────────────────
    print("── Creating 60 Leads ──")
    lead_ids = []
    for i, lead in enumerate(LEADS):
        r = requests.post(f"{BASE}/api/leads", json=lead, headers=HEADERS)
        if r.status_code == 200:
            lid = r.json().get("id")
            lead_ids.append(lid)
            if (i + 1) % 10 == 0:
                print(f"  ✅ Created {i + 1}/60 leads...")
        else:
            print(f"  ⚠️  Lead [{lead['first_name']} {lead['last_name']}]: {r.status_code} — {r.text}")
            lead_ids.append(None)
    print(f"  ✅ Done — {len([l for l in lead_ids if l])} leads created\n")

    # ── Step 6: Assign leads to Pods (15 per pod) ─────────────────────────────
    print("── Assigning 15 leads to each Pod ──")
    chunk_size = 15
    for i, pod_def in enumerate(PODS):
        pod_id = pod_ids[i]
        if not pod_id:
            print(f"  ⚠️  Skipping pod {pod_def['name']} — no pod_id")
            continue
        start_idx = i * chunk_size
        end_idx = start_idx + chunk_size
        chunk_lead_ids = [lid for lid in lead_ids[start_idx:end_idx] if lid]
        if not chunk_lead_ids:
            print(f"  ⚠️  No valid lead IDs for {pod_def['name']}")
            continue
        r = requests.post(f"{BASE}/api/pods/{pod_id}/assign-leads",
                         json={"lead_ids": chunk_lead_ids}, headers=HEADERS)
        if r.status_code == 200:
            result = r.json()
            print(f"  ✅ {pod_def['name']}: {result.get('assigned', 0)} assigned, {result.get('skipped', 0)} skipped")
        else:
            print(f"  ⚠️  {pod_def['name']}: {r.status_code} — {r.text}")
    print()

    print("🎉 Seeding complete!")
    print(f"   • {len([a for a in admin_ids if a])} Pod Admins")
    print(f"   • {len([s for s in sdr_ids if s])} SDRs")
    print(f"   • {len([p for p in pod_ids if p])} Pods")
    print(f"   • {len([l for l in lead_ids if l])} Leads")
    print()


if __name__ == "__main__":
    main()

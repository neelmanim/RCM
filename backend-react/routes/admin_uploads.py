"""Admin routes — CSV/Google Sheets lead upload with dedup + round-robin assignment."""
import csv, io, re, uuid, json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import httpx

from database import get_db
from middleware import require_admin
from models import Lead, User, Pod, LeadUploadLog, SyncSettings, lead_assignments, ACTIVE_STATUSES

router = APIRouter(prefix="/api/admin", tags=["Admin Uploads"])

COLUMN_MAP = {
    "first name": "first_name", "firstname": "first_name", "last name": "last_name",
    "lastname": "last_name", "email": "email", "email address": "email", "phone": "phone",
    "mobile": "phone", "mobile phone": "phone", "phone number": "phone",
    "secondary phone": "phone_secondary", "company": "company", "company name": "company",
    "organization": "company", "job title": "title", "title": "title",
    "linkedin url": "linkedin_url", "linkedin": "linkedin_url",
    "person linkedin": "person_linkedin", "website": "website", "city": "city",
    "state": "state", "country": "country", "industry": "industry",
    "# employees": "employee_count", "employees": "employee_count",
    "annual revenue": "annual_revenue", "total funding": "total_funding",
    "company phone": "company_phone", "company linkedin": "company_linkedin",
    "company street": "company_street", "company city": "company_city",
    "company postal code": "company_postal_code", "company state": "company_state",
    "company country": "company_country", "company founded": "company_founded",
}
PHONE_COLUMNS = {"phone", "mobile", "mobile phone", "phone number", "direct phone"}
UPDATABLE_FIELDS = {
    "first_name", "last_name", "email", "phone", "company", "title",
    "linkedin_url", "person_linkedin", "website", "city", "state", "country",
    "industry", "employee_count", "annual_revenue", "total_funding",
    "company_phone", "company_linkedin", "company_street", "company_city",
    "company_postal_code", "company_state", "company_country", "company_founded",
}

def _is_valid_email(val):
    if not val or "@" not in val:
        return False
    local, _, domain = val.rpartition("@")
    return bool(local.strip()) and "." in domain

def _get_active_lead_cap(db, user):
    if user.pod_id:
        pod = user.pod if user.pod else db.query(Pod).filter(Pod.id == user.pod_id).first()
        if pod and pod.active_lead_cap is not None:
            return pod.active_lead_cap
    settings = db.query(SyncSettings).filter(SyncSettings.id == 1).first()
    return settings.active_lead_cap if settings and settings.active_lead_cap is not None else 500

def _active_lead_count(user):
    return len([l for l in user.assigned_leads if l.status in ACTIVE_STATUSES])


def _dedup_and_create(db, all_rows, field_mapping, headers, admin, filename, source_label,
                      update_existing, assign_user, assign_to_pod_id):
    """Core dedup + round-robin logic shared by CSV upload and GSheet import."""
    phone_csv_cols = [h for h in headers if h.strip().lower() in PHONE_COLUMNS]

    # Pod-based round-robin setup
    pod_sdrs, pod_sdr_idx, pod_full_sdrs, company_sdr_map = [], 0, set(), {}
    if assign_to_pod_id:
        pod_sdrs = db.query(User).filter(User.pod_id == assign_to_pod_id, User.role == "SDR").all()
        if not pod_sdrs:
            raise HTTPException(status_code=400, detail="No SDRs found in the selected pod")

    created, skipped, updated, errors, dup_count = 0, 0, 0, [], 0
    dup_details, update_details, created_lead_ids = [], [], []
    seen_emails, seen_phones, seen_linkedins, seen_name_company = set(), set(), set(), set()
    total_rows = len(all_rows)

    for row_num, row in enumerate(all_rows, start=2):
        lead_data = {}
        for csv_col, lead_field in field_mapping.items():
            val = (row.get(csv_col, "") or "").strip()
            if val:
                if lead_field == "employee_count":
                    try: lead_data[lead_field] = int(val)
                    except ValueError: pass
                else:
                    lead_data[lead_field] = val

        if "phone" not in lead_data:
            for pcol in phone_csv_cols:
                val = (row.get(pcol, "") or "").strip()
                if val:
                    lead_data["phone"] = val
                    break

        if not lead_data.get("last_name") and not lead_data.get("first_name"):
            skipped += 1
            dup_details.append({"row": row_num, "name": "—", "reason": "no name provided"})
            continue

        display = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip() or "Unknown"

        # ── Duplicate detection ──
        email = lead_data.get("email")
        if email and not _is_valid_email(email):
            email = None
        phone = lead_data.get("phone")
        linkedin = lead_data.get("linkedin_url") or lead_data.get("person_linkedin")
        first = (lead_data.get("first_name") or "").strip().lower()
        last = (lead_data.get("last_name") or "").strip().lower()
        company = (lead_data.get("company") or "").strip().lower()

        is_dup, dup_reason, existing_lead = False, "", None

        if email and not is_dup:
            if email.lower() in seen_emails:
                is_dup, dup_reason = True, f"email: {email}"
            else:
                existing_lead = db.query(Lead).filter(Lead.email == email).first()
                if existing_lead:
                    is_dup, dup_reason = True, f"email: {email}"

        if linkedin and not is_dup:
            lk_clean = linkedin.strip().rstrip('/').lower()
            if lk_clean in seen_linkedins:
                is_dup, dup_reason = True, f"linkedin: {linkedin}"
            else:
                existing_lead = db.query(Lead).filter((Lead.linkedin_url == linkedin) | (Lead.person_linkedin == linkedin)).first()
                if existing_lead:
                    is_dup, dup_reason = True, f"linkedin: {linkedin}"

        if phone and not is_dup:
            phone_digits = ''.join(c for c in phone if c.isdigit())[-10:]
            if phone_digits and len(phone_digits) >= 7:
                if phone_digits in seen_phones:
                    is_dup, dup_reason = True, f"phone: {phone}"
                else:
                    for eid, ep in db.query(Lead.id, Lead.phone).filter(Lead.phone.isnot(None)).all():
                        if ''.join(c for c in (ep or '') if c.isdigit())[-10:] == phone_digits:
                            is_dup, dup_reason = True, f"phone: {phone}"
                            existing_lead = db.query(Lead).get(eid)
                            break

        if first and last and company and not is_dup:
            nck = f"{first}|{last}|{company}"
            if nck in seen_name_company:
                is_dup, dup_reason = True, f"name+company: {first} {last} @ {company}"
            else:
                existing_lead = db.query(Lead).filter(Lead.first_name.ilike(first), Lead.last_name.ilike(last), Lead.company.ilike(f"%{company}%")).first()
                if existing_lead:
                    is_dup, dup_reason = True, f"name+company: {first} {last} @ {company}"

        if is_dup:
            if update_existing and existing_lead:
                fields_updated = []
                for field, value in lead_data.items():
                    if field in UPDATABLE_FIELDS and value and str(getattr(existing_lead, field, None) or "").strip() != str(value).strip():
                        setattr(existing_lead, field, value)
                        fields_updated.append(field)
                if fields_updated:
                    updated += 1
                    update_details.append({"row": row_num, "name": display, "reason": f"updated via {dup_reason}", "fields": fields_updated})
                else:
                    skipped += 1
                    dup_details.append({"row": row_num, "name": display, "reason": f"{dup_reason} (no new data)"})
                dup_count += 1
            else:
                skipped += 1
                dup_count += 1
                dup_details.append({"row": row_num, "name": display, "reason": dup_reason})
            continue

        # Track seen
        if email: seen_emails.add(email.lower())
        if phone:
            pd_val = ''.join(c for c in phone if c.isdigit())[-10:]
            if pd_val: seen_phones.add(pd_val)
        if linkedin: seen_linkedins.add(linkedin.strip().rstrip('/').lower())
        if first and last and company: seen_name_company.add(f"{first}|{last}|{company}")

        try:
            new_lead = Lead(
                sf_lead_id=f"upload-{uuid.uuid4().hex[:12]}",
                first_name=lead_data.get("first_name", ""),
                last_name=lead_data.get("last_name", lead_data.get("first_name", "Unknown")),
                email=email, phone=lead_data.get("phone"), phone_secondary=lead_data.get("phone_secondary"),
                company=lead_data.get("company"), title=lead_data.get("title"),
                status="Lead Assigned", lead_source=source_label,
                linkedin_url=lead_data.get("linkedin_url"), person_linkedin=lead_data.get("person_linkedin"),
                website=lead_data.get("website"), city=lead_data.get("city"),
                state=lead_data.get("state"), country=lead_data.get("country"),
                industry=lead_data.get("industry"), employee_count=lead_data.get("employee_count"),
                annual_revenue=lead_data.get("annual_revenue"), total_funding=lead_data.get("total_funding"),
                company_phone=lead_data.get("company_phone"), company_linkedin=lead_data.get("company_linkedin"),
                company_street=lead_data.get("company_street"), company_city=lead_data.get("company_city"),
                company_postal_code=lead_data.get("company_postal_code"), company_state=lead_data.get("company_state"),
                company_country=lead_data.get("company_country"), company_founded=lead_data.get("company_founded"),
            )
            db.add(new_lead)
            db.flush()

            # Pod-based round-robin
            if pod_sdrs:
                new_lead.pod_id = assign_to_pod_id
                assigned_to_sdr = False
                ck = (lead_data.get("company") or "").strip().lower()
                if ck and ck in company_sdr_map:
                    prev_sdr = company_sdr_map[ck]
                    if prev_sdr.id not in pod_full_sdrs:
                        cap = _get_active_lead_cap(db, prev_sdr)
                        if cap == 0 or _active_lead_count(prev_sdr) < cap:
                            if new_lead not in prev_sdr.assigned_leads:
                                prev_sdr.assigned_leads.append(new_lead)
                            assigned_to_sdr = True
                if not assigned_to_sdr:
                    for attempt in range(len(pod_sdrs)):
                        sdr = pod_sdrs[(pod_sdr_idx + attempt) % len(pod_sdrs)]
                        if sdr.id in pod_full_sdrs:
                            continue
                        cap = _get_active_lead_cap(db, sdr)
                        current = _active_lead_count(sdr)
                        if cap > 0 and current >= cap:
                            pod_full_sdrs.add(sdr.id)
                            continue
                        if new_lead not in sdr.assigned_leads:
                            sdr.assigned_leads.append(new_lead)
                        pod_sdr_idx = (pod_sdr_idx + attempt + 1) % len(pod_sdrs)
                        if ck: company_sdr_map[ck] = sdr
                        assigned_to_sdr = True
                        break
            elif assign_user and new_lead not in assign_user.assigned_leads:
                assign_user.assigned_leads.append(new_lead)

            created += 1
            created_lead_ids.append(new_lead.id)
        except Exception as e:
            errors.append(f"Row {row_num}: {str(e)}")

    db.commit()

    # Upload log
    all_details = dup_details + update_details + [{"row": 0, "name": "error", "reason": e} for e in errors]
    log_status = "completed" if not errors else ("partial" if created > 0 else "failed")
    upload_log = LeadUploadLog(
        uploaded_by=admin.get("sub"), filename=filename,
        total_rows=total_rows, created=created, skipped=skipped, updated=updated,
        errors=len(errors), error_detail=json.dumps(all_details[:50]) if all_details else None,
        status=log_status,
    )
    db.add(upload_log)
    db.commit()

    msg = f"Uploaded {created} leads."
    if updated: msg += f" {updated} leads updated."
    if dup_count and not update_existing: msg += f" {dup_count} duplicates skipped."
    elif skipped: msg += f" Skipped {skipped}."
    return {
        "message": msg, "created": created, "updated": updated, "skipped": skipped,
        "duplicates": dup_count, "dup_details": dup_details, "update_details": update_details,
        "total_rows": total_rows, "errors": errors[:10], "log_id": upload_log.id,
    }


# ── CSV Upload ───────────────────────────────────────────────────────────────

@router.post("/leads/upload-sheet")
def upload_enriched_sheet(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    csv_content = body.get("csv")
    field_mapping = body.get("mapping", {})
    update_existing = body.get("update_existing", False)
    filename = body.get("filename", "upload.csv")
    assign_to_user_id = body.get("assign_to_user_id")
    assign_to_pod_id = body.get("assign_to_pod_id")

    if not csv_content:
        raise HTTPException(status_code=400, detail="CSV content missing")

    assign_user = db.query(User).filter(User.id == assign_to_user_id).first() if assign_to_user_id else None

    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    all_rows = list(reader)

    if not field_mapping:
        for h in headers:
            k = h.strip().lower()
            if k in COLUMN_MAP:
                field_mapping[h] = COLUMN_MAP[k]

    source = f"upload:{filename}:{datetime.now(timezone.utc).isoformat()}"
    return _dedup_and_create(db, all_rows, field_mapping, headers, admin, filename, source, update_existing, assign_user, assign_to_pod_id)


# ── Google Sheets Import ─────────────────────────────────────────────────────

GSHEET_URL_RE = re.compile(r"https?://docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)")

def _extract_gsheet_id(url):
    m = GSHEET_URL_RE.search(url)
    return m.group(1) if m else None

@router.post("/leads/upload-gsheet")
def gsheet_preview(body: dict, admin: dict = Depends(require_admin)):
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    sheet_id = _extract_gsheet_id(url)
    if not sheet_id:
        raise HTTPException(status_code=400, detail=json.dumps({"error_code": "invalid_url", "message": "Please enter a valid Google Sheets URL"}))

    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    try:
        resp = httpx.get(export_url, follow_redirects=True, timeout=30)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=json.dumps({"error_code": "network_timeout", "message": "Could not connect to Google Sheets"}))
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=json.dumps({"error_code": "network_error", "message": str(e)}))

    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=json.dumps({"error_code": "access_denied", "message": "Sheet not accessible. Share as 'Anyone with the link'."}))

    csv_content = resp.text
    if not csv_content or len(csv_content.strip()) < 5:
        raise HTTPException(status_code=400, detail=json.dumps({"error_code": "empty_sheet", "message": "Sheet is empty."}))

    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    all_rows = list(reader)
    if not all_rows:
        raise HTTPException(status_code=400, detail=json.dumps({"error_code": "empty_sheet", "message": "0 data rows found."}))

    auto_mapping = {h: COLUMN_MAP[h.strip().lower()] for h in headers if h.strip().lower() in COLUMN_MAP}
    return {"sheet_id": sheet_id, "sheet_name": "Google Sheet", "headers": headers, "total_rows": len(all_rows), "preview_rows": all_rows[:5], "auto_mapping": auto_mapping, "large_sheet": len(all_rows) > 5000, "available_fields": list(set(COLUMN_MAP.values()))}


@router.post("/leads/import-gsheet")
def gsheet_import(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    url = (body.get("url") or "").strip()
    field_mapping = body.get("mapping", {})
    update_existing = body.get("update_existing", False)
    sheet_name = body.get("sheet_name", "Google Sheet")
    assign_to_user_id = body.get("assign_to_user_id")
    assign_to_pod_id = body.get("assign_to_pod_id")

    assign_user = db.query(User).filter(User.id == assign_to_user_id).first() if assign_to_user_id else None

    sheet_id = _extract_gsheet_id(url)
    if not sheet_id:
        raise HTTPException(status_code=400, detail="Invalid Google Sheets URL")

    try:
        resp = httpx.get(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv", follow_redirects=True, timeout=60)
    except (httpx.TimeoutException, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch sheet: {str(e)}")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not access the Google Sheet")

    reader = csv.DictReader(io.StringIO(resp.text))
    headers = reader.fieldnames or []
    all_rows = list(reader)

    if not field_mapping:
        for h in headers:
            k = h.strip().lower()
            if k in COLUMN_MAP:
                field_mapping[h] = COLUMN_MAP[k]

    ts = datetime.now(timezone.utc).isoformat()
    return _dedup_and_create(db, all_rows, field_mapping, headers, admin, f"gsheet-{sheet_name}", f"gsheet:{sheet_name}:{ts}", update_existing, assign_user, assign_to_pod_id)

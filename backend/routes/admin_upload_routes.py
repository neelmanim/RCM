# ── routes/admin_upload_routes.py — Lead upload, GSheets, logs (split from admin_routes.py) ──
import logging
import math
import uuid
import json
import csv
import io
import re
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text, case, literal_column
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import require_admin
from salesforce import create_new_lead_in_salesforce
from routes._admin_helpers import (
    _get_active_lead_cap, _active_lead_count, _get_or_create_sync_settings,
    _is_valid_email, _has_valid_phone, _lead_data_has_phone,
    _assign_lead_round_robin, COLUMN_MAP, PHONE_COLUMNS
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["Admin – Uploads"])


# ── Lead Upload (Enriched Sheets) ────────────────────────────────────────────


@router.post("/leads/upload-preview")
def upload_preview(body: dict, admin: dict = Depends(require_admin)):
    """Parse CSV and return headers + first 5 rows for preview and field mapping."""
    csv_content = body.get("csv")
    if not csv_content:
        raise HTTPException(status_code=400, detail="CSV content missing")

    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    all_rows = list(reader)
    rows = all_rows[:5]

    # Auto-detect mapping
    auto_mapping = {}
    for header in headers:
        key = header.strip().lower()
        if key in COLUMN_MAP:
            auto_mapping[header] = COLUMN_MAP[key]

    # Phone column detection — warn if no phone column mapped
    phone_fields = {"phone", "phone_secondary", "company_phone"}
    phone_column_detected = any(v in phone_fields for v in auto_mapping.values())

    # Count rows without any phone value across all phone-related columns
    phone_mapped_headers = [h for h, v in auto_mapping.items() if v in phone_fields]
    phone_fallback_headers = [h for h in headers if h.strip().lower() in PHONE_COLUMNS]
    all_phone_headers = list(set(phone_mapped_headers + phone_fallback_headers))
    rows_without_phone = 0
    for row in all_rows:
        has_phone = False
        for ph in all_phone_headers:
            val = (row.get(ph, "") or "").strip()
            if _has_valid_phone(val):
                has_phone = True
                break
        if not has_phone:
            rows_without_phone += 1

    return {
        "headers": headers,
        "preview_rows": rows,
        "auto_mapping": auto_mapping,
        "phone_column_detected": phone_column_detected,
        "rows_without_phone": rows_without_phone,
        "total_rows": len(all_rows),
        "available_fields": [
            "first_name", "last_name", "email", "phone", "phone_secondary", "company", "title",
            "linkedin_url", "person_linkedin", "website", "city", "state", "country",
            "industry", "employee_count", "annual_revenue", "total_funding",
            "company_phone", "company_linkedin", "company_street", "company_city",
            "company_postal_code", "company_state", "company_country", "company_founded"
        ]
    }


@router.post("/leads/upload-sheet")
def upload_enriched_sheet(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """
    Import leads from enriched CSV/Excel sheet.
    Body: { csv: string, mapping: { csv_header: lead_field }, skip_unmatched: bool,
            filename: str, update_existing: bool }
    """
    csv_content = body.get("csv")
    field_mapping = body.get("mapping", {})
    skip_unmatched = body.get("skip_unmatched", True)
    filename = body.get("filename", "unknown")
    update_existing = body.get("update_existing", False)
    assign_to_user_id = body.get("assign_to_user_id")  # Legacy single SDR assignment
    assign_to_pod_id = body.get("assign_to_pod_id")     # Pod-based round-robin assignment
    tag = (body.get("tag") or "").strip()[:50] or None   # V26: optional upload tag
    lead_tag_names = list(dict.fromkeys(
        t.strip() for t in (body.get("tags") or []) if isinstance(t, str) and t.strip()
    ))  # Leads redesign: per-lead tags (independent of the upload-level `tag` above)
    lead_tag_objs = []
    for name in lead_tag_names:
        tag_obj = db.query(models.Tag).filter(models.Tag.name == name).first()
        if not tag_obj:
            tag_obj = models.Tag(name=name)
            db.add(tag_obj)
            db.flush()
        lead_tag_objs.append(tag_obj)
    upload_log_id_value = models.generate_uuid()  # generated upfront so leads can reference it below

    # Look up SDR user if assign_to_user_id is provided (backward compat)
    assign_user = None
    if assign_to_user_id:
        assign_user = db.query(models.User).filter(models.User.id == assign_to_user_id).first()

    # Pod-based assignment: fetch SDRs in the pod for round-robin
    pod_sdrs = []
    pod_batch_counts = {}    # sdr_id -> count of leads assigned in THIS batch (for fairness)
    pod_company_sdr_map = {}  # company_key -> sdr, so same-company leads go to same SDR
    if assign_to_pod_id:
        pod_sdrs = db.query(models.User).filter(
            models.User.pod_id == assign_to_pod_id,
            models.User.role.in_(["SDR", "AE"])
        ).all()
        if not pod_sdrs:
            raise HTTPException(status_code=400, detail="No SDRs found in the selected pod")

    if not csv_content:
        raise HTTPException(status_code=400, detail="CSV content missing")

    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    all_rows = list(reader)
    total_rows = len(all_rows)

    # Hard cap to prevent OOM on massive uploads (RCA: May 6 incident)
    MAX_UPLOAD_ROWS = 10_000
    if total_rows > MAX_UPLOAD_ROWS:
        raise HTTPException(
            status_code=400,
            detail=f"CSV exceeds the maximum of {MAX_UPLOAD_ROWS:,} rows ({total_rows:,} found). Please split into smaller files."
        )

    # If no mapping provided, use auto-detect
    if not field_mapping:
        for header in headers:
            key = header.strip().lower()
            if key in COLUMN_MAP:
                field_mapping[header] = COLUMN_MAP[key]

    # Find phone priority columns in the CSV
    phone_csv_cols = []
    for header in headers:
        if header.strip().lower() in PHONE_COLUMNS:
            phone_csv_cols.append(header)

    # Find result column for filtering
    result_col = None
    for header in headers:
        if header.strip().lower() == "result":
            result_col = header
            break

    created = 0
    skipped = 0
    updated = 0
    no_phone_skipped = 0
    errors = []
    dup_count = 0
    dup_details = []
    created_lead_ids = []  # Track IDs for AM background sync
    update_details = []
    # Batch dedup tracking sets
    seen_emails = set()
    seen_phones = set()
    seen_linkedins = set()
    seen_name_company = set()

    # Pre-fetch all existing phone digit suffixes into memory (one query, O(1) per-row lookups).
    # This avoids the N+1 regexp_replace full-table-scan that caused 30s timeouts on large imports.
    # Memory cost: ~15 chars × N leads (e.g. 11k leads ≈ 165KB) — safe, unlike loading full Lead objects.
    existing_phone_digits: set = set()
    for (ph,) in db.query(models.Lead.phone).filter(models.Lead.phone.isnot(None)).all():
        pd_db = ''.join(c for c in ph if c.isdigit())[-10:]
        if len(pd_db) >= 7:
            existing_phone_digits.add(pd_db)

    # Updatable lead fields (skip status and source fields)
    UPDATABLE_FIELDS = {
        "first_name", "last_name", "email", "phone", "phone_secondary", "company", "title",
        "linkedin_url", "person_linkedin", "website", "city", "state", "country",
        "industry", "employee_count", "annual_revenue", "total_funding",
        "company_phone", "company_linkedin", "company_street", "company_city",
        "company_postal_code", "company_state", "company_country", "company_founded"
    }

    for row_num, row in enumerate(all_rows, start=2):
        # Skip rows explicitly marked as unmatched by enrichment platforms (e.g. Apollo)
        if result_col and skip_unmatched:
            result_val = (row.get(result_col, "") or "").strip().lower()
            if result_val in ("not matched", "unmatched", "no match"):
                skipped += 1
                dup_details.append({"row": row_num, "name": "—", "reason": f"result column: {result_val}"})
                continue

        # Build lead data from mapping
        lead_data = {}
        for csv_col, lead_field in field_mapping.items():
            val = (row.get(csv_col, "") or "").strip()
            if val:
                if lead_field == "employee_count":
                    try:
                        lead_data[lead_field] = int(val)
                    except ValueError:
                        pass
                else:
                    lead_data[lead_field] = val

        # Phone priority: use first non-empty phone column, second becomes secondary
        if "phone" not in lead_data:
            for pcol in phone_csv_cols:
                val = (row.get(pcol, "") or "").strip()
                if val:
                    lead_data["phone"] = val
                    break
        # Capture secondary phone from next non-empty phone column
        if "phone_secondary" not in lead_data and lead_data.get("phone"):
            for pcol in phone_csv_cols:
                val = (row.get(pcol, "") or "").strip()
                if val and val != lead_data["phone"]:
                    lead_data["phone_secondary"] = val
                    break

        # Skip if no valid phone anywhere (phone, phone_secondary, company_phone)
        if not _lead_data_has_phone(lead_data):
            skipped += 1
            no_phone_skipped += 1
            lead_display = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip() or "Unknown"
            dup_details.append({"row": row_num, "name": lead_display, "reason": "no valid phone number"})
            continue

        # Skip if no name at all
        if not lead_data.get("last_name") and not lead_data.get("first_name"):
            skipped += 1
            dup_details.append({"row": row_num, "name": "—", "reason": "no name provided"})
            continue

        lead_display = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip() or "Unknown"

        # ── Duplicate detection (priority: Email → LinkedIn → Phone → Name+Company) ──
        email = lead_data.get("email")
        if email and not _is_valid_email(email):
            email = None  # Don't use non-email strings for dedup
        phone = lead_data.get("phone")
        linkedin = lead_data.get("linkedin_url") or lead_data.get("person_linkedin")
        first = (lead_data.get("first_name") or "").strip().lower()
        last = (lead_data.get("last_name") or "").strip().lower()
        company = (lead_data.get("company") or "").strip().lower()

        is_dup = False
        dup_reason = ""
        existing_lead = None

        # 1) Email match (strongest)
        if email and not is_dup:
            if email.lower() in seen_emails:
                is_dup = True
                dup_reason = f"email: {email}"
            else:
                existing_lead = db.query(models.Lead).filter(models.Lead.email == email).first()
                if existing_lead:
                    is_dup = True
                    dup_reason = f"email: {email}"

        # 2) LinkedIn URL match
        if linkedin and not is_dup:
            linkedin_clean = linkedin.strip().rstrip('/').lower()
            if linkedin_clean in seen_linkedins:
                is_dup = True
                dup_reason = f"linkedin: {linkedin}"
            else:
                existing_lead = db.query(models.Lead).filter(
                    (models.Lead.linkedin_url == linkedin) | (models.Lead.person_linkedin == linkedin)
                ).first()
                if existing_lead:
                    is_dup = True
                    dup_reason = f"linkedin: {linkedin}"

        # 3) Phone match (normalize to digits only)
        if phone and not is_dup:
            phone_digits = ''.join(c for c in phone if c.isdigit())[-10:]
            if phone_digits and len(phone_digits) >= 7:
                if phone_digits in seen_phones:
                    is_dup = True
                    dup_reason = f"phone: {phone}"
                else:
                    # O(1) lookup against pre-fetched in-memory set (built once before the loop).
                    # Replaces the per-row regexp_replace full-table-scan that caused 30s timeouts.
                    if phone_digits in existing_phone_digits:
                        is_dup = True
                        dup_reason = f"phone: {phone}"
                        # Only fetch the actual Lead object when update_existing needs it
                        if update_existing:
                            existing_lead = db.query(models.Lead).filter(
                                models.Lead.phone.isnot(None),
                                func.right(
                                    func.regexp_replace(models.Lead.phone, r'[^0-9]', '', 'g'),
                                    10
                                ) == phone_digits
                            ).first()

        # 4) Name + Company match (weakest)
        if first and last and company and not is_dup:
            name_co_key = f"{first}|{last}|{company}"
            if name_co_key in seen_name_company:
                is_dup = True
                dup_reason = f"name+company: {first} {last} @ {company}"
            else:
                existing_lead = db.query(models.Lead).filter(
                    models.Lead.first_name.ilike(first),
                    models.Lead.last_name.ilike(last),
                    models.Lead.company.ilike(f"%{company}%")
                ).first()
                if existing_lead:
                    is_dup = True
                    dup_reason = f"name+company: {first} {last} @ {company}"

        if is_dup:
            # ── Update existing mode: update the matching lead ──
            if update_existing and existing_lead:
                fields_updated = []
                for field, value in lead_data.items():
                    if field in UPDATABLE_FIELDS and value:
                        current_val = getattr(existing_lead, field, None)
                        if str(current_val or "").strip() != str(value).strip():
                            setattr(existing_lead, field, value)
                            fields_updated.append(field)

                # RCA 2026-07-30: update_existing only ever touched the lead's
                # fields — an existing lead matched by email/phone was never
                # assigned to the chosen SDR/pod, unlike a brand-new lead a few
                # lines below. A re-upload of already-imported leads silently
                # left them unassigned no matter who was picked in the UI.
                assigned_now = False
                if pod_sdrs:
                    already_in_pod = existing_lead.assigned_users and any(
                        u.id in {s.id for s in pod_sdrs} for u in existing_lead.assigned_users
                    )
                    if not already_in_pod:
                        existing_lead.pod_id = assign_to_pod_id
                        company_key = (lead_data.get("company") or "").strip().lower()
                        cap = _get_active_lead_cap(db, pod_sdrs[0])
                        chosen_sdr = _assign_lead_round_robin(
                            db, existing_lead, pod_sdrs, pod_batch_counts, pod_company_sdr_map, company_key, cap
                        )
                        if chosen_sdr:
                            db.execute(
                                models.lead_assignments.insert().values(user_id=chosen_sdr.id, lead_id=existing_lead.id)
                            )
                            assigned_now = True
                elif assign_user:
                    assigned_now = models.assign_lead(assign_user, existing_lead)

                if fields_updated or assigned_now:
                    updated += 1
                    reason = f"updated via {dup_reason}" if fields_updated else f"assigned via {dup_reason}"
                    update_details.append({
                        "row": row_num, "name": lead_display,
                        "reason": reason,
                        "fields": fields_updated
                    })
                else:
                    skipped += 1
                    dup_details.append({"row": row_num, "name": lead_display, "reason": f"{dup_reason} (no new data)"})
                dup_count += 1
            else:
                skipped += 1
                dup_count += 1
                dup_details.append({"row": row_num, "name": lead_display, "reason": dup_reason})
            continue

        # Track in batch sets
        if email: seen_emails.add(email.lower())
        if phone:
            pd = ''.join(c for c in phone if c.isdigit())[-10:]
            if pd: seen_phones.add(pd)
        if linkedin: seen_linkedins.add(linkedin.strip().rstrip('/').lower())
        if first and last and company: seen_name_company.add(f"{first}|{last}|{company}")

        try:
            # Savepoint: a constraint violation on this row rolls back only this
            # row — not the entire session. Same pattern as gsheet_import.
            savepoint = db.begin_nested()
            new_lead = models.Lead(
                sf_lead_id=f"upload-{uuid.uuid4().hex[:12]}",
                first_name=lead_data.get("first_name", ""),
                last_name=lead_data.get("last_name", lead_data.get("first_name", "Unknown")),
                email=email,
                phone=lead_data.get("phone"),
                phone_secondary=lead_data.get("phone_secondary"),
                company=lead_data.get("company"),
                title=lead_data.get("title"),
                status="Lead Assigned",
                lead_source=f"upload:{filename}:{datetime.now(timezone.utc).isoformat()}",
                linkedin_url=lead_data.get("linkedin_url"),
                person_linkedin=lead_data.get("person_linkedin"),
                website=lead_data.get("website"),
                city=lead_data.get("city"),
                state=lead_data.get("state"),
                country=lead_data.get("country"),
                industry=lead_data.get("industry"),
                employee_count=lead_data.get("employee_count"),
                annual_revenue=lead_data.get("annual_revenue"),
                total_funding=lead_data.get("total_funding"),
                company_phone=lead_data.get("company_phone"),
                company_linkedin=lead_data.get("company_linkedin"),
                company_street=lead_data.get("company_street"),
                company_city=lead_data.get("company_city"),
                company_postal_code=lead_data.get("company_postal_code"),
                company_state=lead_data.get("company_state"),
                company_country=lead_data.get("company_country"),
                company_founded=lead_data.get("company_founded"),
                upload_log_id=upload_log_id_value,
            )
            db.add(new_lead)
            db.flush()
            if lead_tag_objs:
                new_lead.tags = lead_tag_objs
            # Pod-based round-robin assignment (preferred)
            if pod_sdrs:
                new_lead.pod_id = assign_to_pod_id
                company_key = (lead_data.get("company") or "").strip().lower()
                cap = _get_active_lead_cap(db, pod_sdrs[0])  # Pod-level cap is same for all SDRs

                chosen_sdr = _assign_lead_round_robin(
                    db, new_lead, pod_sdrs, pod_batch_counts,
                    pod_company_sdr_map, company_key, cap
                )
                if chosen_sdr:
                    # Use direct SQL insert to avoid stale ORM relationship issues
                    db.execute(
                        models.lead_assignments.insert().values(
                            user_id=chosen_sdr.id, lead_id=new_lead.id
                        )
                    )
                # If all SDRs at cap, lead goes unassigned but still in the pod
            elif assign_user:
                # Legacy single-user assignment
                models.assign_lead(assign_user, new_lead)
            savepoint.commit()
            created += 1
            created_lead_ids.append(new_lead.id)
        except Exception as e:
            savepoint.rollback()  # Roll back ONLY this row; outer session stays clean
            import logging
            logging.getLogger(__name__).error(
                "[upload_sheet] Row %s failed: %s", row_num, str(e), exc_info=True
            )
            errors.append(f"Row {row_num}: {str(e)[:200]}")

    # Build and add the upload log BEFORE committing — same single-commit
    # atomic pattern as gsheet_import. Prevents split-brain where leads are
    # committed but the log is lost due to a transient bad connection.
    all_details = dup_details + update_details + [{"row": 0, "name": "error", "reason": e} for e in errors]
    log_status = "completed" if not errors else ("partial" if created > 0 else "failed")
    upload_log = models.LeadUploadLog(
        id=upload_log_id_value,
        uploaded_by=admin.get("sub"),
        filename=filename,
        total_rows=total_rows,
        created=created,
        skipped=skipped,
        updated=updated,
        errors=len(errors),
        error_detail=json.dumps(all_details[:50]) if all_details else None,
        status=log_status,
        tag=tag,
    )
    db.add(upload_log)
    db.commit()  # Single commit: leads + upload log are atomic

    # Fire-and-forget: sync new leads to Audience Manager (after commit)
    from audience_manager import sync_leads_to_am_background
    sync_leads_to_am_background(created_lead_ids)

    msg = f"Uploaded {created} leads."
    if updated:
        msg += f" {updated} leads updated."
    if no_phone_skipped:
        msg += f" {no_phone_skipped} skipped (no phone)."
    if dup_count and not update_existing:
        msg += f" {dup_count} duplicates skipped."
    elif skipped - no_phone_skipped > 0:
        msg += f" Skipped {skipped - no_phone_skipped} other."

    return {
        "message": msg,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "no_phone_skipped": no_phone_skipped,
        "duplicates": dup_count,
        "dup_details": dup_details,
        "update_details": update_details,
        "total_rows": total_rows,
        "errors": errors[:10],
        "log_id": upload_log.id
    }


@router.get("/leads/upload-logs")
def get_upload_logs(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=50, description="Items per page"),
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Return paginated upload history ordered by most recent, with rollback eligibility."""
    base_q = db.query(models.LeadUploadLog)
    total = base_q.count()

    # Aggregate summary stats across ALL logs (not just current page)
    summary = db.query(
        func.count(models.LeadUploadLog.id).label('total_uploads'),
        func.coalesce(func.sum(models.LeadUploadLog.total_rows), 0).label('total_rows'),
        func.coalesce(func.sum(models.LeadUploadLog.created), 0).label('total_created'),
        func.coalesce(func.sum(models.LeadUploadLog.updated), 0).label('total_updated'),
        func.coalesce(func.sum(models.LeadUploadLog.skipped), 0).label('total_skipped'),
        func.coalesce(func.sum(models.LeadUploadLog.errors), 0).label('total_errors'),
    ).first()

    logs = (base_q
            .order_by(models.LeadUploadLog.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all())

    now = datetime.now(timezone.utc)
    ROLLBACK_WINDOW_HOURS = 12
    result = []
    for log in logs:
        uploader_name = None
        if log.uploader:
            uploader_name = log.uploader.name or log.uploader.email

        # Rollback eligibility: within 12 hours, not already rolled back, had creates
        can_rollback = False
        rollback_hours_remaining = 0
        if log.created_at and log.status != "rolled_back" and (log.created or 0) > 0:
            log_age_hours = (now - log.created_at.replace(tzinfo=timezone.utc if log.created_at.tzinfo is None else log.created_at.tzinfo)).total_seconds() / 3600
            if log_age_hours < ROLLBACK_WINDOW_HOURS:
                can_rollback = True
                rollback_hours_remaining = round(ROLLBACK_WINDOW_HOURS - log_age_hours, 1)

        result.append({
            "id":           log.id,
            "filename":     log.filename,
            "uploaded_by":  uploader_name or "Unknown",
            "total_rows":   log.total_rows,
            "created":      log.created,
            "updated":      getattr(log, 'updated', 0) or 0,
            "skipped":      log.skipped,
            "errors":       log.errors,
            "error_detail": json.loads(log.error_detail) if log.error_detail else [],
            "status":       log.status,
            "tag":          getattr(log, 'tag', None),
            "created_at":   str(log.created_at) if log.created_at else None,
            "can_rollback":             can_rollback,
            "rollback_hours_remaining": rollback_hours_remaining,
        })
    return {
        "logs": result,
        "total": total,
        "page": page,
        "pages": math.ceil(total / per_page) if total else 1,
        "per_page": per_page,
        "summary": {
            "total_uploads": summary.total_uploads if summary else 0,
            "total_rows": int(summary.total_rows) if summary else 0,
            "total_created": int(summary.total_created) if summary else 0,
            "total_updated": int(summary.total_updated) if summary else 0,
            "total_skipped": int(summary.total_skipped) if summary else 0,
            "total_errors": int(summary.total_errors) if summary else 0,
        },
    }


@router.get("/leads/upload-batch-metrics")
def get_upload_batch_metrics(
    date_range: str = "all",
    pod_id: str = "",
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Return upload batch metrics summary, optionally filtered by pod and date range."""
    query = db.query(models.LeadUploadLog).order_by(models.LeadUploadLog.created_at.desc())

    if date_range == "today":
        cutoff = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(models.LeadUploadLog.created_at >= cutoff)
    elif date_range == "week":
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        query = query.filter(models.LeadUploadLog.created_at >= cutoff)
    elif date_range == "month":
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        query = query.filter(models.LeadUploadLog.created_at >= cutoff)

    logs = query.limit(100).all()
    now = datetime.now(timezone.utc)
    ROLLBACK_WINDOW_HOURS = 12
    result = []

    for log in logs:
        uploader_name = None
        if log.uploader:
            uploader_name = log.uploader.name or log.uploader.email

        can_rollback = False
        rollback_hours_remaining = 0
        if log.created_at and log.status != "rolled_back" and (log.created or 0) > 0:
            log_age_hours = (now - log.created_at.replace(
                tzinfo=timezone.utc if log.created_at.tzinfo is None else log.created_at.tzinfo
            )).total_seconds() / 3600
            if log_age_hours < ROLLBACK_WINDOW_HOURS:
                can_rollback = True
                rollback_hours_remaining = round(ROLLBACK_WINDOW_HOURS - log_age_hours, 1)

        result.append({
            "id":           log.id,
            "filename":     log.filename,
            "uploaded_by":  uploader_name or "Unknown",
            "total_rows":   log.total_rows,
            "created":      log.created,
            "updated":      getattr(log, 'updated', 0) or 0,
            "skipped":      log.skipped,
            "errors":       log.errors,
            "status":       log.status,
            "tag":          getattr(log, 'tag', None),
            "created_at":   str(log.created_at) if log.created_at else None,
            "can_rollback":             can_rollback,
            "rollback_hours_remaining": rollback_hours_remaining,
        })
    return result


@router.get("/leads/upload-batch-metrics/{log_id}/leads")
def get_upload_batch_leads(
    log_id: str,
    page: int = 1,
    per_page: int = 50,
    pod_id: str = "",
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Return paginated leads belonging to a specific upload batch, with SDR assignment detail."""


    log = db.query(models.LeadUploadLog).filter(models.LeadUploadLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Upload log not found")

    filename = log.filename or ""
    if not filename:
        return {"leads": [], "total": 0, "page": page, "per_page": per_page}

    # Derive lead_source prefix (same logic as rollback)
    if filename.startswith("gsheet-"):
        sheet_name = filename[len("gsheet-"):]
        source_prefix = f"gsheet:{sheet_name}"
    else:
        source_prefix = f"upload:{filename}"

    query = db.query(models.Lead).filter(
        models.Lead.lead_source.like(f"{source_prefix}%"),
    )

    # ── Time-scope to prevent cross-batch contamination ──
    # Multiple uploads can share the same filename (e.g. "gsheet-Google Sheet").
    # Without scoping, LIKE 'gsheet:Google Sheet%' matches ALL such uploads.
    # Fix: bound leads by created_at within ±30 min of the upload log timestamp.
    if log.created_at:
        log_time = log.created_at.replace(
            tzinfo=timezone.utc if log.created_at.tzinfo is None else log.created_at.tzinfo
        )
        window_start = log_time - timedelta(minutes=10)
        window_end = log_time + timedelta(minutes=5)
        query = query.filter(
            models.Lead.created_at >= window_start,
            models.Lead.created_at <= window_end,
        )

    # Optional pod filter
    if pod_id:
        query = query.filter(models.Lead.pod_id == pod_id)

    total = query.count()
    leads = query.order_by(models.Lead.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    lead_list = []
    for lead in leads:
        assigned_names = []
        if lead.assigned_users:
            assigned_names = [u.name or u.email for u in lead.assigned_users]

        lead_list.append({
            "id":           lead.id,
            "first_name":   lead.first_name,
            "last_name":    lead.last_name,
            "company":      lead.company,
            "email":        lead.email,
            "phone":        lead.phone,
            "status":       lead.status,
            "assigned_to":  assigned_names,
            "sdr_name":     assigned_names[0] if assigned_names else None,
            "created_at":   str(lead.created_at) if lead.created_at else None,
        })

    # ── Server-side assignment summary (accurate across ALL batch leads) ──
    # Single SQL query: GROUP BY sdr + status for per-SDR status breakdown
    # Works on both PostgreSQL and SQLite
    # Time-scoped to prevent cross-batch contamination (same fix as paginated query)
    assignment_summary = None
    try:
        time_filter = ""
        params = {"prefix": f"{source_prefix}%"}
        if log.created_at:
            time_filter = " AND l.created_at >= :window_start AND l.created_at <= :window_end"
            log_time = log.created_at.replace(
                tzinfo=timezone.utc if log.created_at.tzinfo is None else log.created_at.tzinfo
            )
            params["window_start"] = log_time - timedelta(minutes=10)
            params["window_end"] = log_time + timedelta(minutes=5)

        status_sql = text(f"""
            SELECT
                COALESCE(u.name, u.email, 'Unassigned') AS sdr_name,
                l.status,
                COUNT(*) AS cnt
            FROM leads l
            LEFT JOIN lead_assignments la ON la.lead_id = l.id
            LEFT JOIN users u ON u.id = la.user_id
            WHERE l.lead_source LIKE :prefix{time_filter}
            GROUP BY COALESCE(u.name, u.email, 'Unassigned'), l.status
            ORDER BY cnt DESC
        """)
        status_rows = db.execute(status_sql, params).fetchall()

        # Aggregate: sdr -> {total_count, statuses: {status: count}}
        sdr_data = {}  # sdr_name -> {"count": int, "statuses": {status: count}}
        for row in status_rows:
            sdr_name, status, cnt = row[0], row[1], row[2]
            if sdr_name not in sdr_data:
                sdr_data[sdr_name] = {"count": 0, "statuses": {}}
            sdr_data[sdr_name]["count"] += cnt
            sdr_data[sdr_name]["statuses"][status] = cnt

        # Sort by lead count descending
        assignment_summary = [
            {"sdr": sdr, "count": info["count"], "statuses": info["statuses"]}
            for sdr, info in sorted(sdr_data.items(), key=lambda x: x[1]["count"], reverse=True)
        ]
    except Exception as e:
        logger.warning(f"Assignment summary query failed: {e}")
        assignment_summary = None

    return {
        "leads": lead_list,
        "total": total,
        "page": page,
        "per_page": per_page,
        "filename": filename,
        "uploaded_by": (log.uploader.name or log.uploader.email) if log.uploader else "Unknown",
        "assignment_summary": assignment_summary,
    }


@router.post("/leads/upload-logs/{log_id}/rollback")
def rollback_upload_batch(
    log_id: str,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Rollback (hard-delete) leads created by a specific upload batch.
    Safety rules:
      - Only allowed within 12 hours of upload
      - Only deletes leads still in safe statuses (Lead Assigned, Research, No Phone - Parked)
      - Leads that have been called, moved beyond Research, or have meetings are PROTECTED
      - Uses SELECT FOR UPDATE to prevent race conditions
    """


    ROLLBACK_WINDOW_HOURS = 12
    SAFE_STATUSES = {"Lead Assigned", "Research", "No Phone - Parked"}

    # Lock the log row to prevent concurrent rollback
    log = db.query(models.LeadUploadLog).filter(
        models.LeadUploadLog.id == log_id
    ).with_for_update().first()

    if not log:
        raise HTTPException(status_code=404, detail="Upload log not found")
    if log.status == "rolled_back":
        raise HTTPException(status_code=400, detail="This batch has already been rolled back")
    if not log.created_at:
        raise HTTPException(status_code=400, detail="Upload log has no timestamp")

    log_time = log.created_at.replace(tzinfo=timezone.utc if log.created_at.tzinfo is None else log.created_at.tzinfo)
    age_hours = (datetime.now(timezone.utc) - log_time).total_seconds() / 3600
    if age_hours > ROLLBACK_WINDOW_HOURS:
        raise HTTPException(
            status_code=403,
            detail=f"Rollback window expired ({ROLLBACK_WINDOW_HOURS}h). Upload was {round(age_hours, 1)}h ago."
        )

    # Find leads created by this batch
    # CSV: lead_source = "upload:{filename}:{timestamp}", log.filename = original CSV name
    # GSheet: lead_source = "gsheet:{sheet_name}:{timestamp}", log.filename = "gsheet-{sheet_name}"
    filename = log.filename or ""
    if not filename:
        raise HTTPException(status_code=400, detail="Upload log has no filename — cannot identify batch leads")

    # Derive the lead_source prefix based on the filename pattern
    if filename.startswith("gsheet-"):
        # GSheet import: filename = "gsheet-MySheet", lead_source = "gsheet:MySheet:..."
        sheet_name = filename[len("gsheet-"):]
        source_prefix = f"gsheet:{sheet_name}"
    else:
        # CSV upload: filename = "file.csv", lead_source = "upload:file.csv:..."
        source_prefix = f"upload:{filename}"

    batch_leads = db.query(models.Lead).filter(
        models.Lead.lead_source.like(f"{source_prefix}%"),
    ).all()

    rolled_back = 0
    protected = []
    protected_reasons = {}

    for lead in batch_leads:
        # Check if lead is in a safe status
        if lead.status not in SAFE_STATUSES:
            protected.append(lead.id)
            protected_reasons[lead.id] = f"Status progressed to '{lead.status}'"
            continue

        # Check if lead has ever been called
        call_count = db.execute(
            text("SELECT COUNT(*) FROM call_logs WHERE lead_id = :lid"),
            {"lid": lead.id}
        ).scalar() or 0
        dialer_count = db.execute(
            text("SELECT COUNT(*) FROM dialer_calls WHERE lead_id = :lid"),
            {"lid": lead.id}
        ).scalar() or 0

        if call_count + dialer_count > 0:
            protected.append(lead.id)
            protected_reasons[lead.id] = f"Has {call_count + dialer_count} call(s)"
            continue

        # Safe to delete — CASCADE handles children
        db.delete(lead)
        rolled_back += 1

    # Update log status
    log.status = "rolled_back"
    db.commit()

    return {
        "message": f"Rolled back {rolled_back} lead(s). {len(protected)} protected.",
        "rolled_back": rolled_back,
        "protected": len(protected),
        "protected_details": [
            {"lead_id": lid, "reason": protected_reasons.get(lid, "Unknown")}
            for lid in protected[:20]  # cap details at 20
        ],
    }


# ── Google Sheets Import ─────────────────────────────────────────────────────

GSHEET_URL_PATTERN = re.compile(
    r"https?://docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)"
)
GSHEET_GID_PATTERN = re.compile(r"[#&?]gid=(\d+)")


def _extract_gsheet_id(url: str):
    """Extract spreadsheet ID from a Google Sheets URL."""
    match = GSHEET_URL_PATTERN.search(url)
    return match.group(1) if match else None


def _extract_gsheet_gid(url: str):
    """Extract the tab (gid) from a Google Sheets URL, if present.

    RCA 2026-08-10: the export URL was always built without a gid, so a
    link to a specific tab (e.g. "...#gid=486071753") silently imported
    the spreadsheet's default tab instead — a multi-tab sheet's real,
    linked content could go untouched indefinitely with no error surfaced.
    gid shows up either as a query param (?gid=123) or a URL fragment
    (#gid=123); this matches both.
    """
    match = GSHEET_GID_PATTERN.search(url)
    return match.group(1) if match else None


def _build_gsheet_export_url(sheet_id: str, url: str) -> str:
    """CSV export URL for a sheet, passing through the source url's gid (tab) if present."""
    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    gid = _extract_gsheet_gid(url)
    return f"{export_url}&gid={gid}" if gid else export_url


@router.post("/leads/upload-gsheet")
def gsheet_preview(body: dict, admin: dict = Depends(require_admin)):
    """Fetch a public Google Sheet as CSV and return preview data."""
    import httpx

    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    sheet_id = _extract_gsheet_id(url)
    if not sheet_id:
        raise HTTPException(
            status_code=400,
            detail=json.dumps({"error_code": "invalid_url",
                               "message": "Please enter a valid Google Sheets URL (e.g. https://docs.google.com/spreadsheets/d/...)"})
        )

    # Fetch CSV export — pass the linked tab's gid through if the URL has one,
    # else this silently falls back to the spreadsheet's default tab.
    export_url = _build_gsheet_export_url(sheet_id, url)
    try:
        resp = httpx.get(export_url, follow_redirects=True, timeout=30)
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=json.dumps({"error_code": "network_timeout",
                               "message": "Could not connect to Google Sheets. Please check your internet connection and try again."})
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=502,
            detail=json.dumps({"error_code": "network_error",
                               "message": f"Failed to fetch sheet: {str(e)}"})
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=json.dumps({"error_code": "access_denied",
                               "message": "This sheet is not accessible. Make sure it's shared as \"Anyone with the link can view\"."})
        )

    csv_content = resp.text
    if not csv_content or len(csv_content.strip()) < 5:
        raise HTTPException(
            status_code=400,
            detail=json.dumps({"error_code": "empty_sheet",
                               "message": "This sheet appears to be empty. 0 data rows found."})
        )

    # Parse CSV
    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    all_rows = list(reader)
    total_rows = len(all_rows)

    if total_rows == 0:
        raise HTTPException(
            status_code=400,
            detail=json.dumps({"error_code": "empty_sheet",
                               "message": "This sheet appears to be empty. 0 data rows found. Make sure your sheet has data starting from row 2 (row 1 = headers)."})
        )

    # Auto-detect mapping
    auto_mapping = {}
    for header in headers:
        key = header.strip().lower()
        if key in COLUMN_MAP:
            auto_mapping[header] = COLUMN_MAP[key]

    # Phone column detection — warn if no phone column mapped
    phone_fields = {"phone", "phone_secondary", "company_phone"}
    phone_column_detected = any(v in phone_fields for v in auto_mapping.values())

    # Count rows without any phone value
    phone_mapped_headers = [h for h, v in auto_mapping.items() if v in phone_fields]
    phone_fallback_headers = [h for h in headers if h.strip().lower() in PHONE_COLUMNS]
    all_phone_headers = list(set(phone_mapped_headers + phone_fallback_headers))
    rows_without_phone = 0
    for row in all_rows:
        has_phone = False
        for ph in all_phone_headers:
            val = (row.get(ph, "") or "").strip()
            if _has_valid_phone(val):
                has_phone = True
                break
        if not has_phone:
            rows_without_phone += 1

    return {
        "sheet_id": sheet_id,
        "sheet_name": "Google Sheet",
        "headers": headers,
        "total_rows": total_rows,
        "preview_rows": all_rows[:5],
        "auto_mapping": auto_mapping,
        "phone_column_detected": phone_column_detected,
        "rows_without_phone": rows_without_phone,
        "large_sheet": total_rows > 5000,
        "available_fields": [
            "first_name", "last_name", "email", "phone", "phone_secondary", "company", "title",
            "linkedin_url", "person_linkedin", "website", "city", "state", "country",
            "industry", "employee_count", "annual_revenue", "total_funding",
            "company_phone", "company_linkedin", "company_street", "company_city",
            "company_postal_code", "company_state", "company_country", "company_founded"
        ]
    }


@router.post("/leads/import-gsheet")
def gsheet_import(body: dict, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """Import leads from a public Google Sheet. Reuses CSV dedup logic from upload-sheet."""
    import httpx

    url = (body.get("url") or "").strip()
    field_mapping = body.get("mapping", {})
    update_existing = body.get("update_existing", False)
    sheet_name = body.get("sheet_name", "Google Sheet")
    assign_to_user_id = body.get("assign_to_user_id")  # Legacy single SDR assignment
    assign_to_pod_id = body.get("assign_to_pod_id")     # Pod-based round-robin assignment
    tag = (body.get("tag") or "").strip()[:50] or None   # V26: optional upload tag
    lead_tag_names = list(dict.fromkeys(
        t.strip() for t in (body.get("tags") or []) if isinstance(t, str) and t.strip()
    ))  # Leads redesign: per-lead tags (independent of the upload-level `tag` above)
    lead_tag_objs = []
    for name in lead_tag_names:
        tag_obj = db.query(models.Tag).filter(models.Tag.name == name).first()
        if not tag_obj:
            tag_obj = models.Tag(name=name)
            db.add(tag_obj)
            db.flush()
        lead_tag_objs.append(tag_obj)
    upload_log_id_value = models.generate_uuid()  # generated upfront so leads can reference it below

    # Look up SDR user if assign_to_user_id is provided (backward compat)
    assign_user = None
    if assign_to_user_id:
        assign_user = db.query(models.User).filter(models.User.id == assign_to_user_id).first()

    # Pod-based assignment: fetch SDRs in the pod for round-robin
    gs_pod_sdrs = []
    gs_batch_counts = {}     # sdr_id -> count of leads assigned in THIS batch (for fairness)
    gs_company_sdr_map = {}  # company_key -> sdr, so same-company leads go to same SDR
    if assign_to_pod_id:
        gs_pod_sdrs = db.query(models.User).filter(
            models.User.pod_id == assign_to_pod_id,
            models.User.role.in_(["SDR", "AE"])
        ).all()
        if not gs_pod_sdrs:
            raise HTTPException(status_code=400, detail="No SDRs found in the selected pod")

    sheet_id = _extract_gsheet_id(url)
    if not sheet_id:
        raise HTTPException(status_code=400, detail="Invalid Google Sheets URL")

    # Fresh fetch — same gid pass-through as the preview endpoint above.
    export_url = _build_gsheet_export_url(sheet_id, url)
    try:
        resp = httpx.get(export_url, follow_redirects=True, timeout=60)
    except (httpx.TimeoutException, httpx.RequestError) as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch sheet: {str(e)}")

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not access the Google Sheet")

    csv_content = resp.text
    timestamp = datetime.now(timezone.utc).isoformat()
    gsheet_source = f"gsheet:{sheet_name}:{timestamp}"
    gsheet_filename = f"gsheet-{sheet_name}"

    # Process CSV (same dedup logic as upload_enriched_sheet)
    reader = csv.DictReader(io.StringIO(csv_content))
    headers = reader.fieldnames or []
    all_rows = list(reader)
    total_rows = len(all_rows)

    if not field_mapping:
        for header in headers:
            key = header.strip().lower()
            if key in COLUMN_MAP:
                field_mapping[header] = COLUMN_MAP[key]

    phone_csv_cols = [h for h in headers if h.strip().lower() in PHONE_COLUMNS]

    created = 0
    skipped = 0
    updated = 0
    no_phone_skipped = 0
    errors = []
    dup_count = 0
    dup_details = []
    update_details = []
    created_lead_ids = []  # Track IDs for AM background sync
    seen_emails = set()
    seen_phones = set()
    seen_linkedins = set()
    seen_name_company = set()

    # Pre-fetch all existing phone digit suffixes for O(1) dedup lookups (avoids N+1 regexp_replace queries).
    # Loads only phone strings (~15 chars each), not full Lead objects — no OOM risk.
    existing_phone_digits: set = set()
    for (ph,) in db.query(models.Lead.phone).filter(models.Lead.phone.isnot(None)).all():
        pd_db = ''.join(c for c in ph if c.isdigit())[-10:]
        if len(pd_db) >= 7:
            existing_phone_digits.add(pd_db)

    UPDATABLE_FIELDS = {
        "first_name", "last_name", "email", "phone", "company", "title",
        "linkedin_url", "person_linkedin", "website", "city", "state", "country",
        "industry", "employee_count", "annual_revenue", "total_funding",
        "company_phone", "company_linkedin", "company_street", "company_city",
        "company_postal_code", "company_state", "company_country", "company_founded"
    }

    for row_num, row in enumerate(all_rows, start=2):
        lead_data = {}
        for csv_col, lead_field in field_mapping.items():
            val = (row.get(csv_col, "") or "").strip()
            if val:
                if lead_field == "employee_count":
                    try:
                        lead_data[lead_field] = int(val)
                    except ValueError:
                        pass
                else:
                    lead_data[lead_field] = val

        if "phone" not in lead_data:
            for pcol in phone_csv_cols:
                val = (row.get(pcol, "") or "").strip()
                if val:
                    lead_data["phone"] = val
                    break

        # Skip if no valid phone anywhere (phone, phone_secondary, company_phone)
        if not _lead_data_has_phone(lead_data):
            skipped += 1
            no_phone_skipped += 1
            lead_display = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip() or "Unknown"
            dup_details.append({"row": row_num, "name": lead_display, "reason": "no valid phone number"})
            continue

        if not lead_data.get("last_name") and not lead_data.get("first_name"):
            skipped += 1
            dup_details.append({"row": row_num, "name": "—", "reason": "no name provided"})
            continue

        lead_display = f"{lead_data.get('first_name', '')} {lead_data.get('last_name', '')}".strip() or "Unknown"

        # ── Duplicate detection ──
        email = lead_data.get("email")
        if email and not _is_valid_email(email):
            email = None  # Don't use non-email strings for dedup
        phone = lead_data.get("phone")
        linkedin = lead_data.get("linkedin_url") or lead_data.get("person_linkedin")
        first = (lead_data.get("first_name") or "").strip().lower()
        last = (lead_data.get("last_name") or "").strip().lower()
        company = (lead_data.get("company") or "").strip().lower()

        is_dup = False
        dup_reason = ""
        existing_lead = None

        if email and not is_dup:
            if email.lower() in seen_emails:
                is_dup, dup_reason = True, f"email: {email}"
            else:
                existing_lead = db.query(models.Lead).filter(models.Lead.email == email).first()
                if existing_lead:
                    is_dup, dup_reason = True, f"email: {email}"

        if linkedin and not is_dup:
            linkedin_clean = linkedin.strip().rstrip('/').lower()
            if linkedin_clean in seen_linkedins:
                is_dup, dup_reason = True, f"linkedin: {linkedin}"
            else:
                existing_lead = db.query(models.Lead).filter(
                    (models.Lead.linkedin_url == linkedin) | (models.Lead.person_linkedin == linkedin)
                ).first()
                if existing_lead:
                    is_dup, dup_reason = True, f"linkedin: {linkedin}"

        if phone and not is_dup:
            phone_digits = ''.join(c for c in phone if c.isdigit())[-10:]
            if phone_digits and len(phone_digits) >= 7:
                if phone_digits in seen_phones:
                    is_dup, dup_reason = True, f"phone: {phone}"
                else:
                    # O(1) lookup against pre-fetched in-memory set (built once before the loop).
                    # Replaces the per-row regexp_replace full-table-scan that caused 30s timeouts.
                    if phone_digits in existing_phone_digits:
                        is_dup, dup_reason = True, f"phone: {phone}"
                        # Only fetch the actual Lead object when update_existing needs it
                        if update_existing:
                            existing_lead = db.query(models.Lead).filter(
                                models.Lead.phone.isnot(None),
                                func.right(
                                    func.regexp_replace(models.Lead.phone, r'[^0-9]', '', 'g'),
                                    10
                                ) == phone_digits
                            ).first()

        if first and last and company and not is_dup:
            name_co_key = f"{first}|{last}|{company}"
            if name_co_key in seen_name_company:
                is_dup, dup_reason = True, f"name+company: {first} {last} @ {company}"
            else:
                existing_lead = db.query(models.Lead).filter(
                    models.Lead.first_name.ilike(first),
                    models.Lead.last_name.ilike(last),
                    models.Lead.company.ilike(f"%{company}%")
                ).first()
                if existing_lead:
                    is_dup, dup_reason = True, f"name+company: {first} {last} @ {company}"

        if is_dup:
            if update_existing and existing_lead:
                fields_updated = []
                for field, value in lead_data.items():
                    if field in UPDATABLE_FIELDS and value:
                        if str(getattr(existing_lead, field, None) or "").strip() != str(value).strip():
                            setattr(existing_lead, field, value)
                            fields_updated.append(field)

                # RCA 2026-07-30: update_existing only ever touched the lead's
                # fields — an existing lead matched by email/phone was never
                # assigned to the chosen SDR/pod, unlike a brand-new lead a few
                # lines below. A re-upload of already-imported leads silently
                # left them unassigned no matter who was picked in the UI.
                assigned_now = False
                if gs_pod_sdrs:
                    already_in_pod = existing_lead.assigned_users and any(
                        u.id in {s.id for s in gs_pod_sdrs} for u in existing_lead.assigned_users
                    )
                    if not already_in_pod:
                        existing_lead.pod_id = assign_to_pod_id
                        company_key = (lead_data.get("company") or "").strip().lower()
                        cap = _get_active_lead_cap(db, gs_pod_sdrs[0])
                        chosen_sdr = _assign_lead_round_robin(
                            db, existing_lead, gs_pod_sdrs, gs_batch_counts, gs_company_sdr_map, company_key, cap
                        )
                        if chosen_sdr:
                            db.execute(
                                models.lead_assignments.insert().values(user_id=chosen_sdr.id, lead_id=existing_lead.id)
                            )
                            assigned_now = True
                elif assign_user:
                    assigned_now = models.assign_lead(assign_user, existing_lead)

                if fields_updated or assigned_now:
                    updated += 1
                    reason = f"updated via {dup_reason}" if fields_updated else f"assigned via {dup_reason}"
                    update_details.append({"row": row_num, "name": lead_display, "reason": reason, "fields": fields_updated})
                else:
                    skipped += 1
                    dup_details.append({"row": row_num, "name": lead_display, "reason": f"{dup_reason} (no new data)"})
                dup_count += 1
            else:
                skipped += 1
                dup_count += 1
                dup_details.append({"row": row_num, "name": lead_display, "reason": dup_reason})
            continue

        if email: seen_emails.add(email.lower())
        if phone:
            pd_val = ''.join(c for c in phone if c.isdigit())[-10:]
            if pd_val: seen_phones.add(pd_val)
        if linkedin: seen_linkedins.add(linkedin.strip().rstrip('/').lower())
        if first and last and company: seen_name_company.add(f"{first}|{last}|{company}")

        try:
            # Use a savepoint so a constraint violation on THIS row only rolls back
            # this row — not the entire session. Without this, a single IntegrityError
            # leaves the session in a broken state and db.commit() crashes with
            # PendingRollbackError (HTTP 500) for the whole import.
            savepoint = db.begin_nested()
            new_lead = models.Lead(
                sf_lead_id=f"upload-{uuid.uuid4().hex[:12]}",
                first_name=lead_data.get("first_name", ""),
                last_name=lead_data.get("last_name", lead_data.get("first_name", "Unknown")),
                email=email, phone=lead_data.get("phone"),
                phone_secondary=lead_data.get("phone_secondary"),
                company=lead_data.get("company"), title=lead_data.get("title"),
                status="Lead Assigned", lead_source=gsheet_source,
                linkedin_url=lead_data.get("linkedin_url"), person_linkedin=lead_data.get("person_linkedin"),
                website=lead_data.get("website"), city=lead_data.get("city"),
                state=lead_data.get("state"), country=lead_data.get("country"),
                industry=lead_data.get("industry"), employee_count=lead_data.get("employee_count"),
                annual_revenue=lead_data.get("annual_revenue"), total_funding=lead_data.get("total_funding"),
                company_phone=lead_data.get("company_phone"), company_linkedin=lead_data.get("company_linkedin"),
                company_street=lead_data.get("company_street"), company_city=lead_data.get("company_city"),
                company_postal_code=lead_data.get("company_postal_code"), company_state=lead_data.get("company_state"),
                company_country=lead_data.get("company_country"), company_founded=lead_data.get("company_founded"),
                upload_log_id=upload_log_id_value,
            )
            db.add(new_lead)
            db.flush()
            if lead_tag_objs:
                new_lead.tags = lead_tag_objs
            # Pod-based round-robin assignment (preferred)
            if gs_pod_sdrs:
                new_lead.pod_id = assign_to_pod_id
                company_key = (lead_data.get("company") or "").strip().lower()
                cap = _get_active_lead_cap(db, gs_pod_sdrs[0])  # Pod-level cap is same for all SDRs

                chosen_sdr = _assign_lead_round_robin(
                    db, new_lead, gs_pod_sdrs, gs_batch_counts,
                    gs_company_sdr_map, company_key, cap
                )
                if chosen_sdr:
                    # Use direct SQL insert to avoid stale ORM relationship issues
                    db.execute(
                        models.lead_assignments.insert().values(
                            user_id=chosen_sdr.id, lead_id=new_lead.id
                        )
                    )
            elif assign_user:
                # Legacy single-user assignment
                models.assign_lead(assign_user, new_lead)
            savepoint.commit()
            created += 1
            created_lead_ids.append(new_lead.id)
        except Exception as e:
            savepoint.rollback()  # Roll back ONLY this row; outer session stays clean
            import logging
            logging.getLogger(__name__).error(
                "[gsheet_import] Row %s failed: %s", row_num, str(e), exc_info=True
            )
            errors.append(f"Row {row_num}: {str(e)[:200]}")

    # Build and add the upload log BEFORE committing so leads + log are a single
    # atomic transaction. The previous split-commit (leads commit → log commit)
    # left the DB in a split-brain state when a transient connection error hit
    # between the two commits: leads were persisted but the log was lost.
    all_details = dup_details + update_details + [{"row": 0, "name": "error", "reason": e} for e in errors]
    log_status = "completed" if not errors else ("partial" if created > 0 else "failed")
    upload_log = models.LeadUploadLog(
        id=upload_log_id_value,
        uploaded_by=admin.get("sub"), filename=gsheet_filename,
        total_rows=total_rows, created=created, skipped=skipped, updated=updated,
        errors=len(errors), error_detail=json.dumps(all_details[:50]) if all_details else None,
        status=log_status, tag=tag,
    )
    db.add(upload_log)
    db.commit()  # Single commit: leads + upload log are atomic

    # Fire-and-forget: sync new leads to Audience Manager (after commit)
    from audience_manager import sync_leads_to_am_background
    sync_leads_to_am_background(created_lead_ids)

    msg = f"Imported {created} leads from Google Sheets."
    if updated: msg += f" {updated} leads updated."
    if no_phone_skipped: msg += f" {no_phone_skipped} skipped (no phone)."
    if dup_count and not update_existing: msg += f" {dup_count} duplicates skipped."
    elif skipped - no_phone_skipped > 0: msg += f" Skipped {skipped - no_phone_skipped} other."

    return {
        "message": msg, "created": created, "updated": updated, "skipped": skipped,
        "no_phone_skipped": no_phone_skipped,
        "duplicates": dup_count, "dup_details": dup_details, "update_details": update_details,
        "total_rows": total_rows, "errors": errors[:10], "log_id": upload_log.id
    }


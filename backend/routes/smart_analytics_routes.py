"""
Smart Analytics Routes v2 — /api/admin/smart-analytics
========================================================
5 endpoints:
  POST   /query              — NL query + conversation history → analytics result
  GET    /reports            — List saved reports (own; Super Admin sees all)
  POST   /reports            — Save a report
  DELETE /reports/{id}       — Delete saved report (own only)
  POST   /reports/{id}/run   — Re-run saved report
  GET    /history            — Last 5 query history items for current user
"""

import json
import logging
import time
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from auth import require_admin
import models
from services.smart_analytics import (
    parse_nl_to_dsl,
    validate_dsl,
    execute_dsl,
    log_query,
    resolve_sdrs,
    resolve_pods,
    resolve_batches,
    SmartAnalyticsError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/smart-analytics", tags=["Smart Analytics"])


# ─── Request/Response schemas ─────────────────────────────────────────────────

class ConversationMessage(BaseModel):
    role:    str          # "user" | "assistant"
    content: str


class QueryRequest(BaseModel):
    query:                str
    conversation_history: Optional[List[ConversationMessage]] = Field(default=None)
    # UI-level context filters — set when user picks a pod/batch from the dropdown.
    # These are injected into the DSL after LLM parsing, overriding LLM if needed.
    filter_pod:           Optional[str] = None
    filter_batch:         Optional[str] = None


class SaveReportRequest(BaseModel):
    name:                   str
    natural_language_query: str
    dsl_json:               str        # JSON string — never SQL
    chart_type:             Optional[str] = None
    skip_dsl_validation:    bool = False  # set True when auto-saving for pin (NL query is source of truth)


class PinReportRequest(BaseModel):
    pinned: bool


# ─── Endpoint 1: NL Query ────────────────────────────────────────────────────

@router.post("/query")
def smart_query(
    payload: QueryRequest,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Convert a natural language question to analytics results.

    v2 Flow:
      1. resolve_sdrs()        → load active SDR names for LLM context
      2. parse_nl_to_dsl()     → DSL dict (Groq, JSON only, with conversation history)
      3. validate_dsl()        → strict allowlist check
      4. execute_dsl()         → dispatch to mode handler (standard/ranking/compare/multi/funnel)
      5. log_query()           → analytics_query_history

    Request body:
      query                   — natural language question
      conversation_history    — list of {role, content} for follow-up context

    Returns:
      - On success: {mode, data/results/steps, chart_type, metric, period, ...}
      - On clarify: {action: "clarify", question: "..."}
      - On unsupported: {action: "unsupported", message: "..."}
    """
    nl_query = (payload.query or "").strip()
    if not nl_query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    if len(nl_query) > 500:
        raise HTTPException(status_code=400, detail="Query too long (max 500 characters).")

    t_start = time.time()
    dsl     = None
    error   = None

    try:
        # Step 1: Load context for LLM
        sdrs      = resolve_sdrs(db)
        pods      = resolve_pods(db)
        batches   = resolve_batches(db)
        sdr_names = [s["name"] for s in sdrs]
        pod_names = [p["name"] for p in pods]
        batch_labels = [b["label"] for b in batches]

        # Step 2: Build conversation history for LLM
        history = None
        if payload.conversation_history:
            history = [
                {"role": m.role, "content": m.content}
                for m in payload.conversation_history[-6:]
            ]

        # Step 3: NL → DSL
        dsl = parse_nl_to_dsl(nl_query, db,
                               conversation_history=history,
                               sdr_names=sdr_names,
                               pod_names=pod_names,
                               batch_labels=batch_labels)

        # Pass-through for clarify / unsupported (still log)
        if dsl.get("action") in ("clarify", "unsupported"):
            log_query(db, admin["sub"], nl_query, dsl, success=True,
                      exec_ms=int((time.time() - t_start) * 1000), error=None)
            return dsl

        # Step 3b: Inject explicit UI-level context filters into DSL.
        # These override the LLM's inferred filters — the UI dropdown is the user's
        # explicit intent, so it always wins. Only set if not already set by LLM.
        if payload.filter_pod and not dsl.get("filter_pod"):
            dsl["filter_pod"] = payload.filter_pod
        if payload.filter_batch and not dsl.get("filter_batch"):
            dsl["filter_batch"] = payload.filter_batch

        # Step 4: Validate
        validate_dsl(dsl)

        # Step 4b: validate_dsl may have converted a bad DSL to clarify (lenient mode).
        # Re-check and return early — the same as the pre-validate pass-through above.
        if dsl.get("action") in ("clarify", "unsupported"):
            log_query(db, admin["sub"], nl_query, dsl, success=True,
                      exec_ms=int((time.time() - t_start) * 1000), error=None)
            return dsl

        # Step 5: Execute (with SDR, pod, batch lists)
        result = execute_dsl(dsl, admin, db, sdrs=sdrs, pods=pods, batches=batches)

        exec_ms = int((time.time() - t_start) * 1000)
        log_query(db, admin["sub"], nl_query, dsl, success=True, exec_ms=exec_ms, error=None)
        # Include the resolved DSL in the response so the frontend can save/pin it
        return {**result, "dsl": dsl}

    except SmartAnalyticsError as exc:
        error   = exc.user_message
        exec_ms = int((time.time() - t_start) * 1000)
        log_query(db, admin["sub"], nl_query, dsl, success=False, exec_ms=exec_ms, error=error)
        raise HTTPException(status_code=422, detail={"error": exc.code, "message": exc.user_message})

    except Exception as exc:
        error   = str(exc)
        exec_ms = int((time.time() - t_start) * 1000)
        logger.exception("smart_analytics: unhandled error for query=%r: %s", nl_query[:60], exc)
        log_query(db, admin["sub"], nl_query, dsl, success=False, exec_ms=exec_ms, error=error)
        raise HTTPException(status_code=500, detail={"error": "server_error", "message": "An unexpected error occurred."})


# ─── Endpoint 2: List Saved Reports ──────────────────────────────────────────

@router.get("/reports")
def list_reports(
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    List saved reports.
    Super Admins see all. Others see their own only.
    """
    q = db.query(models.AnalyticsSavedReport)
    if admin.get("role") != "Super Admin":
        q = q.filter(models.AnalyticsSavedReport.created_by == admin["sub"])

    reports = q.order_by(models.AnalyticsSavedReport.updated_at.desc()).all()
    return [
        {
            "id":                     r.id,
            "name":                   r.name,
            "natural_language_query": r.natural_language_query,
            "dsl_json":               r.dsl_json,
            "chart_type":             r.chart_type,
            "is_pinned":              bool(r.is_pinned),
            "pin_order":              r.pin_order or 0,
            "role_scope":             r.role_scope,
            "created_at":             r.created_at.isoformat() if r.created_at else None,
            "updated_at":             r.updated_at.isoformat() if r.updated_at else None,
            "own":                    r.created_by == admin["sub"],
        }
        for r in reports
    ]


# ─── Endpoint 3: Save Report ─────────────────────────────────────────────────

@router.post("/reports")
def save_report(
    payload: SaveReportRequest,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Save a Smart Analytics report. Never stores SQL — DSL JSON only.
    """
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Report name cannot be empty.")

    try:
        dsl = json.loads(payload.dsl_json)
        if not payload.skip_dsl_validation:
            validate_dsl(dsl)
            # validate_dsl is lenient for AI queries — it converts bad input to clarify.
            # For saved reports (user-provided DSL), we must reject clarified DSLs strictly.
            if dsl.get("action") in ("clarify", "unsupported"):
                raise HTTPException(status_code=400, detail="Invalid DSL: unsupported metric, mode, or action.")
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid DSL JSON.")
    except SmartAnalyticsError as exc:
        raise HTTPException(status_code=400, detail=exc.user_message)

    report = models.AnalyticsSavedReport(
        name=payload.name.strip(),
        created_by=admin["sub"],
        role_scope=admin.get("role", "").lower().replace(" ", "_"),
        natural_language_query=payload.natural_language_query,
        dsl_json=payload.dsl_json,
        chart_type=payload.chart_type,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    logger.info("smart_analytics: saved report id=%s name=%r by user=%s", report.id, report.name, admin["sub"])
    return {
        "id":         report.id,
        "name":       report.name,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }



# ─── Endpoint 4a: Pin / Unpin Report ─────────────────────────────────────────

PIN_LIMIT = 5  # max pinned reports per user (EC-4)

@router.patch("/reports/{report_id}/pin")
def pin_report(
    report_id: str,
    payload: PinReportRequest,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Toggle is_pinned on a saved report.
    - Only the owner or a Super Admin can pin/unpin.
    - Cap: a user may not have more than PIN_LIMIT pinned reports (EC-4).
    - Idempotent: pinning an already-pinned report is a no-op (EC-6).
    """
    report = db.query(models.AnalyticsSavedReport).filter(
        models.AnalyticsSavedReport.id == report_id
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if admin.get("role") != "Super Admin" and report.created_by != admin["sub"]:
        raise HTTPException(status_code=403, detail="You can only pin your own reports.")

    if payload.pinned and not report.is_pinned:
        # Enforce pin cap — count current pins by this user (EC-4)
        pinned_count = db.query(models.AnalyticsSavedReport).filter(
            models.AnalyticsSavedReport.created_by == admin["sub"],
            models.AnalyticsSavedReport.is_pinned.is_(True),
        ).count()
        if pinned_count >= PIN_LIMIT:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "pin_limit_exceeded",
                    "message": f"You can pin at most {PIN_LIMIT} reports. Unpin one to add another.",
                },
            )
        # Assign pin_order = max existing pin_order + 1 for new pins
        max_order = db.query(models.AnalyticsSavedReport).filter(
            models.AnalyticsSavedReport.created_by == admin["sub"],
            models.AnalyticsSavedReport.is_pinned.is_(True),
        ).count()
        report.pin_order = max_order  # 0-indexed sequential

    report.is_pinned = payload.pinned
    if not payload.pinned:
        report.pin_order = 0  # reset order when unpinned
    db.commit()
    db.refresh(report)

    logger.info(
        "smart_analytics: report id=%s %s by user=%s",
        report.id, "pinned" if payload.pinned else "unpinned", admin["sub"]
    )
    return {
        "id":        report.id,
        "name":      report.name,
        "is_pinned": report.is_pinned,
        "pin_order": report.pin_order,
    }


# ─── Endpoint 4b: List Pinned Reports ────────────────────────────────────────

@router.get("/reports/pinned")
def list_pinned_reports(
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Return all pinned reports for the requesting user, ordered by pin_order ASC.
    Pinned state is per-user — no cross-user leakage (EC-5).
    Super Admins see their own pins only (not all users' pins).
    """
    reports = db.query(models.AnalyticsSavedReport).filter(
        models.AnalyticsSavedReport.created_by == admin["sub"],
        models.AnalyticsSavedReport.is_pinned.is_(True),
    ).order_by(
        models.AnalyticsSavedReport.pin_order.asc(),
        models.AnalyticsSavedReport.updated_at.desc(),
    ).all()

    return [
        {
            "id":                     r.id,
            "name":                   r.name,
            "natural_language_query": r.natural_language_query,
            "dsl_json":               r.dsl_json,
            "chart_type":             r.chart_type,
            "is_pinned":              True,
            "pin_order":              r.pin_order or 0,
            "updated_at":             r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in reports
    ]


# ─── Endpoint 4: Delete Saved Report ─────────────────────────────────────────

@router.delete("/reports/{report_id}")
def delete_report(
    report_id: str,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Delete a saved report. Users can only delete their own reports.
    Super Admins can delete any report.
    """
    report = db.query(models.AnalyticsSavedReport).filter(
        models.AnalyticsSavedReport.id == report_id
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if admin.get("role") != "Super Admin" and report.created_by != admin["sub"]:
        raise HTTPException(status_code=403, detail="You can only delete your own reports.")

    db.delete(report)
    db.commit()
    return {"deleted": True, "id": report_id}


# ─── Endpoint 5: Re-run Saved Report ─────────────────────────────────────────

@router.post("/reports/{report_id}/run")
def run_saved_report(
    report_id: str,
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Re-execute a saved report using its stored DSL.
    Always re-executes for freshness. Never returns cached data.
    """
    report = db.query(models.AnalyticsSavedReport).filter(
        models.AnalyticsSavedReport.id == report_id
    ).first()

    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if admin.get("role") != "Super Admin" and report.created_by != admin["sub"]:
        raise HTTPException(status_code=403, detail="You can only run your own saved reports.")

    try:
        sdrs   = resolve_sdrs(db)
        dsl    = json.loads(report.dsl_json)
        validate_dsl(dsl)
        result = execute_dsl(dsl, admin, db, sdrs=sdrs)
        result["saved_report"] = {"id": report.id, "name": report.name}
        return result
    except SmartAnalyticsError as exc:
        raise HTTPException(status_code=422, detail={"error": exc.code, "message": exc.user_message})
    except Exception as exc:
        logger.exception("smart_analytics: run saved report %s failed: %s", report_id, exc)
        raise HTTPException(status_code=500, detail="Failed to re-run report.")


# ─── Endpoint 7: Recent Batches ───────────────────────────────────────────────

@router.get("/batches")
def list_batches(
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Return recent upload batches for the batch filter dropdown.
    Returns [{id, label, upload_date, filename}]
    """
    batches = resolve_batches(db)
    return [
        {
            "id":          b["id"],
            "label":       b["label"],
            "filename":    b["filename"],
            "upload_date": b["date_str"],
        }
        for b in batches
    ]


# ─── Endpoint 6: Query History ────────────────────────────────────────────────

@router.get("/history")
def get_history(
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Return last 5 unique successful queries for the current user (for 'Recent' chips in UI).
    Excludes clarify-loop entries (queries containing '—').
    """
    rows = db.query(models.AnalyticsQueryHistory).filter(
        models.AnalyticsQueryHistory.user_id  == admin["sub"],
        models.AnalyticsQueryHistory.success  == True,
        models.AnalyticsQueryHistory.dsl_json.isnot(None),
    ).order_by(
        models.AnalyticsQueryHistory.created_at.desc()
    ).limit(20).all()

    seen   = set()
    result = []
    for r in rows:
        q = r.natural_language_query.strip()
        # Skip clarification loop artifacts
        if "—" in q:
            continue
        if q not in seen:
            seen.add(q)
            result.append({
                "query":      q,
                "dsl_json":   r.dsl_json,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })
        if len(result) >= 5:
            break

    return result

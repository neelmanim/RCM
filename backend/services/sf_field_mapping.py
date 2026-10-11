"""Admin-configurable Alternate CRM -> Salesforce Lead field mapping (v14.1.0).

The built-in mapping (status, name, phone, title, ... ) stays in salesforce.py and cannot be edited here. A Super Admin adds
EXTRA rows: a Alternate CRM field + the Salesforce API name (e.g. Budget__c). Every Lead create and update then also sends those
values. Saved rows are checked against Salesforce's own field list when a connection exists.
"""
import re
from datetime import datetime

import models

# What can be mapped: lead fields that are not already pushed. Label shown in the picker.
LEAD_FIELDS = {
    "phone_secondary": "Second phone", "vertical": "Vertical", "person_linkedin": "Person LinkedIn",
    "total_funding": "Total funding", "company_phone": "Company phone", "company_linkedin": "Company LinkedIn",
    "company_city": "Company city", "company_state": "Company state", "company_country": "Company country",
    "company_founded": "Company founded", "research_company": "Research: company", "research_contact": "Research: contact",
    "research_hypothesis": "Research: hypothesis", "research_personalization": "Research: personalization",
    "research_industry": "Research: industry", "research_company_size": "Research: company size",
    "research_services": "Research: services", "research_geo": "Research: geography", "research_hook": "Research: hook",
    "research_opening": "Research: opening line", "research_heat": "Research: heat", "lead_source": "Lead source (Alternate CRM)",
    "closed_reason": "Closed reason", "opportunity_status": "Opportunity status (Won/Lost)",
    "call_attempt_count": "Call attempts", "times_called": "Times called", "no_show_count": "No-shows",
    "discovery_meeting_count": "Discovery meetings", "last_call_timestamp": "Last call time",
    "meeting_scheduled_at": "Meeting date", "lead_started_at": "Lead started", "campaign": "Campaign (tag)",
}
# Salesforce fields Alternate CRM already writes, or must never be overwritten by a mapping.
RESERVED_SF_FIELDS = {
    "firstname", "lastname", "company", "email", "phone", "lead_status__c", "status", "job_title__c", "title", "website",
    "industry", "numberofemployees", "annualrevenue", "city", "state", "country", "street", "postalcode", "description",
    "linkedin_profile__c", "sdr_name__c", "lead_lost_reason__c", "lead_source_new__c", "ownerid", "id", "isdeleted",
    "isconverted", "recordtypeid", "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid", "systemmodstamp",
}
_API_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,79}$")
_NUMERIC = {"double", "int", "currency", "percent"}


# Built-in mappings (salesforce.LEAD_FIELD_MAP): these five can never be changed or switched off - they identify the lead and carry
# its status. Everything else in the built-in list can point at a different Salesforce field or be switched off.
BUILTIN_LOCKED = ("first_name", "last_name", "email", "phone", "status")
BUILTIN_LABELS = {
    "first_name": "First name", "last_name": "Last name", "email": "Email", "phone": "Phone", "status": "Status", "title": "Job title",
    "website": "Website", "industry": "Industry", "employee_count": "Employee count", "annual_revenue": "Annual revenue", "city": "City",
    "state": "State", "country": "Country", "company_street": "Company street", "company_postal_code": "Company postal code",
    "description": "Description (research summary)", "linkedin_url": "LinkedIn", "sdr_name": "SDR name",
    "disqualification_reason": "Disqualification reason",
}
# Salesforce fields a built-in mapping may never be pointed at (system fields, owner, and what the locked fields write).
NEVER_TARGETS = {
    "id", "ownerid", "isdeleted", "isconverted", "recordtypeid", "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid",
    "systemmodstamp", "company", "lead_source_new__c", "firstname", "lastname", "email", "phone", "lead_status__c", "status",
}

SF_OBJECT = "Lead"          # the Salesforce object these mappings write to (Opportunity/Account are pushed separately)


class MappingError(ValueError):
    pass


def check_new(db, lead_field, sf_field, sf=None, exclude_id=None):
    """Validate a new (or, with exclude_id, an edited) mapping; returns (clean_sf_field, sf_type or None, verified).
    Raises MappingError with a plain message that names the Salesforce object."""
    sf_field = (sf_field or "").strip()
    if lead_field not in LEAD_FIELDS:
        raise MappingError("That Alternate CRM field can't be mapped.")
    if not _API_NAME.match(sf_field):
        raise MappingError(f"Enter the {SF_OBJECT} field's API name, e.g. Budget__c (letters, numbers and underscores only).")
    if sf_field.lower() in RESERVED_SF_FIELDS:
        import salesforce      # late: salesforce.py imports this module
        builtin = next((BUILTIN_LABELS.get(k, k) for k, v in salesforce.LEAD_FIELD_MAP.items() if v.lower() == sf_field.lower()), None)
        if builtin and sf_field.lower() not in NEVER_TARGETS:
            raise MappingError(f"{sf_field} is already filled by the built-in \"{builtin}\" mapping. Use the pencil on that row in the built-in table to change it.")
        raise MappingError(f"{sf_field} on the {SF_OBJECT} object is already managed by Alternate CRM and can't be remapped here.")
    others = [r for r in db.query(models.SfFieldMapping).all() if r.id != exclude_id]
    if any(r.lead_field == lead_field and not r.builtin for r in others):
        raise MappingError("That Alternate CRM field is already mapped. Edit or remove the existing row.")
    if any(r.sf_field.lower() == sf_field.lower() and r.enabled for r in others):
        raise MappingError(f"{sf_field} on the {SF_OBJECT} object is already filled from another Alternate CRM field.")
    return _check_against_salesforce(sf, sf_field)


def _check_against_salesforce(sf, sf_field):
    if sf is None:
        return sf_field, None, False
    try:
        fields = {f["name"].lower(): f for f in sf.Lead.describe()["fields"]}
    except Exception as e:      # Salesforce unreachable: refuse rather than save something unchecked
        raise MappingError(f"Couldn't read the {SF_OBJECT} field list from Salesforce ({str(e)[:120]}). Try again.")
    f = fields.get(sf_field.lower())
    if not f:
        raise MappingError(f"The Salesforce {SF_OBJECT} object has no field with the API name {sf_field}. In Salesforce, open Setup > Object Manager > Lead > Fields & Relationships and copy the exact API name (custom fields end in __c).")
    if not (f.get("createable") and f.get("updateable")):
        raise MappingError(f"{f['name']} on the {SF_OBJECT} object is read-only in Salesforce, so Alternate CRM can't write to it.")
    return f["name"], f.get("type"), True


def _coerce(value, sf_type):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat() if sf_type == "date" else value.isoformat()
    if sf_type in _NUMERIC:
        try:
            n = float(str(value).replace(",", "").replace("$", ""))
        except (TypeError, ValueError):
            return None
        return int(n) if sf_type == "int" else n
    if sf_type == "boolean":
        return str(value).strip().lower() in ("1", "true", "yes", "y")
    return value if isinstance(value, (int, float, bool)) else str(value)


def custom_payload(db, lead):
    """{salesforce_api_name: value} for every enabled extra mapping; empty values are left out (never blank a field in SF)."""
    rows = db.query(models.SfFieldMapping).filter(models.SfFieldMapping.enabled.is_(True), models.SfFieldMapping.builtin.is_(False)).all()
    if not rows:
        return {}
    out = {}
    for r in rows:
        if r.lead_field == "campaign":
            names = sorted(t.name for t in lead.tags)
            value = names[0] if names else None
        else:
            value = getattr(lead, r.lead_field, None)
        value = _coerce(value, r.sf_type)
        if value is not None:
            out[r.sf_field] = value
    return out


def builtin_overrides(db):
    """{lead_key: Salesforce field name, or None when switched off} for the built-in mappings an admin changed."""
    return {r.lead_field: (r.sf_field if r.enabled else None)
            for r in db.query(models.SfFieldMapping).filter(models.SfFieldMapping.builtin.is_(True))}


def check_builtin(db, lead_field, sf_field, default_map, sf=None):
    """Validate pointing a built-in mapping at another Salesforce field; returns (clean_name, sf_type, verified)."""
    sf_field = (sf_field or "").strip()
    if not _API_NAME.match(sf_field):
        raise MappingError(f"Enter the {SF_OBJECT} field's API name, e.g. Job_Title__c (letters, numbers and underscores only).")
    if sf_field.lower() in NEVER_TARGETS:
        raise MappingError(f"{sf_field} on the {SF_OBJECT} object is a system field or one Alternate CRM always controls, so nothing can be mapped to it.")
    taken = {(r.sf_field or "").lower() for r in db.query(models.SfFieldMapping).filter(
        models.SfFieldMapping.enabled.is_(True), models.SfFieldMapping.lead_field != lead_field)}
    overridden = {r.lead_field for r in db.query(models.SfFieldMapping).filter(models.SfFieldMapping.builtin.is_(True))}
    taken |= {v.lower() for k, v in default_map.items() if k != lead_field and k not in overridden}
    if sf_field.lower() in taken:
        raise MappingError(f"{sf_field} on the {SF_OBJECT} object is already filled from another Alternate CRM field.")
    return _check_against_salesforce(sf, sf_field)

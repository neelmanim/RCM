# RCM Public API — CMT Integration Guide

> **Version:** 1.0 | **Updated:** April 2026 | **Audience:** Contract Management Tool (CMT) developers

---

## Overview

RCM exposes a small, authenticated REST API that lets your Contract Management Tool (CMT) look up the Salesforce record URL for any Account — using either the RCM Messaging Account ID or the company name — without requiring direct Salesforce credentials or setup in your tool.

| Property | Value |
|---|---|
| Base URL | `https://api.alternatecrm.com` |
| Auth method | `X-API-Key` header |
| Format | JSON |
| Rate limit | No hard limit (use responsibly) |

---

## Authentication

Every request **must** include the `X-API-Key` header. The key is generated and managed by your RCM Super Admin under **Settings → 🔌 Public API**.

```http
X-API-Key: rcm_<48-char-hex>
```

> ⚠️ Treat this key like a password. Do not commit it to source control. Anyone with this key can query your Salesforce data through RCM.

**Error if missing or invalid:**
```json
HTTP 401
{ "detail": "API key required. Pass X-API-Key header." }
```

---

## Endpoints

### `GET /api/public/health`

Unauthenticated liveness check. Use this to verify the API is reachable.

**Response:**
```json
{
  "status": "ok",
  "api": "RCM Public API"
}
```

---

### `GET /api/public/sf/account`

Look up a Salesforce Account (or Lead fallback) using RCM's configured Salesforce connection.

#### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `rcm_messaging_id` | string | Conditional | The RCM Messaging Account ID stored in Salesforce field `RCMMessaging_AccountId__c`. **Exact match.** |
| `company_name` | string | Conditional | The Salesforce Account Name. RCM first tries exact match, then partial (LIKE) match. |

**At least one of** `rcm_messaging_id` or `company_name` must be provided.

When both are provided, `rcm_messaging_id` is tried first; `company_name` is used as a fallback.

#### Lookup Behaviour

```
1. Query Salesforce Account WHERE RCMMessaging_AccountId__c = '<rcm_messaging_id>'
2. If not found → Query Salesforce Account WHERE Name = '<company_name>' (exact)
3. If not found → Query Salesforce Account WHERE Name LIKE '%<company_name>%'
4. If still not found → Fallback to Salesforce Lead object (same order)
5. If nothing found → found: false
```

---

#### Response: Account Found (exact)

```json
HTTP 200
{
  "found": true,
  "type": "Account",
  "sf_account_id": "001G0000010sn3FIAQ",
  "account_name": "Acme Corporation",
  "sf_url": "https://rcm-messaging.lightning.force.com/lightning/r/Account/001G0000010sn3FIAQ/view",
  "matched_by": "rcm_messaging_id",
  "confidence": "exact"
}
```

#### Response: Account Found (partial / LIKE match)

```json
HTTP 200
{
  "found": true,
  "type": "Account",
  "sf_account_id": "001G0000010sn3FIAQ",
  "account_name": "Acme Corporation Ltd",
  "sf_url": "https://rcm-messaging.lightning.force.com/lightning/r/Account/001G0000010sn3FIAQ/view",
  "matched_by": "company_name",
  "confidence": "like",
  "candidates": [
    { "sf_account_id": "001G0000010sn3FIAQ", "account_name": "Acme Corporation Ltd" },
    { "sf_account_id": "001G0000010sn3FJBQ", "account_name": "Acme Corp India" }
  ]
}
```

> When `confidence` is `"like"`, the `candidates` array lists all matched Accounts. The top result is returned in the main fields. If CMT finds the wrong record, check `candidates` for alternatives.

#### Response: Lead Fallback

If no Account is found, RCM searches Salesforce Lead records.

```json
HTTP 200
{
  "found": true,
  "type": "Lead",
  "sf_lead_id": "00QG000000abcXYZ",
  "lead_name": "John Smith",
  "company": "Acme Corp",
  "sf_url": "https://rcm-messaging.lightning.force.com/lightning/r/Lead/00QG000000abcXYZ/view",
  "matched_by": "company_name",
  "confidence": "exact",
  "note": "No Account record found in Salesforce. Returning matching Lead record."
}
```

#### Response: Not Found

```json
HTTP 200
{
  "found": false,
  "message": "No Account or Lead found in Salesforce for the given identifier.",
  "searched": {
    "rcm_messaging_id": "12345",
    "company_name": null
  }
}
```

---

## Error Reference

| HTTP Status | Cause | How to resolve |
|---|---|---|
| `400 Bad Request` | Neither `rcm_messaging_id` nor `company_name` provided | Pass at least one parameter |
| `401 Unauthorized` | Missing or invalid `X-API-Key` | Check the key with your RCM admin |
| `503 Service Unavailable` | Salesforce is not connected in RCM | Ask the RCM admin to check the SF connection in Settings |

---

## Code Examples

### cURL

```bash
# Lookup by RCM Messaging ID
curl -X GET \
  "https://api.alternatecrm.com/api/public/sf/account?rcm_messaging_id=12345" \
  -H "X-API-Key: rcm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Lookup by company name
curl -X GET \
  "https://api.alternatecrm.com/api/public/sf/account?company_name=Acme+Corporation" \
  -H "X-API-Key: rcm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Combined (rcm_messaging_id takes priority)
curl -X GET \
  "https://api.alternatecrm.com/api/public/sf/account?rcm_messaging_id=12345&company_name=Acme" \
  -H "X-API-Key: rcm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Python

```python
import requests

API_BASE = "https://api.alternatecrm.com"
API_KEY  = "rcm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

def get_sf_account(rcm_messaging_id=None, company_name=None):
    resp = requests.get(
        f"{API_BASE}/api/public/sf/account",
        params={k: v for k, v in [
            ("rcm_messaging_id", rcm_messaging_id),
            ("company_name", company_name),
        ] if v},
        headers={"X-API-Key": API_KEY},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()

# Usage
result = get_sf_account(rcm_messaging_id="12345")
if result["found"]:
    print(f"Type: {result['type']}")
    print(f"SF URL: {result['sf_url']}")
    print(f"Record ID: {result.get('sf_account_id') or result.get('sf_lead_id')}")
else:
    print("No record found in Salesforce")
```

### JavaScript / Node.js

```javascript
const API_BASE = 'https://api.alternatecrm.com';
const API_KEY  = 'rcm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

async function getSalesforceAccount({ externalId, companyName } = {}) {
  const params = new URLSearchParams();
  if (externalId)  params.set('rcm_messaging_id',  externalId);
  if (companyName) params.set('company_name', companyName);

  const resp = await fetch(`${API_BASE}/api/public/sf/account?${params}`, {
    headers: { 'X-API-Key': API_KEY },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// Usage
const result = await getSalesforceAccount({ externalId: '12345' });
if (result.found) {
  console.log('SF URL:', result.sf_url);
}
```

---

## Field Reference

### `type: "Account"` response fields

| Field | Type | Description |
|---|---|---|
| `found` | boolean | Always `true` when a record is found |
| `type` | string | `"Account"` |
| `sf_account_id` | string | Salesforce Account record ID (`001...`) |
| `account_name` | string | Salesforce Account Name |
| `sf_url` | string | Full Salesforce Lightning URL |
| `matched_by` | string | `"rcm_messaging_id"` or `"company_name"` |
| `confidence` | string | `"exact"` or `"like"` (partial match) |
| `candidates` | array | Only present for `"like"` matches — list of all partial matches |

### `type: "Lead"` response fields

| Field | Type | Description |
|---|---|---|
| `found` | boolean | Always `true` |
| `type` | string | `"Lead"` |
| `sf_lead_id` | string | Salesforce Lead record ID (`00Q...`) |
| `lead_name` | string | Lead's full name |
| `company` | string | Lead's company |
| `sf_url` | string | Full Salesforce Lightning URL |
| `note` | string | Explains the fallback reason |

---

## Admin: Managing the API Key

1. Log in to RCM as **Super Admin**
2. Go to **Settings → 🔌 Public API**
3. Click **Generate New Key** — the key is shown once; copy it immediately
4. Share the key with CMT team via a secure channel (1Password, encrypted email, etc.)
5. To disable access, click **Revoke Key**

> Generating a new key immediately invalidates the previous one. If you rotate the key, update it in CMT before the old one is revoked.

---

*For issues, contact your RCM admin or raise via the in-app Feedback button.*

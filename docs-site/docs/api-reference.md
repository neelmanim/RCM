# REST API Reference

The RCM backend is powered by FastAPI, providing high-performance, asynchronous REST endpoints for Revenue Cycle Management.

## Base URL

In local development, the API is available at:
`http://localhost:8000/api/v1`

## Authentication

Most endpoints require a valid Bearer token. Pass the token in the `Authorization` header of your HTTP request.

```http
Authorization: Bearer <your_jwt_token>
```

---

## Patients API

### Get All Patients

Retrieves a paginated list of patients.

**Endpoint:** `GET /patients`

**Query Parameters:**
- `skip` (int, default: 0): Number of records to skip.
- `limit` (int, default: 100): Maximum number of records to return.

**Response:**
```json
{
  "total": 42,
  "data": [
    {
      "id": "pat_12345",
      "first_name": "John",
      "last_name": "Doe",
      "status": "active"
    }
  ]
}
```

### Create a Patient

Registers a new patient in the RCM system.

**Endpoint:** `POST /patients`

**Payload:**
```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "dob": "1985-10-15",
  "insurance_provider": "BlueCross"
}
```

**Response:** `201 Created`

---

## Billing API

### Submit Claim

Submits a new insurance claim.

**Endpoint:** `POST /billing/claims`

**Payload:**
```json
{
  "patient_id": "pat_12345",
  "encounter_date": "2023-11-01",
  "procedure_codes": ["99213", "85025"],
  "total_amount": 250.00
}
```

**Response:**
```json
{
  "claim_id": "clm_98765",
  "status": "submitted",
  "submission_date": "2023-11-02T10:00:00Z"
}
```

### Check Claim Status

Retrieves the current status of an existing claim.

**Endpoint:** `GET /billing/claims/{claim_id}`

**Response:**
```json
{
  "claim_id": "clm_98765",
  "status": "processing",
  "adjudication_date": null
}
```

## Error Handling

The API uses standard HTTP status codes:
- `400 Bad Request`: Invalid payload or missing parameters.
- `401 Unauthorized`: Missing or invalid authentication token.
- `403 Forbidden`: Insufficient permissions.
- `404 Not Found`: Resource does not exist.
- `422 Unprocessable Entity`: Validation error (typically caught by Pydantic).
- `500 Internal Server Error`: An unexpected error occurred on the server.

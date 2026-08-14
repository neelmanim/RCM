# Google Drive Lead Auto-Ingestion

> **Status:** Backlog | **Priority:** P2 | **Added:** April 7, 2026

## Objective

Automate lead ingestion by monitoring a Google Drive folder for new Excel/CSV files, processing valid leads into RCM, and moving files to appropriate folders based on outcome.

---

## Folder Structure

- **Input:** `/Lead Upload Queue`
- **Processed:** `/Lead Upload Queue/Processed`
- **Failed:** `/Lead Upload Queue/Failed`

## Trigger

- New file added to Input Folder
- Supported: `.xlsx`, `.xls`, `.csv`

## Expected Columns

| Column | Required | Default |
|--------|----------|---------|
| Name | Optional | — |
| Phone Number | **Mandatory** | — |
| Email | Optional | — |
| Company | Optional | — |
| Source | Optional | "Lead Upload" |
| Notes | Optional | — |

## Processing Logic

1. **File Validation** — reject unsupported/empty/unparseable files → Failed
2. **Column Mapping** — normalize headers, map variations (`"mobile"`, `"contact number"`, `"फोन"` → Phone)
3. **Row Validation** — skip empty/invalid phone (<10 digits), normalize with `+91`
4. **Deduplication** — check phone (primary) + email (secondary), update existing preferred
5. **Lead Creation** — push valid leads with all mapped fields
6. **Error Handling** — row-level error log with reasons
7. **Post Processing** — move to Processed (with error CSV if partial), or Failed

## File Handling

- Rename: `originalname_timestamp.xlsx`
- Prevent reprocessing (ignore Processed/Failed)
- Duplicate filenames get timestamp suffix

## Technical Notes

- **Reuse existing `upload_enriched_sheet()` logic** from `admin_routes.py` (L152-456) — already has column mapping (`COLUMN_MAP`), deduplication (email/phone/linkedin/name+company), and update-existing mode
- **Google Drive API:** Use service account with Drive API v3, `files.list` with folder filter + `files.get` for download
- **Retry:** 3 attempts on API/system errors
- **Concurrency:** Queue-based, one file at a time
- **Batch:** 10k+ rows → chunk processing
- **Edge cases:** multiple sheets (first only), blank rows, extra columns (ignore), encoding handling

## Notifications (Optional)

- Slack/Email on failure or bulk success
- Include: filename, total rows, success/failure counts

## Success Criteria

- Leads correctly created/updated
- No duplicate or invalid data enters system
- Files reliably moved post-processing
- Errors transparent and actionable

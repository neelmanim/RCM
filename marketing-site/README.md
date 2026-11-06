# Alternate CRM public site

Next.js App Router site for the CRM overview, product guides, service check, and early-access request flow.

## Local verification

- `npm run lint`
- `npm run build` (default Turbopack)
- `npm run build -- --webpack` when the local Windows sandbox cannot start Turbopack CSS workers
- `npm run dev -- --port 4176`

## Environment

- `ALTERNATE_CRM_API_URL`: server-only API base URL; defaults to `https://api.alternatecrm.com`. Early-access requests forward once to `/api/public/leads/inbound`; service checks use `/api/public/health`. Point this at a controlled local mock for form verification. Do not test submissions against production.
- `NEXT_PUBLIC_SANDBOX_URL`: public demo destination; defaults to `https://app.alternatecrm.com/sandbox`.
- `NEXT_PUBLIC_SIGNIN_URL`: private workspace gate; defaults to `https://app.alternatecrm.com/login`.

The form uses same-origin `/api/early-access` and shows success only for a successful upstream response containing `success: true`. It does not cache contact details in localStorage. A timeout cannot establish whether the upstream saved a request, and the UI says so. Reopening a successfully submitted form retains the acknowledgement in that browser view to avoid accidental resubmission; reloading begins a new request.

`?request-access=1` opens the native request dialog on any public page. The close action removes this query without changing unrelated query parameters or anchors. Product guides use real `/blog/[slug]` routes with page titles and canonical URLs.

Service checks describe one scoped HTTP request. A failed probe becomes unknown or degraded; no historical uptime, audio-latency, provider-health, customer endorsement, or compliance claim is inferred from it. Communication and integration modules remain simulated or planned in public copy.

# Active plan: live audit remediation

User authorized fixes on 6 November 2026. Follow [audit_fix_plan.md](audit_fix_plan.md), including graph impact, scoped changes and verification. Previous plan retained below for context.

# Alternate CRM cleanup and React cutover

## 0. Establish the baseline

- Use the graph built at `23059a1` for symbol and caller queries. Cross-check HTML, rewrites, generated bundles, database state, and external contracts separately. The graph found 7 one-hop impacted nodes for the app shell/sidebar targets, 35 for the sandbox routes/mock/store targets, and 51 for the messaging client/public API/sidebar targets.
- Record routes and roles from `frontend/index.html:481`, `frontend/login.html:51`, and `frontend/vercel.json:3`. Inventory entry points across both frontend and backend trees, the marketing site, SDK, deployment manifests, and scheduled jobs. Classify each candidate as active, generated, superseded, or pending runtime verification.
- Supported patterns are the Vite builds in `frontend-react/package.json:8`, React routes in `frontend-react/src/App.jsx:16`, module state in `frontend-react/src/core/modules/ModuleContext.jsx:6`, and sandbox services in `frontend-react/src/services/`. Establish baseline checks for sign-in, lead list/detail, pipeline, roles, optional features, and demo launch.

## 1. Remove confirmed branding and playground remnants

- Clean API and help labels and regenerate the affected React bundles. Replace the former-company email visibility condition in both app implementations with the verified access policy. Verify both existing and ordinary accounts against that policy.
- Update privacy and terms using verified entity, ownership, and contact information. Check links, app metadata, screenshots, favicons, and compiled output. Review messaging paths and Salesforce lookup fields as integration contracts. Schedule any provider replacement or schema cutover only after mapping callers and proving account lookup, thread retrieval, and message sends.
- Commit 19a026a removed the playground UI. The tracked tree has no playground-named file, and a targeted search found no current frontend callers of the two legacy cadence test endpoints. Remove obsolete release-note and code references. Trace the journey test routes at `backend/routes/journey_routes.py:867` and related handlers before retiring them. Confirm callers, permissions, and scheduled work. Keep the public demo route as a distinct product surface.
- Verify by scanning source, filenames, and regenerated output for the audited company, acquisition, and product aliases. Check both legal links and the public API schema. Scope Git history separately because existing branches, remotes, and clones retain old references.

## 2. Make React the production app

- The current HTML shell mounts React hubs alongside legacy controllers. The existing React shell has placeholder routes for several active features. Port one complete workflow at a time using the existing hub components, auth and API adapters, and route behavior.
- Cut over only when the replacement covers sign-in and expiry, role gates, view-as, deep links, browser navigation, and offline/cache behavior. Include the HTML references, service worker, and deployment rewrites in each cutover check.
- After each cutover, use graph callers and direct references to verify removal candidates. Delete superseded controllers and bundles with their last consumer. Use the existing Vite build as the production entry point once route parity is proven.

## 3. Prove one installable module

- Keep CRM core available by default. Pilot an optional module that can work against seeded demo data and reuse existing React components. Use the registry and context patterns in `ModuleRegistry.js:73` and `ModuleContext.jsx:6`; those currently toggle browser-local state.
- Define only what the pilot needs to activate: identity, route, access, and setup status. For shared commercial workspaces, enforce the activation and permission rules server-side using existing organization settings where suitable.
- Verify activation after reload and from another session, direct access when disabled, role boundaries, and data preservation after disabling and re-enabling. Expand the contract only when a second module exposes a concrete need.

## 4. Validate the one-click demo

- Start from the existing `/sandbox` and `/demo` routes. Verify the React demo using synthetic data with deterministic reset. Keep its data and session isolated from production, including credentials, provider sends, and background jobs.
- Verify that a fresh browser can launch the demo without setup, complete a CRM workflow, activate the pilot module, and reset. The demo currently sets an origin-wide localStorage flag also read by production auth and API code. Scope demo mode and module state to the demo session, then verify production and demo in concurrent tabs. Inspect network requests and confirm that demo actions never hit production write endpoints. Treat the staging data administration routes in `backend/routes/sandbox_routes.py` as a separate surface.

## Release checks

Run the available builds and lint, exercise the baseline flows in a staging build, and review each phase with graph impact and diff checks. Check removed URLs, old aliases, static assets, and build output. Confirm remaining deployment and runtime dependencies before declaring the branding or legacy cutover complete.

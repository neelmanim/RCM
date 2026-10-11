import React from 'react';
import { DataSectionSandboxCard } from './data/SandboxRefreshCard';
import { DataSectionUploadCard } from './data/UploadCenterCard';
import { DataSectionUploadHistoryCard } from './data/UploadHistoryCard';
import { DataSectionExportCard } from './data/ExportLeadsCard';

// Phase 4: Sandbox Data Refresh (ported from frontend/js/views/settings.js's
// `sandbox` tab panel + `_initSandboxTab()`) and Upload Center (ported from
// frontend/js/views/upload.js / upload_csv.js / upload_gsheet.js) — see
// .claude/plans/i-was-working-on-idempotent-ritchie.md, "Phase 4 — Data".
// 2026-09-04: Export Leads added per audit — Upload Center only ever
// covered getting data in, there was no way to get one SDR's lead data out.
// 2026-09-04: Upload History + rollback added — UploadCenterCard.jsx's port
// deliberately left these out; the service layer already existed unused.
export function DataSection() {
    return (
        <div className="space-y-6">
            <DataSectionSandboxCard />
            <DataSectionUploadCard />
            <DataSectionUploadHistoryCard />
            <DataSectionExportCard />
        </div>
    );
}

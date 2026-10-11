import { describe, it, expect } from 'vitest';
import { formatLeadSource } from '../../lib/leadSource';

// Regression: LeadHeader.jsx used to default any unrecognized lead_source
// (including real upload:/gsheet: batch names) to "Manual" — the same lead
// showed its real source in the leads table but "Manual" on its own detail
// page. This is the single shared implementation both now use.
describe('formatLeadSource', () => {
  it('extracts the batch name from an upload: source instead of guessing Manual', () => {
    expect(formatLeadSource('upload:HIMSS Exclusive - Cardiology.csv:2026-03-25T10:30:00+00:00')).toBe('HIMSS Exclusive - Cardiology.csv');
  });

  it('extracts the sheet name from a gsheet: source', () => {
    expect(formatLeadSource('gsheet:Q3 Targets:2026-03-25T11:00:00+00:00')).toBe('Q3 Targets');
  });

  it('labels Klenty and Aircall sync sources', () => {
    expect(formatLeadSource('klenty_sync:2026-07-30')).toBe('Klenty');
    expect(formatLeadSource('aircall_webhook:2026-08-01')).toBe('Aircall');
    expect(formatLeadSource('aircall_sync:2026-08-01')).toBe('Aircall');
  });

  it('labels salesforce, manual, uploaded, and Manual Dial exactly', () => {
    expect(formatLeadSource('salesforce')).toBe('Salesforce');
    expect(formatLeadSource('manual')).toBe('Manual');
    expect(formatLeadSource('uploaded')).toBe('Uploaded');
    expect(formatLeadSource('Manual Dial')).toBe('Manual Dial');
  });

  it('shows an unrecognized tag verbatim rather than guessing, and "—" for missing', () => {
    expect(formatLeadSource('synthetic')).toBe('synthetic');
    expect(formatLeadSource(null)).toBe('—');
    expect(formatLeadSource('')).toBe('—');
  });
});

import { describe, it, expect } from 'vitest';
import { deriveResearchStatus, RESEARCH_STATUS } from '../../features/lead-detail-hub/lib/deriveResearchStatus';

describe('deriveResearchStatus', () => {
  it('is NOT_AVAILABLE for a lead with no research fields', () => {
    expect(deriveResearchStatus({ id: 'l1' }, {})).toBe(RESEARCH_STATUS.NOT_AVAILABLE);
  });

  it('is NOT_AVAILABLE for a null lead', () => {
    expect(deriveResearchStatus(null, {})).toBe(RESEARCH_STATUS.NOT_AVAILABLE);
  });

  it('is RESEARCHING while a request is in flight, regardless of lead state', () => {
    expect(deriveResearchStatus({ id: 'l1' }, { researching: true })).toBe(RESEARCH_STATUS.RESEARCHING);
  });

  it('is FAILED when the last request errored', () => {
    expect(deriveResearchStatus({ id: 'l1' }, { error: new Error('boom') })).toBe(RESEARCH_STATUS.FAILED);
  });

  it('is LIMITED when only a few research fields are populated', () => {
    const lead = { research_company: 'Acme', research_hook: 'Growth' };
    expect(deriveResearchStatus(lead, {})).toBe(RESEARCH_STATUS.LIMITED);
  });

  it('is READY when most research fields are populated', () => {
    const lead = {
      research_company: 'Acme', research_contact: 'CEO', research_hypothesis: 'Scaling',
      research_personalization: 'Note', research_industry: 'SaaS',
    };
    expect(deriveResearchStatus(lead, {})).toBe(RESEARCH_STATUS.READY);
  });

  it('treats the Klenty historical-sync placeholder text as NOT_AVAILABLE, never as real research', () => {
    // Spec principle #5: never show generic fallback text as if it were real research.
    const lead = {
      research_company: 'No research done – called directly via Klenty',
      research_contact: 'No research done – called directly via Klenty',
    };
    expect(deriveResearchStatus(lead, {})).toBe(RESEARCH_STATUS.NOT_AVAILABLE);
  });
});

import { describe, it, expect } from 'vitest';
import { deriveNextBestAction } from '../../features/lead-detail-hub/lib/deriveNextBestAction';

const baseLead = { id: 'l1', first_name: 'Kyle', status: 'Calling', call_attempt_count: 1, max_call_attempts: 5, max_attempts_reached: false };

describe('deriveNextBestAction', () => {
  it('returns no action for an opted-out lead', () => {
    const action = deriveNextBestAction({ ...baseLead, do_not_contact: true }, []);
    expect(action.ctaKind).toBeNull();
    expect(action.label).toMatch(/no action/i);
  });

  it('returns "Deal won/lost" for a closed opportunity', () => {
    expect(deriveNextBestAction({ ...baseLead, opportunity_status: 'Won' }, []).label).toMatch(/won/i);
    expect(deriveNextBestAction({ ...baseLead, opportunity_status: 'Lost' }, []).label).toMatch(/lost/i);
  });

  it('returns no further action for a disqualified/terminal status', () => {
    const action = deriveNextBestAction({ ...baseLead, status: 'Disqualified' }, []);
    expect(action.ctaKind).toBeNull();
  });

  it('returns "Call {name}" when there is no answered call yet', () => {
    const action = deriveNextBestAction(baseLead, []);
    expect(action.label).toBe('Call Kyle');
    expect(action.ctaKind).toBe('call');
  });

  it('does not treat a "No Answer" outcome as an answered call', () => {
    const activities = [{ kind: 'call', raw: { outcome: 'No Answer' } }];
    expect(deriveNextBestAction(baseLead, activities).ctaKind).toBe('call');
  });

  it('recommends marking the meeting complete, with No Show as the secondary action', () => {
    const activities = [{ kind: 'call', raw: { outcome: 'Meeting Scheduled' } }];
    const action = deriveNextBestAction({ ...baseLead, status: 'Meeting Scheduled' }, activities);
    expect(action.ctaKind).toBe('meeting-complete');
    expect(action.secondary.ctaKind).toBe('no-show');
  });

  it('recommends a demo outcome once at Demo Scheduled, with Demo Failed as the secondary action', () => {
    const activities = [{ kind: 'call', raw: { outcome: 'Meeting Scheduled' } }];
    const action = deriveNextBestAction({ ...baseLead, status: 'Demo Scheduled' }, activities);
    expect(action.ctaKind).toBe('demo-success');
    expect(action.secondary.ctaKind).toBe('demo-failed');
  });

  it('recommends adding a discovery call at 1st Discovery Meeting, with Complete Discovery as secondary', () => {
    const activities = [{ kind: 'call', raw: { outcome: 'Meeting Scheduled' } }];
    const action = deriveNextBestAction({ ...baseLead, status: '1st Discovery Meeting' }, activities);
    expect(action.ctaKind).toBe('add-discovery');
    expect(action.secondary.ctaKind).toBe('complete-discovery');
  });

  it('recommends scheduling the demo once discovery is complete', () => {
    const activities = [{ kind: 'call', raw: { outcome: 'Meeting Scheduled' } }];
    const action = deriveNextBestAction({ ...baseLead, status: 'Discovery Complete' }, activities);
    expect(action.ctaKind).toBe('schedule-demo');
  });

  it('returns no further action for a Completed lead', () => {
    const action = deriveNextBestAction({ ...baseLead, status: 'Completed' }, []);
    expect(action.ctaKind).toBeNull();
    expect(action.label).toMatch(/no further action/i);
  });

  it('returns no action for a lead Pending Review — awaiting Pod Admin, not the SDR', () => {
    const action = deriveNextBestAction({ ...baseLead, status: 'Pending Review' }, []);
    expect(action.ctaKind).toBeNull();
    expect(action.label).toMatch(/pod admin/i);
  });

  it('recommends updating contact info for a No Phone - Parked lead', () => {
    const action = deriveNextBestAction({ ...baseLead, status: 'No Phone - Parked' }, []);
    expect(action.ctaKind).toBe('edit-contact');
  });

  it('recommends disqualifying once max attempts are reached, with a call-anyway secondary', () => {
    const action = deriveNextBestAction({ ...baseLead, max_attempts_reached: true }, [
      { kind: 'call', raw: { outcome: 'No Answer' } },
    ]);
    expect(action.label).toMatch(/review for disqualification/i);
    // call_attempt_count is lifetime / all reps and includes connected calls: never "with no success".
    expect(action.reason).toBe('1 call attempts logged on this lead (all reps); the limit is 5.');
    expect(action.reason).not.toMatch(/no success/i);
    expect(action.ctaKind).toBe('disqualify');
    expect(action.secondary.ctaKind).toBe('call');
  });

  it('trusts an already-advanced pipeline status over a gap in the activity feed (RCA 2026-09-03)', () => {
    // The lead is already Meeting Scheduled server-side, but the activity
    // feed has no answered-call entry — e.g. the call's outcome never got
    // attached (a real recurring gap independent of this function). The
    // authoritative status must still win, not "Call Now".
    const action = deriveNextBestAction({ ...baseLead, status: 'Meeting Scheduled' }, []);
    expect(action.ctaKind).toBe('meeting-complete');
  });

  it('falls back to a generic follow-up once contact has been made and no other rule matches', () => {
    const activities = [{ kind: 'call', raw: { outcome: 'Interested' } }];
    const action = deriveNextBestAction({ ...baseLead, status: 'Calling' }, activities);
    expect(action.label).toMatch(/follow up with kyle/i);
  });

  it('handles a null lead gracefully', () => {
    expect(deriveNextBestAction(null, []).ctaKind).toBeNull();
  });
});

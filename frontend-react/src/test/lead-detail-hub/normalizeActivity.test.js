import { describe, it, expect } from 'vitest';
import {
  providerLabel, normalizeCalls, normalizeTasks, normalizeNotes,
  normalizeStatusHistory, normalizeFieldHistory, normalizeEmailActivity, mergeActivity,
} from '../../features/lead-detail-hub/lib/normalizeActivity';

describe('normalizeActivity — provider labeling', () => {
  it('labels a Klenty-sourced call "Klenty", not "Manual Log"', () => {
    // RCA: legacy lead_calls_tab.js only checks 'aircall'/'messenger' and
    // falls through to "Manual Log" for Klenty rows — this is the regression
    // test proving the new unified timeline does not repeat that bug.
    expect(providerLabel({ provider: 'klenty' })).toBe('Klenty');
  });

  it('labels aircall and messenger calls correctly', () => {
    expect(providerLabel({ provider: 'aircall' })).toBe('Aircall');
    expect(providerLabel({ provider: 'messenger' })).toBe('Alternate Messenger');
  });

  it('labels a manual CallLog row (provider: "manual") as "Manual Log"', () => {
    expect(providerLabel({ provider: 'manual' })).toBe('Manual Log');
  });

  it('falls back to "Manual Log" for an unknown/missing provider', () => {
    expect(providerLabel({})).toBe('Manual Log');
    expect(providerLabel({ provider: 'something-new' })).toBe('Manual Log');
  });
});

describe('normalizeActivity — mappers', () => {
  it('normalizeCalls produces the {id,kind,ts,summary,raw} shape', () => {
    const [row] = normalizeCalls([{ id: 'c1', called_at: '2026-08-01', outcome: 'Interested', user_name: 'Ana' }]);
    expect(row).toMatchObject({ id: 'call-c1', kind: 'call', ts: '2026-08-01', actor: 'Ana', summary: 'Interested' });
  });

  it('normalizeTasks/Notes/StatusHistory/FieldHistory each produce a kind-tagged row', () => {
    expect(normalizeTasks([{ id: 't1', title: 'Call back', created_at: '2026-08-01' }])[0].kind).toBe('task');
    expect(normalizeNotes([{ id: 'n1', content: 'Hi', author: 'Ana', created_at: '2026-08-01' }])[0].kind).toBe('note');
    expect(normalizeStatusHistory([{ id: 's1', from_status: 'A', to_status: 'B', changed_at: '2026-08-01' }])[0].kind).toBe('signal');
    expect(normalizeFieldHistory([{ id: 'f1', field_name: 'phone', old_value: null, new_value: '123', changed_at: '2026-08-01' }])[0].kind).toBe('signal');
  });

  it('field history words tag and owner changes readably, other fields unchanged', () => {
    const s = (e) => normalizeFieldHistory([{ id: 'x', changed_at: '2026-08-01', ...e }])[0].summary;
    expect(s({ field_name: 'tags', old_value: null, new_value: 'APAC' })).toBe('Tag added: APAC');
    expect(s({ field_name: 'tags', old_value: 'APAC', new_value: null })).toBe('Tag removed: APAC');
    expect(s({ field_name: 'assigned_to', old_value: 'Tanya', new_value: 'Ankit' })).toBe('Owner: Tanya → Ankit');
    expect(s({ field_name: 'assigned_to', old_value: null, new_value: 'Ankit' })).toBe('Owner: unassigned → Ankit');
    expect(s({ field_name: 'phone', old_value: '1', new_value: '2' })).toBe('phone: 1 → 2');
  });
});

describe('normalizeActivity — Instantly.ai email activity (provider: "instantly")', () => {
  it('labels an opened email distinctly from a plain Nylas row', () => {
    const [row] = normalizeEmailActivity([
      { id: 'e1', provider: 'instantly', direction: 'outbound', timestamp: '2026-09-01', opened_at: '2026-09-01', open_count: 1 },
    ]);
    expect(row).toMatchObject({ id: 'email-e1', kind: 'email', summary: 'Instantly: opened email' });
  });

  it('labels a clicked-link row', () => {
    const [row] = normalizeEmailActivity([
      { id: 'e2', provider: 'instantly', direction: 'outbound', timestamp: '2026-09-02', clicked_at: '2026-09-02', click_count: 1 },
    ]);
    expect(row.summary).toBe('Instantly: clicked link');
  });

  it('labels an inbound, non-auto-reply row as a reply (prioritized over open/click)', () => {
    const [row] = normalizeEmailActivity([
      { id: 'e3', provider: 'instantly', direction: 'inbound', is_auto_reply: false, timestamp: '2026-09-03', opened_at: '2026-09-01' },
    ]);
    expect(row.summary).toBe('Instantly: replied');
  });

  it('appends the subject when present (reply and sent)', () => {
    const [reply, sent] = normalizeEmailActivity([
      { id: 'e5', provider: 'instantly', direction: 'inbound', is_auto_reply: false, subject: 'Re: Intro', timestamp: '2026-09-03' },
      { id: 'e6', provider: 'instantly', direction: 'outbound', subject: 'Intro', timestamp: '2026-09-03' },
    ]);
    expect(reply.summary).toBe('Instantly: replied — Re: Intro');
    expect(sent.summary).toBe('Instantly: email sent — Intro');
  });

  it('leaves a non-instantly (Nylas) row using the subject as its summary', () => {
    const [row] = normalizeEmailActivity([
      { id: 'e4', source: 'cadence', direction: 'outbound', subject: 'Following up', timestamp: '2026-09-04' },
    ]);
    expect(row.summary).toBe('Following up');
  });

  it('mergeActivity folds email rows into the combined, date-sorted feed', () => {
    const merged = mergeActivity({
      notes: [{ id: 'n1', content: 'Note', created_at: '2026-09-01T00:00:00Z' }],
      emails: [{ id: 'e1', provider: 'instantly', direction: 'outbound', timestamp: '2026-09-05T00:00:00Z', opened_at: '2026-09-05' }],
    });
    expect(merged[0]).toMatchObject({ kind: 'email', summary: 'Instantly: opened email' });
  });
});

describe('mergeActivity', () => {
  it('merges all sources and sorts newest-first', () => {
    const merged = mergeActivity({
      calls: [{ id: 'c1', called_at: '2026-08-01T00:00:00Z', outcome: 'Interested' }],
      tasks: [{ id: 't1', title: 'Follow up', created_at: '2026-08-03T00:00:00Z' }],
      notes: [{ id: 'n1', content: 'Note', created_at: '2026-08-02T00:00:00Z' }],
    });
    expect(merged.map((a) => a.kind)).toEqual(['task', 'note', 'call']);
  });

  it('returns an empty array when given nothing', () => {
    expect(mergeActivity()).toEqual([]);
  });
});

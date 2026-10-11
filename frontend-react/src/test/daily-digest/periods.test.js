import { describe, it, expect } from 'vitest';
import { resolvePeriod, PERIODS, customProblem, lastPickableDay } from '../../features/daily-digest/periods';

const at = (iso) => new Date(`${iso}T10:00:00Z`);

describe('Team Digest periods', () => {
  const wed = at('2026-09-09');                                   // Wednesday 9 Sep 2026

  it('yesterday is one day, sent as `date` (so it compares with the same weekday last week)', () => {
    expect(resolvePeriod('yesterday', {}, wed)).toEqual({ from: '2026-09-08', to: '2026-09-08', params: { date: '2026-09-08' } });
  });

  it('last 7 / last 30 days end yesterday and include it', () => {
    expect(resolvePeriod('last7', {}, wed).params).toEqual({ from: '2026-09-02', to: '2026-09-08' });
    expect(resolvePeriod('last30', {}, wed).params).toEqual({ from: '2026-08-10', to: '2026-09-08' });
  });

  it('last week is the previous Monday to Sunday', () => {
    expect(resolvePeriod('last_week', {}, wed).params).toEqual({ from: '2026-08-31', to: '2026-09-06' });
    expect(resolvePeriod('last_week', {}, at('2026-09-07')).params).toEqual({ from: '2026-08-31', to: '2026-09-06' });    // on a Monday
    expect(resolvePeriod('last_week', {}, at('2026-09-13')).params).toEqual({ from: '2026-08-31', to: '2026-09-06' });    // on a Sunday
  });

  it('this month is month-to-date up to yesterday, and has no complete day on the 1st', () => {
    expect(resolvePeriod('this_month', {}, wed).params).toEqual({ from: '2026-09-01', to: '2026-09-08' });
    expect(resolvePeriod('this_month', {}, at('2026-09-01'))).toBeNull();
    expect(resolvePeriod('this_month', {}, at('2026-09-02')).params).toEqual({ date: '2026-09-01' });                     // one day = a day
  });

  it('last month is the whole previous calendar month, across a year boundary too', () => {
    expect(resolvePeriod('last_month', {}, wed).params).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(resolvePeriod('last_month', {}, at('2026-01-15')).params).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('custom needs both dates, ordered; a one-day range is a day', () => {
    expect(resolvePeriod('custom', {}, wed)).toBeNull();
    expect(resolvePeriod('custom', { from: '2026-09-01' }, wed)).toBeNull();
    expect(resolvePeriod('custom', { from: '2026-09-05', to: '2026-09-01' }, wed)).toBeNull();
    expect(resolvePeriod('custom', { from: '2026-09-01', to: '2026-09-05' }, wed).params).toEqual({ from: '2026-09-01', to: '2026-09-05' });
    expect(resolvePeriod('custom', { from: '2026-09-03', to: '2026-09-03' }, wed).params).toEqual({ date: '2026-09-03' });
  });

  it('uses UTC dates, not the local calendar day', () => {
    expect(resolvePeriod('yesterday', {}, new Date('2026-09-08T23:30:00Z')).from).toBe('2026-09-07');
  });

  it('knows every period it offers', () => {
    for (const p of PERIODS) expect(() => resolvePeriod(p.key, { from: '2026-09-01', to: '2026-09-02' }, wed)).not.toThrow();
    expect(resolvePeriod('nope', {}, wed)).toBeNull();
  });
});

describe('custom range checks', () => {
  const now = at('2026-09-09');
  it('only past days: yesterday is the last pickable day', () => {
    expect(lastPickableDay(now).getDate()).toBe(8);
    expect(customProblem({ from: '2026-09-01', to: '2026-09-08' }, now)).toBe('');
    expect(customProblem({ from: '2026-09-01', to: '2026-09-09' }, now)).toMatch(/past days/);
    expect(customProblem({ from: '2026-09-20', to: '2026-10-16' }, now)).toMatch(/past days/);
  });
  it('explains an end before the start, and a range longer than 92 days; nothing to say until both are chosen', () => {
    expect(customProblem({ from: '2026-09-05', to: '2026-09-01' }, now)).toMatch(/after the end/);
    expect(customProblem({ from: '2026-01-01', to: '2026-09-08' }, now)).toMatch(/at most 92/);
    expect(customProblem({ from: '2026-09-01', to: '' }, now)).toBe('');
  });
});

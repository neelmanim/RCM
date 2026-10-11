import { describe, it, expect } from 'vitest';
import { describeDue, dueGroup } from '../../components/tasks/taskMeta';

const now = new Date('2026-10-07T10:00:00Z');
const at = (mins) => ({ due_time: new Date(now.getTime() + mins * 60e3).toISOString() });

describe('describeDue', () => {
  it('a task that just came due reads "Due now", not "Overdue by 1m"', () => {
    expect(describeDue(at(-1), now)).toEqual({ text: 'Due now', tone: 'warning' });
    expect(dueGroup(at(-1), now)).not.toBe('overdue');
  });
  it('is overdue once genuinely late', () => {
    expect(describeDue(at(-90), now).text).toBe('Overdue by 2h');
    expect(dueGroup(at(-90), now)).toBe('overdue');
  });
  it('a cadence step with a hard stop has no deadline', () => {
    expect(describeDue({ from_cadence: true }, now).text).toBe('No deadline');
  });
});

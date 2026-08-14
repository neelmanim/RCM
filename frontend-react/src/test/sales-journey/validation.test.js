import { describe, it, expect } from 'vitest';
import { validateGraph, errorsByNode } from '../../features/sales-journey/validation';

const trigger = { id: 'n1', type: 'trigger', data: { event: 'status_changed', to_status: 'New' } };

describe('validateGraph', () => {
  it('requires at least one trigger node', () => {
    const errors = validateGraph([], []);
    expect(errors.some((e) => e.message.includes('no trigger node'))).toBe(true);
  });

  it('rejects more than one trigger node', () => {
    const errors = validateGraph([trigger, { ...trigger, id: 'n2' }], []);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('Only one trigger'))).toBe(true);
  });

  it('flags an email node with no subject or body', () => {
    const email = { id: 'n2', type: 'email', data: { subject: '', body: '' } };
    const errors = validateGraph([trigger, email], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.filter((e) => e.nodeId === 'n2').length).toBe(2);
  });

  it('accepts a valid email node', () => {
    const email = { id: 'n2', type: 'email', data: { subject: 'Hi', body: 'Hello' } };
    const errors = validateGraph([trigger, email], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.filter((e) => e.nodeId === 'n2')).toEqual([]);
  });

  it('accepts a valid A/B email node and ignores its (unused) plain subject/body', () => {
    const email = {
      id: 'n2', type: 'email',
      data: { subject: '', body: '', variants: [{ subject: 'A', body: 'a' }, { subject: 'B', body: 'b' }] },
    };
    const errors = validateGraph([trigger, email], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.filter((e) => e.nodeId === 'n2')).toEqual([]);
  });

  it('flags an A/B email node with a blank variant', () => {
    const email = {
      id: 'n2', type: 'email',
      data: { variants: [{ subject: 'A', body: 'a' }, { subject: '', body: '' }] },
    };
    const errors = validateGraph([trigger, email], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.filter((e) => e.nodeId === 'n2').length).toBe(2);
  });

  it('flags an A/B email node with fewer than 2 variants', () => {
    const email = { id: 'n2', type: 'email', data: { variants: [{ subject: 'A', body: 'a' }] } };
    const errors = validateGraph([trigger, email], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('at least 2 variants'))).toBe(true);
  });

  it('flags an sms node with no message', () => {
    const sms = { id: 'n2', type: 'sms', data: { message: '' } };
    const errors = validateGraph([trigger, sms], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('needs a message'))).toBe(true);
  });

  it('flags an sms node whose message is over the length limit', () => {
    const sms = { id: 'n2', type: 'sms', data: { message: 'x'.repeat(1601) } };
    const errors = validateGraph([trigger, sms], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('too long'))).toBe(true);
  });

  it('accepts a valid sms node', () => {
    const sms = { id: 'n2', type: 'sms', data: { message: 'Hi {{first_name}}' } };
    const errors = validateGraph([trigger, sms], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.filter((e) => e.nodeId === 'n2')).toEqual([]);
  });

  it('flags a whatsapp node with no template selected', () => {
    const whatsapp = { id: 'n2', type: 'whatsapp', data: { template_name: '' } };
    const errors = validateGraph([trigger, whatsapp], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('needs a template'))).toBe(true);
  });

  it('accepts a valid whatsapp node', () => {
    const whatsapp = { id: 'n2', type: 'whatsapp', data: { template_name: 'lead_followup_attempt' } };
    const errors = validateGraph([trigger, whatsapp], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.filter((e) => e.nodeId === 'n2')).toEqual([]);
  });

  it('flags a wait node with no duration', () => {
    const wait = { id: 'n2', type: 'wait', data: { duration_hours: 0 } };
    const errors = validateGraph([trigger, wait], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2')).toBe(true);
  });

  it('flags a node with no incoming edge as unreachable', () => {
    const orphan = { id: 'n2', type: 'email', data: { subject: 'Hi', body: 'Hello' } };
    const errors = validateGraph([trigger, orphan], []);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('unreachable'))).toBe(true);
  });

  it('treats a condition node\'s branch_on_timeout target as reachable, not an edge', () => {
    const condition = { id: 'n2', type: 'condition', data: { timeout_hours: 24, branch_on_timeout: 'n3', branch_on_event: {} } };
    const target = { id: 'n3', type: 'email', data: { subject: 'Hi', body: 'Hello' } };
    const errors = validateGraph([trigger, condition, target], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n3' && e.message.includes('unreachable'))).toBe(false);
  });

  it('flags a condition node missing a timeout branch target', () => {
    const condition = { id: 'n2', type: 'condition', data: { timeout_hours: 24, branch_on_timeout: null, branch_on_event: {} } };
    const errors = validateGraph([trigger, condition], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('timeout" branch target'))).toBe(true);
  });

  it('flags a condition node whose event branch points at a deleted node', () => {
    const condition = {
      id: 'n2', type: 'condition',
      data: { timeout_hours: 24, branch_on_timeout: 'n1', branch_on_event: { email_replied: 'does-not-exist' } },
    };
    const errors = validateGraph([trigger, condition], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('no longer exists'))).toBe(true);
  });

  // 2026-08-05: a blank/duplicate event-type branch previously looked "valid"
  // (no red error) even though it could never fire or silently overwrote a
  // sibling branch — audit finding #8.
  it('flags an event branch with no event type selected', () => {
    const condition = {
      id: 'n2', type: 'condition',
      data: { timeout_hours: 24, branch_on_timeout: 'n1', branch_on_event: { '': 'n1' } },
    };
    const errors = validateGraph([trigger, condition], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('no event type selected'))).toBe(true);
  });

  it('flags an event branch with no target node selected', () => {
    const condition = {
      id: 'n2', type: 'condition',
      data: { timeout_hours: 24, branch_on_timeout: 'n1', branch_on_event: { email_replied: '' } },
    };
    const errors = validateGraph([trigger, condition], [{ id: 'e1', source: 'n1', target: 'n2' }]);
    expect(errors.some((e) => e.nodeId === 'n2' && e.message.includes('needs a target node'))).toBe(true);
  });
});

describe('errorsByNode', () => {
  it('groups errors by nodeId and drops graph-level (nodeId=null) errors', () => {
    const errors = [{ nodeId: null, message: 'graph-level' }, { nodeId: 'n1', message: 'a' }, { nodeId: 'n1', message: 'b' }];
    const map = errorsByNode(errors);
    expect(map.get('n1')).toEqual(['a', 'b']);
    expect(map.has(null)).toBe(false);
  });
});

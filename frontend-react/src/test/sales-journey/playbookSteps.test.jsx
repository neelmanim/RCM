import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfigPanel, textToHtml, htmlToText } from '../../features/sales-journey/NodeConfigPanel';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';
import { validateGraph } from '../../features/sales-journey/validation';
import { defaultDataFor } from '../../features/sales-journey/nodeDefaults';

vi.mock('../../services/api', () => ({
  SalesJourneyService: { generateEmail: vi.fn() },
  ConversationsService: { getTemplates: vi.fn(() => Promise.resolve({ templates: [] })) },
}));

// v13.0.0 — builder support for the two-cadence playbook: manual Task steps
// with outcomes, lead-field branches, and formatted (table) emails.

const data = (id) => useJourneyStore.getState().nodes.find((n) => n.id === id).data;
const TRIGGER = { id: 't', type: 'trigger', data: { event: 'status_changed', to_status: 'New' } };

function setNodes(nodes, selectedNodeId) {
  useJourneyStore.setState({ nodes, edges: [], selectedNodeId, dirty: false });
}

beforeEach(() => {
  useJourneyStore.setState({ journeyId: 'j1', versionId: 'v1', nodes: [], edges: [], selectedNodeId: null, dirty: false });
});

describe('Task step', () => {
  it('choosing "LinkedIn connection request" pre-fills Accepted / Not accepted outcomes', async () => {
    const user = userEvent.setup();
    setNodes([TRIGGER, { id: 'k', type: 'task', data: defaultDataFor('task') }], 'k');
    render(<NodeConfigPanel errors={new Map()} />);
    await user.click(screen.getByRole('button', { name: 'Task type' }));
    await user.click(await screen.findByRole('menuitem', { name: 'LinkedIn connection request' }));
    expect(data('k').task_kind).toBe('linkedin_connect');
    expect(data('k').outcomes.map((o) => o.key)).toEqual(['accepted', 'not_accepted']);
    expect(screen.getByLabelText('Outcome 1')).toHaveValue('Accepted');
  });

  it('renaming an outcome keeps its branch target', async () => {
    const user = userEvent.setup();
    const task = { id: 'k', type: 'task', data: { ...defaultDataFor('task'), task_kind: 'linkedin_connect',
      outcomes: [{ key: 'accepted', label: 'Accepted' }], branch_on_outcome: { accepted: 'm' } } };
    setNodes([TRIGGER, task, { id: 'm', type: 'wait', data: { duration_hours: 1 } }], 'k');
    render(<NodeConfigPanel errors={new Map()} />);
    const box = screen.getByLabelText('Outcome 1');
    await user.clear(box);
    await user.type(box, 'Connected');
    expect(data('k').branch_on_outcome).toEqual({ connected: 'm' });
  });

  it('validation: a LinkedIn message step needs its text, outcomes need unique names', () => {
    const errors = validateGraph([
      TRIGGER,
      { id: 'k', type: 'task', data: { task_kind: 'linkedin_message', instructions: '', outcomes: [{ key: 'a' }, { key: 'a' }] } },
    ], [{ source: 't', target: 'k' }]).map((e) => e.message);
    expect(errors).toContain('LinkedIn message step needs the message text for the rep to send.');
    expect(errors).toContain('Every outcome needs a unique name.');
  });
});

describe('Condition: branch on a lead field', () => {
  it('switching to "A lead field" sets up a title rule with match / no-match branches', async () => {
    const user = userEvent.setup();
    setNodes([TRIGGER, { id: 'c', type: 'condition', data: defaultDataFor('condition') }], 'c');
    render(<NodeConfigPanel errors={new Map()} />);
    await user.click(screen.getByRole('button', { name: 'Branch on' }));
    await user.click(await screen.findByRole('menuitem', { name: /A lead field/ }));
    expect(data('c').field_rule).toEqual({ field: 'title', op: 'contains_any', value: '' });
    await user.type(screen.getByLabelText(/Keywords/), 'marketing, growth');
    expect(data('c').field_rule.value).toBe('marketing, growth');
    expect(screen.getByRole('button', { name: 'If it matches, go to' })).toBeInTheDocument();
  });

  it('a field rule needs no timeout, but does need a value', () => {
    const rule = (value) => validateGraph([TRIGGER,
      { id: 'c', type: 'condition', data: { field_rule: { field: 'title', op: 'contains_any', value } } }],
    [{ source: 't', target: 'c' }]).map((e) => e.message);
    expect(rule('marketing')).toEqual([]);
    expect(rule('')).toContain('Enter a value to compare against.');
  });
});

describe('Formatted email', () => {
  it('turning it on converts the plain body to HTML paragraphs, and back', async () => {
    const user = userEvent.setup();
    setNodes([TRIGGER, { id: 'e', type: 'email', data: { subject: 'Hi', body: 'Line one\nLine two\n\nNew para & more' } }], 'e');
    render(<NodeConfigPanel errors={new Map()} />);
    await user.click(screen.getByLabelText('Formatted email (tables, bold, links)'));
    expect(data('e').body_format).toBe('html');
    expect(data('e').body).toBe('<p>Line one<br>Line two</p><p>New para &amp; more</p>');
    expect(screen.getByTitle('Insert table')).toBeInTheDocument();
  });

  it('html → text keeps paragraph breaks', () => {
    expect(htmlToText(textToHtml('a\n\nb'))).toBe('a\n\nb');
    expect(htmlToText('<table><tr><td>What changes</td><td>Impact</td></tr></table>')).toContain('What changes');
  });
});

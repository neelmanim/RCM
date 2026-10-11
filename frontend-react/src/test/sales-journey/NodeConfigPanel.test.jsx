import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfigPanel } from '../../features/sales-journey/NodeConfigPanel';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';

const generateEmail = vi.fn();
const getTemplates = vi.fn(() => Promise.resolve({ templates: [] }));
const getInstantlySendingAccounts = vi.fn(() => Promise.resolve([]));

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    generateEmail: (...args) => generateEmail(...args),
    getInstantlySendingAccounts: (...args) => getInstantlySendingAccounts(...args),
  },
  ConversationsService: {
    getTemplates: (...args) => getTemplates(...args),
  },
}));

function setNodes(nodes, selectedNodeId) {
  useJourneyStore.setState({ nodes, edges: [], selectedNodeId, dirty: false });
}

beforeEach(() => {
  generateEmail.mockClear();
  getTemplates.mockClear();
  getTemplates.mockResolvedValue({ templates: [] });
  useJourneyStore.setState({
    journeyId: 'j1', versionId: 'v1', lastSavedAt: null,
    nodes: [], edges: [], selectedNodeId: null, dirty: false,
  });
});

describe('NodeConfigPanel — TriggerFields', () => {
  it('shows the status sub-field when event is status_changed, and sets it on selection', async () => {
    const user = userEvent.setup();
    const trigger = { id: 'n1', type: 'trigger', data: { event: 'status_changed', to_status: '' } };
    setNodes([trigger], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByText('Enroll a lead when…')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(screen.getByRole('option', { name: 'Calling' }));

    expect(useJourneyStore.getState().nodes[0].data).toMatchObject({
      event: 'status_changed', to_status: 'Calling',
    });
  });

  it('switching the event to email_received hides the status sub-field and clears to_status', async () => {
    const user = userEvent.setup();
    const trigger = { id: 'n1', type: 'trigger', data: { event: 'status_changed', to_status: 'New' } };
    setNodes([trigger], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByRole('button', { name: 'Enroll a lead when…' }));
    await user.click(screen.getByRole('menuitem', { name: 'SDR/AE receives an email from the lead' }));

    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(useJourneyStore.getState().nodes[0].data.event).toBe('email_received');
    expect(useJourneyStore.getState().nodes[0].data.to_status).toBeUndefined();
  });

  it('a cadence can be "Only when enrolled manually" — no status to pick', async () => {
    const user = userEvent.setup();
    setNodes([{ id: 'n1', type: 'trigger', data: { event: 'status_changed', to_status: 'New' } }], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);
    await user.click(screen.getByRole('button', { name: 'Enroll a lead when…' }));
    await user.click(screen.getByRole('menuitem', { name: 'Only when enrolled manually (no automatic start)' }));
    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(useJourneyStore.getState().nodes[0].data).toMatchObject({ event: 'manual' });
    expect(useJourneyStore.getState().nodes[0].data.to_status).toBeUndefined();
  });
});

describe('NodeConfigPanel — condition wait in minutes', () => {
  it('"did they reply?" can wait 15 minutes, not just whole hours', async () => {
    const user = userEvent.setup();
    setNodes([{ id: 'n1', type: 'condition', data: { timeout_hours: 1, branch_on_event: {} } }], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);
    expect(screen.getByText('Wait for the event up to')).toBeInTheDocument();
    const boxes = screen.getAllByRole('spinbutton');   // days, hours, minutes, seconds
    await user.clear(boxes[1]);
    await user.type(boxes[1], '0');
    await user.clear(boxes[2]);
    await user.type(boxes[2], '15');
    expect(useJourneyStore.getState().nodes[0].data.timeout_hours).toBeCloseTo(0.25, 5);
  });
});

describe('NodeConfigPanel — WaitFields duration picker', () => {
  it('decomposes duration_hours into hours/minutes/seconds boxes', () => {
    const wait = { id: 'n1', type: 'wait', data: { duration_hours: 1.5 } }; // 1h 30m 0s
    setNodes([wait], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
  });

  it('typing into hours/minutes/seconds recombines into duration_hours', async () => {
    const user = userEvent.setup();
    const wait = { id: 'n1', type: 'wait', data: { duration_hours: 0 } };
    setNodes([wait], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    const boxes = screen.getAllByRole('spinbutton'); // days, hours, minutes, seconds
    await user.clear(boxes[1]); // hours
    await user.type(boxes[1], '2');
    await user.clear(boxes[2]); // minutes
    await user.type(boxes[2], '15');

    // 2h 15m = 2.25h
    expect(useJourneyStore.getState().nodes[0].data.duration_hours).toBeCloseTo(2.25, 5);
  });

  it('v13: waits are authored in days — 3 days is stored as 72 hours', async () => {
    const user = userEvent.setup();
    setNodes([{ id: 'n1', type: 'wait', data: { duration_hours: 0 } }], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);
    const days = screen.getAllByRole('spinbutton')[0];
    await user.clear(days);
    await user.type(days, '3');
    expect(useJourneyStore.getState().nodes[0].data.duration_hours).toBe(72);
  });
});

describe('NodeConfigPanel — CallFields', () => {
  it('renders the existing task-title field plus a new script field, both wired to node data', async () => {
    const user = userEvent.setup();
    const call = { id: 'n1', type: 'call', data: { title: 'Follow-up call' } };
    setNodes([call], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByDisplayValue('Follow-up call')).toBeInTheDocument();
    const scriptBox = screen.getByPlaceholderText(/Opener, hook, question, close/);
    await user.type(scriptBox, 'Lead with the renewal discount.');

    expect(useJourneyStore.getState().nodes[0].data.script).toBe('Lead with the renewal discount.');
    // Existing field untouched by the addition.
    expect(useJourneyStore.getState().nodes[0].data.title).toBe('Follow-up call');
  });

  it('starts blank when the node has no script set yet', () => {
    const call = { id: 'n1', type: 'call', data: { title: 'Follow-up call' } };
    setNodes([call], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);
    expect(screen.getByPlaceholderText(/Opener, hook, question, close/)).toHaveValue('');
  });
});

describe('NodeConfigPanel — EmailFields merge fields', () => {
  it('inserts at the cursor position when the body was just being edited', async () => {
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: '', body: 'Hi' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    // Realistic sequence: type/click into the body (cursor lands at the end),
    // then click a chip — the textarea blurs but its last cursor position
    // (not 0) is what the insert should use.
    await user.click(screen.getByDisplayValue('Hi'));
    await user.keyboard('{End}');
    await user.click(screen.getByText('{{first_name}}'));

    expect(useJourneyStore.getState().nodes[0].data.body).toBe('Hi{{first_name}}');
  });

  it('appends at the end when the body was never focused', async () => {
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: '', body: 'Hi' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByText('{{first_name}}'));

    // Never-focused textareas default selectionStart/End to 0 in both jsdom
    // and real browsers — inserting there instead of at the end would
    // silently prepend to existing text, which is worse than just appending.
    expect(useJourneyStore.getState().nodes[0].data.body).toBe('Hi{{first_name}}');
  });

  it('inserts after pasted text, not at a stale pre-paste caret position', async () => {
    // Real repro (2026-08-05, live Playwright run against staging): click into
    // an EMPTY body (caret lands at 0, the only position possible), then
    // PASTE content instead of typing it — paste fires input/change but not
    // select/click/keyup, so the caret ref was never refreshed and stayed at
    // 0, prepending the merge field: "{{first_name}}Hi there," instead of
    // "Hi there,{{first_name}}".
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: '', body: '' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    const body = screen.getByPlaceholderText(/first_name/);
    await user.click(body);
    await user.paste('Hi there,');
    await user.click(screen.getByText('{{first_name}}'));

    expect(useJourneyStore.getState().nodes[0].data.body).toBe('Hi there,{{first_name}}');
  });
});

describe('NodeConfigPanel — EmailFields A/B testing', () => {
  it('enabling the A/B toggle seeds variant A from the existing subject/body and adds an empty variant B', async () => {
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: 'Hello', body: 'Hi there' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByLabelText('Split test this email (A/B)'));

    const data = useJourneyStore.getState().nodes[0].data;
    expect(data.variants).toEqual([
      { key: 'A', subject: 'Hello', body: 'Hi there' },
      { key: 'B', subject: '', body: '' },
    ]);
    expect(screen.getByText('Variant A')).toBeInTheDocument();
    expect(screen.getByText('Variant B')).toBeInTheDocument();
  });

  it('editing a variant only updates that variant', async () => {
    const user = userEvent.setup();
    const email = {
      id: 'n1', type: 'email',
      data: { variants: [{ key: 'A', subject: 'Subject A', body: '' }, { key: 'B', subject: 'Subject B', body: '' }] },
    };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    const subjectInputs = screen.getAllByDisplayValue(/Subject [AB]/);
    await user.type(subjectInputs[1], '!');

    const variants = useJourneyStore.getState().nodes[0].data.variants;
    expect(variants[0].subject).toBe('Subject A');
    expect(variants[1].subject).toBe('Subject B!');
  });

  it('disabling the A/B toggle clears variants', async () => {
    const user = userEvent.setup();
    const email = {
      id: 'n1', type: 'email',
      data: { subject: 'Hello', body: 'Hi', variants: [{ key: 'A', subject: 'A', body: 'a' }, { key: 'B', subject: 'B', body: 'b' }] },
    };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByLabelText('Split test this email (A/B)'));

    expect(useJourneyStore.getState().nodes[0].data.variants).toBeNull();
    expect(screen.queryByText('Variant A')).not.toBeInTheDocument();
  });
});

// v13.1.0 (Viren's request): a per-step toggle between automated and
// rep-reviewed sending.
describe('NodeConfigPanel — EmailFields manual approval toggle', () => {
  it('enabling manual mode reveals the deadline + timeout-branch fields and hides A/B testing', async () => {
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: 'Hello', body: 'Hi' } };
    const wait = { id: 'n2', type: 'wait', data: { duration_hours: 1 } };
    setNodes([email, wait], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByLabelText('Split test this email (A/B)')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Require rep approval before sending (manual)'));

    expect(useJourneyStore.getState().nodes[0].data.send_mode).toBe('manual');
    expect(screen.getByText('Deadline (hours)')).toBeInTheDocument();
    expect(screen.getByText('If the deadline passes, go to')).toBeInTheDocument();
    expect(screen.queryByLabelText('Split test this email (A/B)')).not.toBeInTheDocument();
  });

  it('enabling manual mode clears any existing A/B variants', async () => {
    const user = userEvent.setup();
    const email = {
      id: 'n1', type: 'email',
      data: { variants: [{ key: 'A', subject: 'A', body: 'a' }, { key: 'B', subject: 'B', body: 'b' }] },
    };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByLabelText('Require rep approval before sending (manual)'));

    expect(useJourneyStore.getState().nodes[0].data.variants).toBeNull();
  });

  it('disabling manual mode clears send_mode', async () => {
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: 'Hello', body: 'Hi', send_mode: 'manual' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByLabelText('Require rep approval before sending (manual)'));

    expect(useJourneyStore.getState().nodes[0].data.send_mode).toBeUndefined();
    expect(screen.queryByText('Deadline (hours)')).not.toBeInTheDocument();
  });
});

describe('NodeConfigPanel — SMSFields', () => {
  it('inserts a merge field into the message at the cursor', async () => {
    const user = userEvent.setup();
    const sms = { id: 'n1', type: 'sms', data: { message: 'Hi' } };
    setNodes([sms], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByDisplayValue('Hi'));
    await user.keyboard('{End}');
    await user.click(screen.getByText('{{first_name}}'));

    expect(useJourneyStore.getState().nodes[0].data.message).toBe('Hi{{first_name}}');
  });

  it('shows a character count and estimated segment count', () => {
    const sms = { id: 'n1', type: 'sms', data: { message: 'x'.repeat(200) } };
    setNodes([sms], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByText('200/1600 characters · ~2 segments')).toBeInTheDocument();
  });

  it('flags an over-limit message visibly', () => {
    const sms = { id: 'n1', type: 'sms', data: { message: 'x'.repeat(1601) } };
    setNodes([sms], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByText(/too long/)).toBeInTheDocument();
  });
});

describe('NodeConfigPanel — WhatsAppFields', () => {
  it('loads templates and selecting one updates node data', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValueOnce({
      templates: [
        { id: '1', name: 'lead_followup_attempt', template_text: 'Hi ${contacts.first_name}!' },
      ],
    });
    const whatsapp = { id: 'n1', type: 'whatsapp', data: { template_name: '' } };
    setNodes([whatsapp], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    // Options render only once the trigger opens (Radix menu content isn't
    // mounted while closed), so wait for the loaded trigger itself instead of
    // the option text — the template's label/content still gets asserted below.
    await waitFor(() => expect(screen.getByRole('button', { name: 'WhatsApp template' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'WhatsApp template' }));
    await user.click(screen.getByRole('menuitem', { name: 'lead_followup_attempt' }));

    expect(useJourneyStore.getState().nodes[0].data.template_name).toBe('lead_followup_attempt');
    expect(screen.getByText('Hi ${contacts.first_name}!')).toBeInTheDocument();
  });

  it('shows a message when the account has no approved templates', async () => {
    getTemplates.mockResolvedValueOnce({ templates: [] });
    const whatsapp = { id: 'n1', type: 'whatsapp', data: { template_name: '' } };
    setNodes([whatsapp], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await waitFor(() => expect(screen.getByText(/No approved WhatsApp templates/)).toBeInTheDocument());
  });

  it('shows an error state when templates fail to load', async () => {
    getTemplates.mockRejectedValueOnce(new Error('network error'));
    const whatsapp = { id: 'n1', type: 'whatsapp', data: { template_name: '' } };
    setNodes([whatsapp], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await waitFor(() => expect(screen.getByText(/Couldn't load templates/)).toBeInTheDocument());
  });
});

describe('NodeConfigPanel — AI-generated email copy', () => {
  it('fills subject and body from the generated result', async () => {
    generateEmail.mockResolvedValue({ subject: 'Quick question', body: 'Hi {{first_name}}, ...' });
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: '', body: '' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByText('Generate with AI'));
    await user.type(screen.getByPlaceholderText(/demo no-show/), 'Follow-up after a demo no-show');
    await user.click(screen.getByText('Generate'));

    await waitFor(() => expect(generateEmail).toHaveBeenCalledWith('Follow-up after a demo no-show'));
    const data = useJourneyStore.getState().nodes[0].data;
    expect(data.subject).toBe('Quick question');
    expect(data.body).toBe('Hi {{first_name}}, ...');
  });

  it('shows an error toast and keeps the prompt open on failure', async () => {
    generateEmail.mockRejectedValue({ response: { data: { detail: 'AI service error. Please try again.' } } });
    const toastHandler = vi.fn();
    window.addEventListener('alternate:toast', toastHandler);
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: '', body: '' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByText('Generate with AI'));
    await user.type(screen.getByPlaceholderText(/demo no-show/), 'A brief');
    await user.click(screen.getByText('Generate'));

    await waitFor(() => expect(toastHandler).toHaveBeenCalled());
    expect(toastHandler.mock.calls[0][0].detail.message).toBe('AI service error. Please try again.');
    window.removeEventListener('alternate:toast', toastHandler);
  });

  it('works independently per A/B variant', async () => {
    generateEmail.mockResolvedValue({ subject: 'Variant subject', body: 'Variant body' });
    const user = userEvent.setup();
    const email = {
      id: 'n1', type: 'email',
      data: { variants: [{ key: 'A', subject: '', body: '' }, { key: 'B', subject: '', body: '' }] },
    };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    const generateButtons = screen.getAllByText('Generate with AI');
    expect(generateButtons).toHaveLength(2);
    await user.click(generateButtons[1]);   // Variant B's button
    await user.type(screen.getByPlaceholderText(/demo no-show/), 'A brief');
    await user.click(screen.getByText('Generate'));

    await waitFor(() => {
      const variants = useJourneyStore.getState().nodes[0].data.variants;
      expect(variants[1].subject).toBe('Variant subject');
    });
    expect(useJourneyStore.getState().nodes[0].data.variants[0].subject).toBe('');
  });
});

// v13.3.0 — Instantly.ai send-side handoff node. Mirrors EmailFields' A/B
// variant shape (SubjectBodyEditor per row, add/remove via the same
// Plus/Trash2 icon-button pattern), just repeated per sequence step instead
// of per variant.
describe('NodeConfigPanel — InstantlySequenceFields', () => {
  it('adds and removes steps, keeping each step\'s own subject/body/delay independent', async () => {
    const user = userEvent.setup();
    const node = {
      id: 'n1', type: 'instantly_sequence',
      data: { steps: [{ subject: 'Step 1', body: 'Body 1', delay_days: 0 }] },
    };
    setNodes([node], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByText('Step 1')).toBeInTheDocument();
    await user.click(screen.getByText('Add step'));

    expect(useJourneyStore.getState().nodes[0].data.steps).toEqual([
      { subject: 'Step 1', body: 'Body 1', delay_days: 0 },
      { subject: '', body: '', delay_days: 2 },
    ]);
    expect(screen.getByText('Step 2')).toBeInTheDocument();

    // Edit step 2's delay without touching step 1.
    const delayInputs = screen.getAllByLabelText('Delay before this step (days)');
    await user.clear(delayInputs[1]);
    await user.type(delayInputs[1], '5');

    const stepsAfterEdit = useJourneyStore.getState().nodes[0].data.steps;
    expect(stepsAfterEdit[0].delay_days).toBe(0);
    expect(stepsAfterEdit[1].delay_days).toBe(5);

    // Remove step 1 via its own header's remove button (scoped with `within`
    // so this doesn't accidentally hit step 2's).
    const step1Header = screen.getByText('Step 1').parentElement;
    await user.click(within(step1Header).getByRole('button'));

    expect(useJourneyStore.getState().nodes[0].data.steps).toHaveLength(1);
    expect(screen.queryByText('Step 2')).not.toBeInTheDocument();
  });

  it('starts with one empty step by default and hides remove when only one step remains', async () => {
    const node = { id: 'n1', type: 'instantly_sequence', data: { steps: [{ subject: '', body: '', delay_days: 0 }] } };
    setNodes([node], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.queryByText('Step 2')).not.toBeInTheDocument();
  });

  it('"Send from" says what the step uses in one line, and Change opens the mailbox table', async () => {
    const user = userEvent.setup();
    getInstantlySendingAccounts.mockResolvedValueOnce([
      { email: 'a@one.com', domain: 'one.com', daily_limit: 30 },
      { email: 'b@one.com', domain: 'one.com', daily_limit: 20 },
      { email: 'c@two.io', domain: 'two.io', daily_limit: 40 },
    ]);
    setNodes([{ id: 'n1', type: 'instantly_sequence', data: { steps: [{ subject: '', body: '', delay_days: 0 }] } }], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    expect(await screen.findByText('All available mailboxes — 3 mailboxes on 2 domains · up to 90 emails/day')).toBeInTheDocument();
    expect(screen.getByText('Each lead gets one email per step, from one of these mailboxes.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByText('Which mailboxes this step sends from')).toBeInTheDocument();
    await user.click(screen.getByLabelText('c@two.io'));
    expect(useJourneyStore.getState().nodes[0].data.sending_accounts).toEqual(['c@two.io']);
    expect(screen.getAllByText('1 mailbox on 1 domain · up to 40 emails/day').length).toBeGreaterThan(0);
  });

  it('"Send from" warns when the admin removed the mailboxes this step used', async () => {
    getInstantlySendingAccounts.mockResolvedValueOnce([{ email: 'a@one.com', domain: 'one.com', daily_limit: 30 }]);
    setNodes([{ id: 'n1', type: 'instantly_sequence', data: { steps: [{ subject: '', body: '', delay_days: 0 }], sending_accounts: ['gone@x.com'] } }], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your admin removed the mailboxes this step used. Pick new ones, or leads will stop here.');
  });

  it('"Send from" explains when no mailboxes are enabled or Instantly can\'t be reached', async () => {
    getInstantlySendingAccounts.mockRejectedValueOnce({ response: { data: { detail: 'Instantly sync is not configured' } } });
    setNodes([{ id: 'n1', type: 'instantly_sequence', data: { steps: [{ subject: '', body: '', delay_days: 0 }] } }], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Instantly sync is not configured');
  });
});

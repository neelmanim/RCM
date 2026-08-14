import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfigPanel } from '../../features/sales-journey/NodeConfigPanel';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';

const generateEmail = vi.fn();
const getTemplates = vi.fn(() => Promise.resolve({ templates: [] }));

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    generateEmail: (...args) => generateEmail(...args),
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
    const [eventSelect, statusSelect] = screen.getAllByRole('combobox');
    await user.selectOptions(statusSelect, 'Calling');

    expect(useJourneyStore.getState().nodes[0].data).toMatchObject({
      event: 'status_changed', to_status: 'Calling',
    });
  });

  it('switching the event to email_received hides the status sub-field and clears to_status', async () => {
    const user = userEvent.setup();
    const trigger = { id: 'n1', type: 'trigger', data: { event: 'status_changed', to_status: 'New' } };
    setNodes([trigger], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.selectOptions(screen.getAllByRole('combobox')[0], 'email_received');

    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(useJourneyStore.getState().nodes[0].data.event).toBe('email_received');
    expect(useJourneyStore.getState().nodes[0].data.to_status).toBeUndefined();
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

    const boxes = screen.getAllByRole('spinbutton');
    await user.clear(boxes[0]); // hours
    await user.type(boxes[0], '2');
    await user.clear(boxes[1]); // minutes
    await user.type(boxes[1], '15');

    // 2h 15m = 2.25h
    expect(useJourneyStore.getState().nodes[0].data.duration_hours).toBeCloseTo(2.25, 5);
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

    await waitFor(() => expect(screen.getByText('lead_followup_attempt')).toBeInTheDocument());
    await user.selectOptions(screen.getByRole('combobox'), 'lead_followup_attempt');

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
    window.addEventListener('rcm:toast', toastHandler);
    const user = userEvent.setup();
    const email = { id: 'n1', type: 'email', data: { subject: '', body: '' } };
    setNodes([email], 'n1');
    render(<NodeConfigPanel errors={new Map()} />);

    await user.click(screen.getByText('Generate with AI'));
    await user.type(screen.getByPlaceholderText(/demo no-show/), 'A brief');
    await user.click(screen.getByText('Generate'));

    await waitFor(() => expect(toastHandler).toHaveBeenCalled());
    expect(toastHandler.mock.calls[0][0].detail.message).toBe('AI service error. Please try again.');
    window.removeEventListener('rcm:toast', toastHandler);
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

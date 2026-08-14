import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JourneyBuilder } from '../../features/sales-journey/JourneyBuilder';
import { useJourneyStore } from '../../features/sales-journey/store/useJourneyStore';

const saveDraft = vi.fn(() => Promise.resolve({ version_id: 'v1', saved_at: '2026-08-01T01:00:00Z' }));
const publish = vi.fn(() => Promise.resolve({ id: 'j1', status: 'active' }));
const getStats = vi.fn(() => Promise.resolve({ active: 3 }));
const archive = vi.fn(() => Promise.resolve({ id: 'j1', status: 'archived', enrollments_exited: 3 }));
const pause = vi.fn(() => Promise.resolve({ id: 'j1', status: 'paused' }));
const resume = vi.fn(() => Promise.resolve({ id: 'j1', status: 'active' }));
const getFailedEnrollments = vi.fn(() => Promise.resolve([]));
const retryEnrollment = vi.fn(() => Promise.resolve({ enrollment_id: 'e1', status: 'active' }));
const skipEnrollment = vi.fn(() => Promise.resolve({ enrollment_id: 'e1', status: 'failed', exited_reason: 'manually_skipped' }));
const updateSettings = vi.fn(() => Promise.resolve({ id: 'j1', pod_id: null }));
const getAllPods = vi.fn(() => Promise.resolve([]));

vi.mock('../../services/api', () => ({
  SalesJourneyService: {
    saveDraft: (...args) => saveDraft(...args),
    publish: (...args) => publish(...args),
    getStats: (...args) => getStats(...args),
    archive: (...args) => archive(...args),
    pause: (...args) => pause(...args),
    resume: (...args) => resume(...args),
    getFailedEnrollments: (...args) => getFailedEnrollments(...args),
    getActivity: () => Promise.resolve([]),
    retryEnrollment: (...args) => retryEnrollment(...args),
    skipEnrollment: (...args) => skipEnrollment(...args),
    updateSettings: (...args) => updateSettings(...args),
  },
  PodsService: {
    getAll: (...args) => getAllPods(...args),
  },
}));

beforeEach(() => {
  saveDraft.mockClear();
  publish.mockClear();
  getStats.mockClear();
  archive.mockClear();
  pause.mockClear();
  resume.mockClear();
  getFailedEnrollments.mockClear().mockResolvedValue([]);
  retryEnrollment.mockClear();
  skipEnrollment.mockClear();
  updateSettings.mockClear().mockResolvedValue({ id: 'j1', pod_id: null });
  getAllPods.mockClear().mockResolvedValue([]);
  useJourneyStore.setState({
    journeyId: 'j1', versionId: 'v1', lastSavedAt: '2026-08-01T00:00:00Z',
    nodes: [], edges: [], selectedNodeId: null, dirty: false,
  });
});

describe('JourneyBuilder', () => {
  it('Save is disabled when there is nothing to save', () => {
    render(<JourneyBuilder journeyName="Test Journey" onBack={() => {}} />);
    expect(screen.getByText('Saved').closest('button')).toBeDisabled();
  });

  it('shows a pod scope selector and saves the selection immediately', async () => {
    getAllPods.mockResolvedValue([{ id: 'pod-1', name: 'POD-A' }, { id: 'pod-2', name: 'POD-B' }]);
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyPodId="" onBack={() => {}} />);

    const podSelect = await screen.findByTitle(/Only leads in this pod/);
    expect(await screen.findByText('POD-A')).toBeInTheDocument();

    await user.selectOptions(podSelect, 'pod-1');

    expect(updateSettings).toHaveBeenCalledWith('j1', { pod_id: 'pod-1' });
  });

  it('reverts the pod selector if saving the scope fails', async () => {
    getAllPods.mockResolvedValue([{ id: 'pod-1', name: 'POD-A' }]);
    updateSettings.mockRejectedValueOnce({ response: { data: { detail: 'nope' } } });
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyPodId="" onBack={() => {}} />);

    const podSelect = await screen.findByTitle(/Only leads in this pod/);
    await screen.findByText('POD-A');
    await user.selectOptions(podSelect, 'pod-1');

    await waitFor(() => expect(podSelect.value).toBe(''));
  });

  it('renames the cadence on blur and saves it', async () => {
    updateSettings.mockResolvedValueOnce({ id: 'j1', name: 'New Name' });
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="draft" onBack={() => {}} />);

    await user.click(screen.getByTitle('Click to rename'));
    const input = screen.getByDisplayValue('Test Journey');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.tab(); // blur

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith('j1', { name: 'New Name' }));
    expect(await screen.findByText('New Name')).toBeInTheDocument();
  });

  it('does not offer renaming for an archived cadence', () => {
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="archived" onBack={() => {}} />);
    expect(screen.queryByTitle('Click to rename')).not.toBeInTheDocument();
  });

  it('reverts the name if saving the rename fails', async () => {
    updateSettings.mockRejectedValueOnce({ response: { data: { detail: 'nope' } } });
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="draft" onBack={() => {}} />);

    await user.click(screen.getByTitle('Click to rename'));
    const input = screen.getByDisplayValue('Test Journey');
    await user.clear(input);
    await user.type(input, 'Bad Name');
    await user.tab();

    await waitFor(() => expect(screen.getByText('Test Journey')).toBeInTheDocument());
  });

  it('adding a trigger node enables Save, and disables adding a second trigger', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Trigger/ }));

    expect(screen.getByText('Save').closest('button')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Trigger/ })).toBeDisabled();
  });

  it('adding a node opens its config panel, and editing a field updates the store', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^Email$/ }));

    expect(screen.getByText('Email settings')).toBeInTheDocument();
    const subjectInput = screen.getByLabelText('Subject');
    await user.type(subjectInput, 'Welcome!');

    const nodeId = useJourneyStore.getState().nodes[0].id;
    expect(useJourneyStore.getState().nodes.find((n) => n.id === nodeId).data.subject).toBe('Welcome!');
  });

  it('shows a validation issue count for an incomplete graph', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^Email$/ }));

    // Shows up in both the header count and the node card itself — just
    // confirm at least one "issue" indicator rendered.
    await waitFor(() => expect(screen.getAllByText(/issue/).length).toBeGreaterThan(0));
  });

  it('clicking Save calls the API with the current graph and the last-known updated_at', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Trigger/ }));

    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith(
      'j1', 'v1',
      expect.objectContaining({ nodes: expect.any(Array), edges: expect.any(Array) }),
      '2026-08-01T00:00:00Z',
    ));
  });
});

describe('JourneyBuilder — publish/archive', () => {
  it('Publish is disabled while there are unsaved changes or validation errors', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="draft" onBack={() => {}} />);

    expect(screen.getByText('Publish').closest('button')).toBeDisabled(); // no trigger yet -> validation error

    await user.click(screen.getByRole('button', { name: /Trigger/ }));
    expect(screen.getByText('Publish').closest('button')).toBeDisabled(); // valid now, but dirty (unsaved)
  });

  it('publishing after saving calls the API and updates the status badge', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="draft" onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Trigger/ }));
    await user.click(screen.getByText('Save'));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());

    await user.click(screen.getByText('Publish'));
    const publishButtons = screen.getAllByRole('button', { name: 'Publish' });
    await user.click(publishButtons[publishButtons.length - 1]); // confirm dialog's button

    await waitFor(() => expect(publish).toHaveBeenCalledWith('j1'));
    // Badge shows the raw status ("active"), capitalized visually via CSS
    // (className="capitalize") — the DOM text content stays lowercase.
    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
  });

  it('archiving fetches the active-enrollment count, confirms, then calls the API and navigates back', async () => {
    const user = userEvent.setup();
    const onArchived = vi.fn();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="active" onBack={() => {}} onArchived={onArchived} />);

    await user.click(screen.getByText('Archive'));
    await waitFor(() => expect(getStats).toHaveBeenCalledWith('j1'));
    await waitFor(() => expect(screen.getByText(/currently has 3 active enrollment/)).toBeInTheDocument());

    const archiveButtons = screen.getAllByRole('button', { name: 'Archive' });
    await user.click(archiveButtons[archiveButtons.length - 1]); // confirm dialog's button

    await waitFor(() => expect(archive).toHaveBeenCalledWith('j1', 3));
    await waitFor(() => expect(onArchived).toHaveBeenCalled());
  });

  it('an archived journey hides all editing actions', () => {
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="archived" onBack={() => {}} />);
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByText('Publish')).not.toBeInTheDocument();
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
  });
});

describe('JourneyBuilder — pause/resume and failed enrollments', () => {
  it('an active journey shows a Pause button; clicking it pauses and flips to Resume', async () => {
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="active" onBack={() => {}} />);

    await user.click(screen.getByText('Pause'));

    await waitFor(() => expect(pause).toHaveBeenCalledWith('j1'));
    await waitFor(() => expect(screen.getByText('Resume')).toBeInTheDocument());
  });

  it('a draft journey shows neither Pause nor Resume', () => {
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="draft" onBack={() => {}} />);
    expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it('lists failed enrollments with retry/skip actions, and retrying reloads the list', async () => {
    getFailedEnrollments.mockResolvedValueOnce([
      { enrollment_id: 'e1', lead_name: 'Jane Doe', status: 'failed', exited_reason: 'send_failed', last_error: 'Nylas 500' },
    ]).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="active" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText(/Send failed/)).toBeInTheDocument();

    await user.click(screen.getByText('Retry'));
    await waitFor(() => expect(retryEnrollment).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument());
  });

  it('no failed-enrollments panel for a draft journey (nothing has run yet)', () => {
    render(<JourneyBuilder journeyName="Test Journey" journeyStatus="draft" onBack={() => {}} />);
    expect(getFailedEnrollments).not.toHaveBeenCalled();
  });
});

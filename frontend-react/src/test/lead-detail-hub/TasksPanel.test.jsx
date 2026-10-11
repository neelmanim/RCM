import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TasksPanel } from '../../features/lead-detail-hub/components/TasksPanel';

// Picks "the 5th" of whichever month the calendar defaults to — every month
// has one, so this doesn't need to mock the system clock (same pattern as
// AEPipelineHub.test.jsx's own DatePicker interaction).
async function pickADueDate() {
  await userEvent.click(screen.getByRole('button', { name: 'Due date' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: /5th,/ }).length).toBeGreaterThan(0));
  await userEvent.click(screen.getAllByRole('button', { name: /5th,/ })[0]);
}

// RCA 2026-09-28: legacy has a due-DATE and a due-TIME input and builds a UTC
// ISO due_time; the backend (LeadsService.addTask's 4th arg) already accepts
// it, but this panel only ever had a date picker — "call back at 3pm" had no
// way to carry a time.
describe('TasksPanel — due time', () => {
  it('does not show a time picker until a due date is chosen', () => {
    render(<TasksPanel tasks={[]} canModify={true} loading={false} onAdd={vi.fn()} />);
    expect(screen.queryByLabelText('Due time — hour')).not.toBeInTheDocument();
  });

  it('adds a task with a UTC ISO due_time when both date and time are set', async () => {
    const onAdd = vi.fn();
    render(<TasksPanel tasks={[]} canModify={true} loading={false} onAdd={onAdd} />);

    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Call back');
    await pickADueDate();
    await userEvent.click(await screen.findByRole('button', { name: 'Due time — hour' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '15' }));
    await userEvent.click(screen.getByRole('button', { name: 'Due time — minute' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '30' }));
    await userEvent.click(screen.getByText('Add'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [taskTitle, dueDate, dueTime] = onAdd.mock.calls[0];
    expect(taskTitle).toBe('Call back');
    expect(dueDate).toMatch(/^\d{4}-\d{2}-05$/);
    expect(dueTime).toBe(new Date(`${dueDate}T15:30:00`).toISOString());
  });

  it('adds a task with due_time null when only a date is set (no time chosen)', async () => {
    const onAdd = vi.fn();
    render(<TasksPanel tasks={[]} canModify={true} loading={false} onAdd={onAdd} />);

    await userEvent.type(screen.getByPlaceholderText('Add a task…'), 'Follow up');
    await pickADueDate();
    await userEvent.click(screen.getByText('Add'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const [, , dueTime] = onAdd.mock.calls[0];
    expect(dueTime).toBeNull();
  });
});

describe('TasksPanel — cadence steps (v13.7.0)', () => {
  const step = { id: 's1', title: '[Demo] Connect with Asha on LinkedIn', done: 'false', journey_enrollment_id: 'e1',
    lead_name: 'Asha', outcome_options: '[{"key":"accepted","label":"Accepted"}]', description: 'Say hi' };

  it('offers Skip this step instead of Delete, and skips after confirming', async () => {
    const onSkip = vi.fn().mockResolvedValue();
    const onDelete = vi.fn();
    render(<TasksPanel tasks={[step]} canModify={true} loading={false} onSkip={onSkip} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Skip this step/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Skip step' }));
    await waitFor(() => expect(onSkip).toHaveBeenCalledWith('s1'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('a regular task can still be deleted, after confirming', async () => {
    const onDelete = vi.fn().mockResolvedValue();
    render(<TasksPanel tasks={[{ id: 'p1', title: 'Call back', done: 'false' }]} canModify={true} loading={false} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Task actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete task/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('p1'));
  });
});

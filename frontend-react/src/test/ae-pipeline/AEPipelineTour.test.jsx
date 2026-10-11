import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AEPipelineTour } from '../../features/ae-pipeline/AEPipelineTour';

// The tour's Next waits for the next step's target; press it only once it is enabled, and wait for the counter to move.
const pressNext = async (nextCounter) => {
  await waitFor(() => expect(screen.getByText('Next').closest('button')).toBeEnabled());
  fireEvent.click(screen.getByText('Next'));
  if (nextCounter) await screen.findByText(nextCounter);
};


const SEEN_KEY = 'alternate:ae-pipeline-tour-seen';

describe('AEPipelineTour', () => {
  beforeEach(() => window.localStorage.clear());

  it('AE\'s own standalone view (no pipeline-hub-tabs) skips straight to the table step', async () => {
    render(
      <div>
        <div data-tour="ae-pipeline-table">Opportunity table</div>
        <div data-tour="ae-pipeline-log-call">Log a call</div>
        <div data-tour="ae-pipeline-close-deal">Close the deal</div>
        <AEPipelineTour />
      </div>
    );
    expect(await screen.findByText('Your open deals', {}, { timeout: 8000 })).toBeInTheDocument();
  });

  it('inside the merged Pipeline hub (pipeline-hub-tabs present), leads with the merge explanation first', async () => {
    render(
      <div>
        <div data-tour="pipeline-hub-tabs">AE Pipeline / CSM Portal</div>
        <div data-tour="ae-pipeline-table">Opportunity table</div>
        <div data-tour="ae-pipeline-log-call">Log a call</div>
        <div data-tour="ae-pipeline-close-deal">Close the deal</div>
        <AEPipelineTour />
      </div>
    );
    expect(screen.getByText('AE Pipeline & CSM Portal')).toBeInTheDocument();
    await pressNext();
    expect(await screen.findByText('Your open deals')).toBeInTheDocument();
  });

  it('does not show again once marked seen', () => {
    window.localStorage.setItem(SEEN_KEY, '1');
    render(
      <div>
        <div data-tour="ae-pipeline-table">Opportunity table</div>
        <AEPipelineTour />
      </div>
    );
    expect(screen.queryByRole('dialog', { name: /ae pipeline guided tour/i })).not.toBeInTheDocument();
  });
});

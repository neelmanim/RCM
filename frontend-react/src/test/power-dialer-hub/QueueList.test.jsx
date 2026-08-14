import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueueList } from '../../features/power-dialer-hub/components/QueueList';

const queue = [
  { id: 'l1', first_name: 'Devraj', last_name: 'Singh', phone: '+911111111111' },
  { id: 'l2', first_name: 'Ashutosh', last_name: 'Khandelwal', phone: '+912222222222' },
  { id: 'l3', first_name: 'Marya', last_name: 'Marvin', phone: '+913333333333' },
];

describe('QueueList drag-and-drop reorder', () => {
  it('calls onReorderUpcoming with the dragged and target indices', () => {
    // RCA 2026-08-10: TableRow didn't forward draggable/onDrag*/onDrop props
    // to the underlying <tr> — the grip handle rendered but drag-and-drop
    // silently did nothing. Regression guard for that fix.
    const onReorderUpcoming = vi.fn();
    render(
      <QueueList
        queue={queue}
        currentIndex={0}
        sessionStatus={new Map()}
        onReorderUpcoming={onReorderUpcoming}
      />
    );

    const rows = screen.getAllByRole('row').slice(1); // drop header row
    fireEvent.dragStart(rows[1]); // l2, index 1
    fireEvent.dragOver(rows[2]);  // l3, index 2
    fireEvent.drop(rows[2]);

    expect(onReorderUpcoming).toHaveBeenCalledWith(1, 2);
  });

  it('does not make the current row draggable', () => {
    const onReorderUpcoming = vi.fn();
    render(
      <QueueList
        queue={queue}
        currentIndex={0}
        sessionStatus={new Map()}
        onReorderUpcoming={onReorderUpcoming}
      />
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveAttribute('draggable', 'false');
    expect(rows[1]).toHaveAttribute('draggable', 'true');
  });
});

describe('QueueList email-sent indicator', () => {
  const withEmail = [
    { ...queue[0], last_email_sent_at: '2026-08-01T09:00:00Z' },
    { ...queue[1], last_email_sent_at: null },
  ];

  it('shows green for a lead with a sent email, grey otherwise', () => {
    render(<QueueList queue={withEmail} currentIndex={0} sessionStatus={new Map()} onReorderUpcoming={vi.fn()} />);
    expect(screen.getByLabelText('Email sent')).toHaveClass('text-green-600');
    expect(screen.getByLabelText('No email sent yet')).toHaveClass('text-slate-300');
  });
});

describe('QueueList requeue ("Call back")', () => {
  it('shows Call back only for resolved (skipped) rows, and fires onCallBack without triggering row navigation', () => {
    const onCallBack = vi.fn();
    const onLeadClick = vi.fn();
    const sessionStatus = new Map([['l1', 'skipped-manual']]);
    render(
      <QueueList
        queue={queue}
        currentIndex={1}
        sessionStatus={sessionStatus}
        onReorderUpcoming={vi.fn()}
        onLeadClick={onLeadClick}
        onCallBack={onCallBack}
      />
    );

    const callBackBtn = screen.getByRole('button', { name: /Call back/ });
    fireEvent.click(callBackBtn);
    expect(onCallBack).toHaveBeenCalledWith('l1');
    expect(onLeadClick).not.toHaveBeenCalled();
  });

  it('does not show Call back for the current or a still-pending row', () => {
    render(
      <QueueList
        queue={queue}
        currentIndex={1}
        sessionStatus={new Map()}
        onReorderUpcoming={vi.fn()}
        onCallBack={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: /Call back/ })).not.toBeInTheDocument();
  });
});

describe('QueueList pagination', () => {
  function bigQueue(n) {
    return Array.from({ length: n }, (_, i) => ({ id: `l${i}`, first_name: 'Lead', last_name: String(i), phone: `+9190000000${i}` }));
  }

  it('shows no pagination controls when the queue fits on one page', () => {
    render(<QueueList queue={queue} currentIndex={0} sessionStatus={new Map()} onReorderUpcoming={vi.fn()} />);
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });

  it('paginates a long queue and advances via Next/Prev', () => {
    render(<QueueList queue={bigQueue(20)} currentIndex={0} sessionStatus={new Map()} onReorderUpcoming={vi.fn()} />);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Lead 0')).toBeInTheDocument();
    expect(screen.queryByText('Lead 15')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Lead 15')).toBeInTheDocument();
    expect(screen.queryByText('Lead 0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Prev/ }));
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('jumps to the page containing the current lead as it advances', () => {
    const { rerender } = render(<QueueList queue={bigQueue(20)} currentIndex={0} sessionStatus={new Map()} onReorderUpcoming={vi.fn()} />);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    rerender(<QueueList queue={bigQueue(20)} currentIndex={16} sessionStatus={new Map()} onReorderUpcoming={vi.fn()} />);
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText(/← Current/)).toBeInTheDocument();
  });
});

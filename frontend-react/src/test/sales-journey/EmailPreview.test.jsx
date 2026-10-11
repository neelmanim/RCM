import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmailPreview, MessagePreview } from '../../features/sales-journey/EmailPreview';
import { SAMPLE_LEAD } from '../../utils/mergeFields';

// Why this exists: since v12.1 made cadences readable by every role, a
// read-only viewer could open a cadence and still not see what the email
// said — the node card truncates the subject and the config panel's fields
// sit inside a disabled <fieldset>.
describe('EmailPreview', () => {
  it('resolves merge fields to sample values instead of showing raw tokens', () => {
    render(<EmailPreview node={{ type: 'email', data: {
      subject: 'Hi {{first_name}}, about {{company}}',
      body: 'Hello {{first_name}} at {{company}}.',
    } }} />);

    expect(screen.getByText(`Hi ${SAMPLE_LEAD.first_name}, about ${SAMPLE_LEAD.company}`)).toBeInTheDocument();
    expect(screen.queryByText(/\{\{first_name\}\}/)).not.toBeInTheDocument();
  });

  it('renders an unknown field as blank, matching what the backend actually sends', () => {
    render(<EmailPreview node={{ type: 'email', data: { subject: 'A {{not_a_field}} B', body: '' } }} />);
    // Not "A {{not_a_field}} B" — a recipient never sees a literal token.
    // 'A B' not 'A  B': Testing Library collapses whitespace by default.
    expect(screen.getByText('A B')).toBeInTheDocument();
  });

  it('previews each A/B variant separately', () => {
    render(<EmailPreview node={{ type: 'email', data: { variants: [
      { key: 'A', subject: 'First', body: 'One' },
      { key: 'B', subject: 'Second', body: 'Two' },
    ] } }} />);
    expect(screen.getByText('Variant A preview')).toBeInTheDocument();
    expect(screen.getByText('Variant B preview')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('says so plainly when a step has no copy yet', () => {
    render(<EmailPreview node={{ type: 'email', data: {} }} />);
    expect(screen.getByText('No subject yet')).toBeInTheDocument();
    expect(screen.getByText('No body yet')).toBeInTheDocument();
  });

  it('previews an sms message, and names the template for whatsapp', () => {
    const { unmount } = render(<MessagePreview node={{ type: 'sms', data: { message: 'Yo {{first_name}}' } }} />);
    expect(screen.getByText(`Yo ${SAMPLE_LEAD.first_name}`)).toBeInTheDocument();
    unmount();

    render(<MessagePreview node={{ type: 'whatsapp', data: { template_name: 'welcome_v2' } }} />);
    expect(screen.getByText('Approved template: welcome_v2')).toBeInTheDocument();
  });
});

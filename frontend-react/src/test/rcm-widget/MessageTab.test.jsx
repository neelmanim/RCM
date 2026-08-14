import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageTab } from '../../features/rcm-widget/components/MessageTab';

function baseMessaging(overrides = {}) {
  return {
    channel: 'whatsapp',
    setChannel: vi.fn(),
    sessionState: null,
    sessionLoading: false,
    messages: [],
    templates: [],
    selectedTemplate: null,
    setSelectedTemplate: vi.fn(),
    sending: false,
    sendMessage: vi.fn(),
    unreadCount: 0,
    ...overrides,
  };
}

describe('MessageTab', () => {
  it('shows the no-lead notice when no lead is selected', () => {
    render(<MessageTab ui={{ leadId: null, leadPhone: null }} messaging={baseMessaging()} />);
    expect(screen.getByText('No lead selected')).toBeInTheDocument();
  });

  it('shows the no-phone notice when a lead has no phone number', () => {
    render(<MessageTab ui={{ leadId: 'lead-a', leadPhone: null }} messaging={baseMessaging()} />);
    expect(screen.getByText('No phone number')).toBeInTheDocument();
  });

  it('shows channel buttons and compose input when a lead with a phone is active', () => {
    render(
      <MessageTab
        ui={{ leadId: 'lead-a', leadPhone: '919876543210', leadName: 'Jane' }}
        messaging={baseMessaging({ sessionState: { conversation_id: 42, requires_template: false } })}
      />,
    );
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('SMS')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message…')).toBeInTheDocument();
  });

  it('shows the template picker instead of free-text compose when a template is required', () => {
    render(
      <MessageTab
        ui={{ leadId: 'lead-a', leadPhone: '919876543210', leadName: 'Jane' }}
        messaging={baseMessaging({
          sessionState: { conversation_id: null, requires_template: true },
          templates: [{ id: 1, name: 'greeting', template_text: 'Hi ${contacts.first_name}' }],
        })}
      />,
    );
    expect(screen.getByText('Select template')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Type a message…')).not.toBeInTheDocument();
  });

  it('disables send while session-state is still loading, so a fast Send cannot bypass an unresolved template requirement', () => {
    const sendMessage = vi.fn();
    render(
      <MessageTab
        ui={{ leadId: 'lead-a', leadPhone: '919876543210', leadName: 'Jane' }}
        messaging={baseMessaging({ sessionState: null, sessionLoading: true, sendMessage })}
      />,
    );
    const textarea = screen.getByPlaceholderText('Type a message…');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('renders real message history instead of "No messages yet" once loaded', () => {
    render(
      <MessageTab
        ui={{ leadId: 'lead-a', leadPhone: '919876543210', leadName: 'Jane' }}
        messaging={baseMessaging({
          sessionState: { conversation_id: 42, requires_template: false },
          messages: [{ id: 'srv-1', dir: 'inbound', text: 'Hi there', time: new Date(), status: 'sent' }],
        })}
      />,
    );
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });
});

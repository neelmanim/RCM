// ── sandboxMock.js — Rich mock data and request handler for Alternate CRM Sandbox Mode ──

export const MOCK_LEADS = [
  {
    id: 101,
    first_name: 'Sarah',
    last_name: 'Jenkins',
    email: 'sjenkins@stripe.com',
    phone: '+1 (415) 890-2341',
    company: 'Stripe',
    title: 'VP of Revenue Operations',
    status: 'Qualified',
    source: 'Inbound Demo Request',
    priority_score: 95,
    assigned_to: 1,
    assigned_to_name: 'Alex Rivera',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
    last_activity: 'Call completed · 4m 12s',
    notes: 'Interested in consolidating SDR power dialing and AI cadences across their 45-person sales org.',
    tags: ['High Intent', 'Enterprise'],
    custom_fields: { arr: '$180,000', rep_count: '45' }
  },
  {
    id: 102,
    first_name: 'Marcus',
    last_name: 'Vance',
    email: 'm.vance@figma.com',
    phone: '+1 (415) 762-9912',
    company: 'Figma',
    title: 'Head of Growth Sales',
    status: 'Meeting Scheduled',
    source: 'Outbound Sequence',
    priority_score: 92,
    assigned_to: 2,
    assigned_to_name: 'Sarah Chen',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 4).toISOString(),
    last_activity: 'Demo confirmed for Thursday 2 PM PST',
    notes: 'Looking for a native CRM with intelligent cadences and automated pipeline health monitoring.',
    tags: ['Enterprise', 'Expansion'],
    custom_fields: { arr: '$120,000', rep_count: '30' }
  },
  {
    id: 103,
    first_name: 'David',
    last_name: 'O\'Connor',
    email: 'david.oc@notion.so',
    phone: '+1 (415) 554-1290',
    company: 'Notion',
    title: 'Director of Sales Strategy',
    status: 'Contacted',
    source: 'Executive Referral',
    priority_score: 88,
    assigned_to: 3,
    assigned_to_name: 'David Kim',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 1).toISOString(),
    last_activity: 'Connected on LinkedIn & Sent Intro Video',
    notes: 'Evaluating Alternate CRM as replacement for legacy tools.',
    tags: ['High Intent'],
    custom_fields: { arr: '$90,000', rep_count: '25' }
  },
  {
    id: 104,
    first_name: 'Amara',
    last_name: 'Patel',
    email: 'amara@ramp.com',
    phone: '+1 (212) 430-8811',
    company: 'Ramp',
    title: 'Senior Sales Enablement Lead',
    status: '1st Discovery Meeting',
    source: 'Product Hunt Launch',
    priority_score: 85,
    assigned_to: 1,
    assigned_to_name: 'Alex Rivera',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 6).toISOString(),
    last_activity: 'Discovery call notes logged',
    notes: 'Needs multi-channel cadences with AI voice intelligence.',
    tags: ['Inbound'],
    custom_fields: { arr: '$65,000', rep_count: '18' }
  },
  {
    id: 105,
    first_name: 'Liam',
    last_name: 'Kowalski',
    email: 'lkowalski@vercel.com',
    phone: '+1 (650) 912-4433',
    company: 'Vercel',
    title: 'Sales Operations Manager',
    status: 'Demo Scheduled',
    source: 'Webinar Attendee',
    priority_score: 89,
    assigned_to: 2,
    assigned_to_name: 'Sarah Chen',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 3).toISOString(),
    last_activity: 'Calendar invite accepted',
    notes: 'Full team demo scheduled for next Tuesday.',
    tags: ['Enterprise'],
    custom_fields: { arr: '$110,000', rep_count: '22' }
  },
  {
    id: 106,
    first_name: 'Rachel',
    last_name: 'Greenwood',
    email: 'rachel@datadoghq.com',
    phone: '+1 (212) 890-4412',
    company: 'Datadog',
    title: 'VP of Commercial Sales',
    status: 'New',
    source: 'G2 Crowd Review Lead',
    priority_score: 79,
    assigned_to: 3,
    assigned_to_name: 'David Kim',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    last_activity: 'Imported via G2 Intent Integration',
    notes: 'High intent surge detected on CRM & Outbound dialer categories.',
    tags: ['High Intent'],
    custom_fields: { arr: '$150,000', rep_count: '50' }
  },
  {
    id: 107,
    first_name: 'Thomas',
    last_name: 'Wright',
    email: 'twright@snowflake.com',
    phone: '+1 (408) 882-1922',
    company: 'Snowflake',
    title: 'Global SDR Director',
    status: 'Won',
    source: 'Outbound Sequence',
    priority_score: 98,
    assigned_to: 1,
    assigned_to_name: 'Alex Rivera',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 14).toISOString(),
    last_activity: 'Contract signed · 1 Year Enterprise',
    notes: 'Contract executed. Onboarding scheduled with CSM Elena.',
    tags: ['Enterprise', 'Won'],
    custom_fields: { arr: '$240,000', rep_count: '60' }
  },
  {
    id: 108,
    first_name: 'Elena',
    last_name: 'Gomez',
    email: 'egomez@linear.app',
    phone: '+1 (415) 309-8871',
    company: 'Linear',
    title: 'Head of Business Development',
    status: 'Qualified',
    source: 'Product Hunt Launch',
    priority_score: 82,
    assigned_to: 2,
    assigned_to_name: 'Sarah Chen',
    pod_id: 1,
    created_at: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
    last_activity: 'Pricing proposal delivered',
    notes: 'Reviewing proposal with finance.',
    tags: ['Inbound'],
    custom_fields: { arr: '$45,000', rep_count: '12' }
  }
];

export const MOCK_USERS = [
  { id: 1, name: 'Alex Rivera', email: 'alex@alternatecrm.test', role: 'Super Admin', active: true },
  { id: 2, name: 'Sarah Chen', email: 'sarah@alternatecrm.test', role: 'SDR', active: true },
  { id: 3, name: 'David Kim', email: 'david@alternatecrm.test', role: 'AE', active: true },
  { id: 4, name: 'Elena Rostova', email: 'elena@alternatecrm.test', role: 'CSM', active: true }
];

export const MOCK_STATS = {
  total: 348,
  status_counts: {
    'New': 48,
    'Contacted': 112,
    'Qualified': 64,
    'Meeting Scheduled': 32,
    '1st Discovery Meeting': 28,
    'Demo Scheduled': 22,
    'Won': 26,
    'Disqualified': 16
  },
  recent_leads: MOCK_LEADS.slice(0, 5)
};

export function handleSandboxRequest(config) {
  const url = (config.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '');
  const method = (config.method || 'GET').toUpperCase();

  // Dashboard Stats
  if (url.includes('/leads/dashboard-stats')) {
    return { status: 200, data: MOCK_STATS };
  }

  // Leads list
  if (url === '/leads' || url.startsWith('/leads?') || url.includes('/leads/my')) {
    return {
      status: 200,
      data: {
        data: MOCK_LEADS,
        leads: MOCK_LEADS,
        total: MOCK_LEADS.length,
        page: 1,
        per_page: 50,
        pages: 1
      }
    };
  }

  // Single Lead Detail
  if (url.match(/\/leads\/\d+/)) {
    const id = parseInt(url.match(/\/leads\/(\d+)/)[1], 10);
    const found = MOCK_LEADS.find((l) => l.id === id) || MOCK_LEADS[0];
    return { status: 200, data: found };
  }

  // Capabilities
  if (url.includes('/me/capabilities')) {
    return {
      status: 200,
      data: {
        calling: { enabled: true, provider: 'alternate_messenger' },
        sms: { enabled: true },
        email: { enabled: true },
        any: true
      }
    };
  }

  // Dialer status
  if (url.includes('/dialer/status') || url.includes('/dialer/active')) {
    return {
      status: 200,
      data: {
        active: true,
        provider: 'alternate_messenger',
        has_credentials: true
      }
    };
  }

  // Admin users / team
  if (url.includes('/admin/users') || url.includes('/users')) {
    return { status: 200, data: MOCK_USERS };
  }

  // Lead companies
  if (url.includes('/leads/companies')) {
    return {
      status: 200,
      data: {
        companies: ['Stripe', 'Figma', 'Notion', 'Ramp', 'Vercel', 'Datadog', 'Snowflake', 'Linear']
      }
    };
  }

  // Lead tags
  if (url.includes('/leads/tags') || url.includes('/tags')) {
    return {
      status: 200,
      data: [
        { id: 1, name: 'High Intent' },
        { id: 2, name: 'Enterprise' },
        { id: 3, name: 'Inbound' },
        { id: 4, name: 'Expansion' }
      ]
    };
  }

  // Call lists
  if (url.includes('/call-lists')) {
    return {
      status: 200,
      data: {
        call_lists: [
          { id: 1, name: 'Q4 Enterprise Outbound', lead_count: 32 },
          { id: 2, name: 'Demo Follow-ups', lead_count: 14 }
        ]
      }
    };
  }

  // Activity Feed
  if (url.includes('/activity-feed') || url.includes('/activities')) {
    return {
      status: 200,
      data: [
        { id: 1, action: 'status_change', details: 'Moved to Qualified', created_at: new Date().toISOString(), user_name: 'Alex Rivera' },
        { id: 2, action: 'call_logged', details: 'Outbound Call · 4m 12s', created_at: new Date(Date.now() - 3600000).toISOString(), user_name: 'Sarah Chen' },
        { id: 3, action: 'meeting_booked', details: 'Demo Scheduled for Figma', created_at: new Date(Date.now() - 7200000).toISOString(), user_name: 'David Kim' }
      ]
    };
  }

  // Notifications
  if (url.includes('/notifications')) {
    return {
      status: 200,
      data: {
        unread_count: 0,
        notifications: []
      }
    };
  }

  // Default fallback for any mutation or other GET in sandbox
  return {
    status: 200,
    data: {
      success: true,
      message: 'Sandbox operation simulated successfully'
    }
  };
}

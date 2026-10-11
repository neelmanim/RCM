// Every page guide that can be replayed from Help & User Guide -> Guided tours. `view` is the nav item the guide lives on,
// `seenKey` is that guide's key (components/ui/GuidedTour.jsx), `roles` are the exact roles whose navigation has the page.
const ALL = ['Super Admin', 'Admin', 'Pod Admin', 'AE', 'SDR', 'CSM'];
const REPS = ['Super Admin', 'Admin', 'Pod Admin', 'AE', 'SDR'];
const ADMINS = ['Super Admin', 'Admin', 'Pod Admin'];

export const TOURS = [
  { id: 'digest', title: 'Team Digest', view: 'digest', seenKey: 'alternate:daily-digest-tour-seen-v2', roles: ADMINS,
    blurb: 'Pick a period, read your team\'s numbers, follow them through the Funnel and the Drill-down to the leads behind them.' },
  { id: 'control-center', title: 'Control Center', view: 'control-center', seenKey: 'alternate:control-center-tour-seen-v2', roles: ADMINS,
    blurb: 'Who may download data, the Export History, and how Salesforce syncing and field mapping work.' },
  { id: 'dashboard', title: 'Dashboard', view: 'dashboard', seenKey: 'alternate:dashboard-tour-seen', roles: REPS,
    blurb: 'Your numbers, My Day, starting to call, and the leaderboard.' },
  { id: 'my-tasks', title: 'My Tasks', view: 'my-tasks', seenKey: 'alternate:my-tasks-tour-seen', roles: ALL,
    blurb: 'Everything waiting on you: approvals, things to do, and done.' },
  { id: 'leads', title: 'Leads', view: 'leads', seenKey: 'alternate:leads-hub-tour-seen-v2', roles: REPS,
    blurb: 'Leads grouped by company, picking several at once, saved views and choosing your columns.' },
  { id: 'sales-tools', title: 'Sales Tools', view: 'sales-tools', seenKey: 'alternate:sales-tools-tour-seen', roles: REPS,
    blurb: 'Cadences and Campaigns: starting one and tracking what happened.' },
  { id: 'leaderboard', title: 'Leaderboard', view: 'leaderboard', seenKey: 'alternate:leaderboard-tour-seen', roles: REPS,
    blurb: 'The top three, picking a period, SDRs and AEs, and your pod or everyone.' },
  { id: 'analytics', title: 'Analytics Hub', view: 'analytics', seenKey: 'alternate:analytics-hub-tour-seen', roles: REPS,
    blurb: 'Where the lead activity charts are and how to show them.' },
  { id: 'ae-pipeline', title: 'AE Pipeline', view: 'ae-pipeline', seenKey: 'alternate:ae-pipeline-tour-seen', roles: ['AE'],
    blurb: 'Your open deals, logging a call and closing a deal.' },
  { id: 'csm-inbox', title: 'CSM Inbox', view: 'csm-inbox', seenKey: 'alternate:csm-portal-inbox-tour-seen', roles: ['CSM'],
    blurb: 'Your accounts, worst health first.' },
  { id: 'csm-portfolio', title: 'CSM Portfolio', view: 'csm-portfolio', seenKey: 'alternate:csm-portal-portfolio-tour-seen', roles: ['CSM'],
    blurb: 'Your full portfolio of accounts.' },
  { id: 'csm-playbooks', title: 'CSM Playbooks', view: 'csm-playbooks', seenKey: 'alternate:csm-portal-playbooks-tour-seen', roles: ['CSM'],
    blurb: 'Ready-made steps to follow with an account.' },
  { id: 'csm-digest', title: 'CSM Digest', view: 'csm-digest', seenKey: 'alternate:csm-portal-digest-tour-seen', roles: ['CSM'],
    blurb: 'Your weekly roll-up.' },
  { id: 'my-settings', title: 'My Settings', view: 'my-settings', seenKey: 'alternate:my-settings-tour-seen', roles: ALL,
    blurb: 'Connecting your mailbox, your dialer and caller ID, and your email sign-off.' },
];

export const toursFor = (role) => TOURS.filter((t) => t.roles.includes(role));
